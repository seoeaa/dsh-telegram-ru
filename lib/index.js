/**
 * dsh-telegram — a Telegram channel for DeepSeek Harness.
 *
 * Composition entry. It wires five collaborators together and owns nothing
 * else:
 *
 *   api        Telegram Bot API client            (api.js)
 *   bindings   durable chat -> session mapping     (bindings.js)
 *   questions  inline-keyboard question provider   (questions.js)
 *   commands   in-chat control plane               (commands.js)
 *   replies    turn -> Telegram message delivery   (reply.js)
 *
 * Inbound routing order matters, and is deliberate:
 *   1. a chat awaiting a typed question answer consumes the message
 *   2. a slash command is handled by the channel
 *   3. anything else becomes agent input
 *
 * The bot token is read from `ctx.credentials`, never from plugin config, so
 * it does not appear in composed-config dumps or logs.
 */

import path from 'node:path';
import { homedir } from 'node:os';

import Schema from '@deepseek-ai/schemastery';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

import { TelegramApi, describe } from './api.js';
import { BindingStore, conversationKey } from './bindings.js';
import { COMMAND_MENU, TelegramCommands } from './commands.js';
import { ReplyRouter } from './reply.js';
import { TelegramQuestions } from './questions.js';
import { escapeHtml } from './markdown.js';
import { translator } from './i18n.js';
import { installApprovalRouting, installQuestionRouting } from './question-routing.js';
import { TelegramApprovals } from './approvals.js';
import { MessageDebouncer } from './debounce.js';
import { TypingKeeper } from './typing.js';
import { decideStart, registerSettings, SettingsSchema } from './settings.js';

export const name = 'dsh-telegram';

/**
 * Services the channel waits for before starting.
 *
 * `ctx.get()` reads the store directly but returns `undefined` while the
 * providing fiber is not yet active, so a service used during startup —
 * notably `credentials`, which supplies the bot token — must be declared here
 * or it would silently read as missing.
 *
 * Deliberately absent: `agentPresets` and `compaction`. Those are consulted only while handling a command, long
 * after boot, so `ctx.get()` resolves them by then and a composition that omits
 * one degrades that single command instead of stalling the whole channel.
 */
export const inject = [
  'agents',
  'llm',
  'credentials',
  'userQuestions',
  'agentDefaultModel',
  'attachments',
  'workspaceRegistry',
  'sessionController',
  'sessionQuery',
  'permissionPresets',
  // `settings` is NOT listed here on purpose. The channel must still run on a
  // composition that provides no settings service — it then reads its entry
  // config and simply offers no settings card. `registerSettings` waits for
  // the service with its own `ctx.inject`, so requiring it here would turn an
  // optional feature into a startup dependency.
];

/**
 * Plugin configuration. The bot token is deliberately absent: only its
 * credential reference lives here, so the secret never appears in a composed
 * config dump, a log line, or a profile file.
 */
export const Config = Schema.object({
  ...Object.fromEntries(Object.entries(SettingsSchema.dict).map(([key, schema]) => [key, schema.volatile()])),
  preset: Schema.string(),
  bindingFile: Schema.string(),
});

export function apply(ctx, config = {}) {
  const logger = makeLogger(ctx);

  /**
   * Live settings, layered over the composition's entry config.
   *
   * `options()` is called at each use rather than captured once, so a value the
   * user edits in the Settings page reaches the next message.
   *
   * Some fields cannot be swapped under a running poller: the token reference
   * names a different bot, and the workspace root decides where sessions run.
   * A plugin cannot restart itself — `ctx.scope` is not a readable property
   * (cordis' proxy refuses it without an inject declaration) and `ctx.effect`
   * returns a disposer, not a restart handle; the Fiber that owns `restart()`
   * belongs to whoever called `ctx.plugin`. So those changes are persisted and
   * announced, and take effect at the next start rather than being silently
   * accepted and quietly ignored.
   */
  const settings = registerSettings(ctx, config);
  const options = () => ({ ...config, ...settings.current() });

  if (options().enabled === false) return;

  /**
   * The plugin's own context, captured OUTSIDE `ctx.effect`.
   *
   * `ctx.agents.create()` binds the new agent's lifetime to the calling fiber.
   * Creating one from inside the effect made every agent a child of that
   * short-lived fiber, so `followup()` returned normally while the message was
   * discarded — the session existed but never grew past its header. Agents must
   * outlive a single effect run, so they are created from the plugin fiber.
   */
  const pluginCtx = ctx;

  ctx.effect(async () => {
    // Snapshot the fields that cannot change under a running poller. A change
    // to any of these tears the channel down and starts it again, so reading
    // them once here is correct; everything else is read live via `options()`.
    const startup = options();
    if (startup.enabled === false) return () => {};

    const token = await resolveToken(ctx, startup.tokenRef, logger);
    if (!token) {
      logger.warn(
        `[dsh-telegram] credential "${startup.tokenRef}" is not set; the channel stays idle`,
      );
      return () => {};
    }

    const api = new TelegramApi(token, {
      logger,
      /**
       * Egress policy from the channel settings: IPv4 first (this host's IPv6
       * has no route, and `fetch failed` there is what made the channel deaf on
       * 2026-09-27) plus an optional proxy for when the direct path is blocked.
       * Read once here — changing either needs a DSH restart.
       */
      forceIPv4: startup.forceIPv4 !== false,
      proxyUrl: startup.proxyUrl ?? '',
      /**
       * A polling conflict means another process owns this token, so the
       * channel is deaf. Sending is not affected by it, which is why the one
       * useful thing left is to say so in a chat the channel already knows.
       */
      onPollingConflict: async ({ detail }) => {
        const known = bindings.cache ? Object.values(bindings.cache) : [];
        const binding = known[0];
        if (!binding) {
          logger.warn('[dsh-telegram] polling conflict, and no chat is bound yet to tell');
          return;
        }
        await api.sendHtml(
          binding.chatId,
          translate()('pollingConflictNotice', escapeHtml(String(detail ?? ''))),
          { threadId: binding.threadId },
        );
        logger.info(
          `[dsh-telegram] polling conflict announced in chat ${binding.chatId}`,
        );
      },
    });

    const network = await api.applyNetworkPolicy();
    logger.info(
      `[dsh-telegram] network policy: ${network.forceIPv4 ? 'IPv4-first' : 'resolver order'}` +
        `${network.proxy ? `, proxy ${network.proxy}` : ', direct'}` +
        `${network.dispatcher ? '' : network.proxy ? ' (proxy not active)' : ''}`,
    );

    let me;
    try {
      me = await api.getMe();
    } catch (error) {
      logger.error(
        '[dsh-telegram] bot authentication failed; the channel stays idle',
        describe(error),
      );
      return () => {};
    }
    logger.info(`[dsh-telegram] connected as @${me.username}`);

    const dshHome = process.env.DSH_HOME ?? path.join(homedir(), '.dsh');
    const bindings = new BindingStore({
      file: startup.bindingFile ?? path.join(dshHome, 'dsh-telegram', 'bindings.json'),
      logger,
    });

    // Load the chat -> session map at startup rather than on the first Telegram
    // message. The question and approval routers resolve a session id through
    // this cache, and without an eager load a request raised by a session that
    // was resumed from the Web UI (or by a turn already running when the
    // harness restarted) would find an empty cache and be answered in the
    // browser instead of the chat it belongs to.
    await bindings.load();

    const workspaceRoot = startup.workspaceRoot ?? process.cwd();

    /* ---------------- agent bookkeeping ---------------- */

    /** sessionId -> owned agent handle */
    const handles = new Map();
    /** agent -> its ModelSelectionRef, so /model can retarget a live agent */
    const selectionRefs = new WeakMap();
    /** conversation key -> promise chain, serializing that chat's messages */
    const chains = new Map();

    const getAgent = (sessionId) => handles.get(sessionId)?.agent ?? pluginCtx.agents.get(sessionId);

    const targetForSession = (sessionId) => {
      const binding = bindings.cache
        ? Object.values(bindings.cache).find((entry) => entry.sessionId === sessionId)
        : undefined;
      if (!binding) return undefined;
      return {
        chatId: binding.chatId,
        threadId: binding.threadId,
        key: binding.key,
      };
    };

    /* ---------------- collaborators ---------------- */

    const questions = new TelegramQuestions({ api, logger, translate });
    const approvals = new TelegramApprovals({ api, logger, translate });
    const typing = new TypingKeeper({ api, logger });

    const replies = new ReplyRouter({
      api,
      logger,
      bindings,
      resolveTarget: targetForSession,
      typing,
      streaming: startup.streaming,
      showToolActivity: startup.showToolActivity,
      rich: startup.rich,
      workspaceRootFor: (sessionId) => {
        const target = targetForSession(sessionId);
        const binding = target && bindings.cache?.[target.key];
        return binding?.cwd ?? workspaceRoot;
      },
    });

    const commands = new TelegramCommands({
      api,
      ctx,
      logger,
      bindings,
      getAgent,
      selectSession: async (target, row) => {
        const other = Object.values(bindings.cache).find(b => b.sessionId === row.sessionId && b.key !== target.key);
        if (other) throw new Error('Этой задачей уже управляют из другого Telegram-чата.');
        const before = bindings.cache[target.key]?.sessionId;
        if (before) { typing.stop(before); replies.releaseSession(before); }
        await bindings.patch(target.key, {
          sessionId: row.sessionId, cwd: row.cwd, existingSession: true,
          provider: undefined, model: undefined, sandboxMode: undefined, pendingModel: false, pendingSandboxMode: undefined,
        });
        replies.claimSession(row.sessionId);
      },
      startNewSession: async (target, seedText, cwd) => {
        const before = bindings.cache?.[target.key]?.sessionId;
        const rotated = await bindings.rotate(target.key);
        if (before) { typing.stop(before); replies.releaseSession(before); }
        await bindings.patch(target.key, {
          chatId: target.chatId,
          threadId: target.threadId,
          existingSession: false,
          ...(cwd ? { cwd, provider: undefined, model: undefined } : {}),
        });
        if (seedText) {
          const agent = await ensureAgent(target);
          replies.claimSession(agent.id);
          agent.followup(userMessage(seedText));
        }
        return rotated.sessionId;
      },
    });
    commands.selectionRefs = selectionRefs;

    /* ---------------- agent lifecycle ---------------- */

    async function ensureAgent(target) {
      const { binding } = await bindings.ensure(target.key, {
        chatId: target.chatId,
        threadId: target.threadId,
        cwd: workspaceRoot,
        preset: startup.preset,
      });

      const live = handles.get(binding.sessionId)?.agent ?? pluginCtx.agents.get(binding.sessionId);
      if (live) {
        if (binding.pendingModel && binding.provider && binding.model) {
          await ctx.get('sessionController').selectModel({ sessionId: binding.sessionId, provider: binding.provider, model: binding.model });
          const ref = selectionRefs.get(live);
          if (ref) ref.current = { provider: binding.provider, model: binding.model };
        }
        if (binding.pendingSandboxMode) ctx.get('permissionPresets').set(live.session, binding.pendingSandboxMode);
        await bindings.patch(target.key, { pendingModel: false, pendingSandboxMode: undefined });
        return live;
      }

      const selection =
        binding.provider && binding.model
          ? { provider: binding.provider, model: binding.model }
          : ctx.get('agentDefaultModel')?.currentSelection();

      /**
       * Publish-time composition for the new agent.
       *
       * DSH 0.1.5 hands the agent to setup as the SECOND argument
       * (`AgentSetup = (agentCtx, agent) => …`, exactly how
       * `dsh-api-session-controller` and `dsh-headless` use it). Reading
       * `agentCtx.agent` instead asks the agent-scoped Cordis context for an
       * undeclared service and throws
       *
       *     cannot get property "agent" without inject
       *
       * which failed the whole `create`, rolled the unpublished session back,
       * and left the Telegram chat with a bare error and no reply.
       */
      const setup = (agentCtx, agent) => {
        installSelection(agentCtx, agent, selection);
        if (binding.sandboxMode) ctx.get('permissionPresets').set(agent.session, binding.sandboxMode);
      };

      const createSession = (sessionId) =>
        pluginCtx.agents.create({
          sessionId,
          meta: {
            cwd: binding.cwd ?? workspaceRoot,
            ...(binding.preset ? { agentPreset: binding.preset } : {}),
          },
          agentOptions: selection ? { ...selection } : undefined,
          setup,
        });

      const stored = binding.existingSession || (await ctx.get('sessionQuery').listSessions())
        .some(record => record.header.id === binding.sessionId);
      if (stored) {
        const resolved = await ctx.get('sessionController').resolveAgent(binding.sessionId);
        if (resolved.error) throw resolved.error;
        if (binding.pendingModel && binding.provider && binding.model) {
          await ctx.get('sessionController').selectModel({ sessionId: binding.sessionId, provider: binding.provider, model: binding.model });
        }
        if (binding.pendingSandboxMode) ctx.get('permissionPresets').set(resolved.agent.session, binding.pendingSandboxMode);
        await bindings.patch(target.key, { pendingModel: false, pendingSandboxMode: undefined });
        await attachWorkspace(binding);
        return resolved.agent;
      }
      const handle = await createSession(binding.sessionId);

      handles.set(binding.sessionId, handle);
      logger.info(`[dsh-telegram] agent ready ${handle.agent.id}`);
      await attachWorkspace(binding);
      return handle.agent;
    }

    /**
     * File the session under the workspace that owns its working directory.
     *
     * Without this the Web sidebar lists the conversation as "ungrouped": the
     * session is perfectly usable, it just belongs to no workspace record. The
     * attach is best-effort by design — a chat that still answers is worth more
     * than a tidy sidebar, so a failure here is logged and never propagated.
     */
    async function attachWorkspace(binding) {
      const registry = ctx.get('workspaceRegistry');
      if (!registry) return;

      const cwd = binding.cwd ?? workspaceRoot;
      try {
        // `create` is idempotent for an existing canonical path, so this both
        // adopts a known workspace and registers a new one on first use.
        const workspace = await registry.create(cwd);
        await workspace.attachSession(binding.sessionId);
      } catch (error) {
        logger.warn(
          `[dsh-telegram] session ${binding.sessionId} stays ungrouped: ${String(error)}`,
        );
      }
    }

    /**
     * Give the agent a mutable model selection, mirroring what the Web host
     * installs. Without it `/model` could not retarget a live agent.
     */
    function installSelection(agentCtx, agent, initial) {
      let picked = initial;
      const ref = {
        get current() {
          return picked;
        },
        set current(next) {
          picked = next;
        },
        assembled: undefined,
      };
      selectionRefs.set(agent, ref);
      try {
        installModelSelection(agentCtx, ref);
      } catch (error) {
        logger.warn('[dsh-telegram] model selection could not be installed', String(error));
      }
    }

    /* ---------------- inbound ---------------- */

    async function onUpdate(update) {
      if (update.callback_query) {
        const query = update.callback_query;
        if (!allowed(query.from?.id)) return;
        const target = {
          chatId: query.message?.chat.id,
          threadId: query.message?.message_thread_id ? String(query.message.message_thread_id) : undefined,
          userId: query.from?.id,
        };
        target.key = conversationKey(target.chatId, target.threadId);
        await runSerialized(target.key, async () => {
          if (await questions.handleCallback(query)) return;
          if (await approvals.handleCallback(query)) return;
          if (await commands.handleCallback(query)) return;
          await api.answerCallback(query.id);
        }, target);
        return;
      }

      const message = update.message ?? update.edited_message;
      if (!message) return;

      // `/start` is the one message an unlisted user may send: on a bot nobody
      // has claimed yet it takes ownership, and on a claimed one it is refused
      // like anything else.
      if (isStartCommand(message)) {
        if (await handleStart(message)) return;
      }

      if (!allowed(message.from?.id)) {
        await api.sendHtml(message.chat.id, translate()('denied'));
        return;
      }

      const target = {
        chatId: message.chat.id,
        threadId: message.message_thread_id ? String(message.message_thread_id) : undefined,
        replyTo: message.message_id,
        userId: message.from?.id,
      };
      target.key = conversationKey(target.chatId, target.threadId);

      // Serialize per conversation so /new completes before the next message.
      await runSerialized(target.key, () => handleMessage(message, target), target);
    }

    /**
     * Run one chat operation after everything already queued for that chat.
     *
     * Both the direct path (a command, an answer to a pending question) and the
     * debounced path (a merged burst) come through here, so a conversation's
     * order is preserved no matter which one produced the work.
     *
     * @param {string} key conversation key
     * @param {() => Promise<any>} task
     * @param {{ chatId?: string|number }} [target] where a failure is reported
     */
    function runSerialized(key, task, target) {
      const previous = chains.get(key) ?? Promise.resolve();
      const next = previous.then(task).catch((error) => {
        logger.error('[dsh-telegram] message handling failed', String(error));
        if (target?.chatId === undefined) return undefined;
        return api
          .sendHtml(
            target.chatId,
            translate()('error', escapeHtml(String(error)).slice(0, 300)),
          )
          .catch(() => {});
      });
      chains.set(key, next);
      return next;
    }

    /**
     * Deliver buffered bursts: a merged message re-enters the conversation's
     * serial queue, so it is ordered exactly like the messages it merged.
     */
    const debounce = new MessageDebouncer({
      windowMs: 0,
      logger,
      onFlush: (key, { blocks, meta }) => {
        const target = meta;
        if (!target) return;
        void runSerialized(key, () => deliver(key, blocks, target), target);
      },
    });

    async function handleMessage(message, target) {
      const text = (message.text ?? message.caption ?? '').trim();

      if (text) {
        const command = TelegramCommands.parse(text);
        const answering = questions.isAwaitingText(target.chatId);
        if (command || answering) {
          // Commands act immediately and a typed answer only makes sense on its
          // own, so anything buffered for this chat goes first and this message
          // is handled without waiting for the window.
          debounce.flush(target.key);
        }
      }

      // 1. A question awaiting a typed answer consumes this message.
      if (text && (await questions.handleText(target.chatId, text))) return;

      // 2. Slash commands belong to the channel.
      const command = text ? TelegramCommands.parse(text) : undefined;
      if (command) {
        await bindings.ensure(target.key, {
          chatId: target.chatId,
          threadId: target.threadId,
          cwd: workspaceRoot,
          preset: startup.preset,
        });
        if (await commands.handle(command, target)) return;
      }

      // 3. Everything else is agent input. A burst typed on a phone becomes
      //    one turn: buffer it for the conversation's window, then deliver.
      const blocks = await inboundBlocks(message, text);
      if (blocks.length === 0) return;

      const windowMs = Math.max(0, Number(options().debounceMs ?? 700) || 0);
      if (windowMs > 0) {
        debounce.windowMs = windowMs;
        debounce.push(target.key, blocks, target);
        return;
      }
      await deliver(target.key, blocks, target);
    }

    /**
     * Send one message's model content to its conversation's agent.
     *
     * The conversation is patched before and after `ensureAgent` so a slow
     * creation cannot lose a binding written by a parallel command.
     *
     * @param {string} key conversation key
     * @param {any[]} blocks merged model blocks
     * @param {{ chatId: string|number, threadId?: string }} target
     */
    async function deliver(key, blocks, target) {
      if (!blocks || blocks.length === 0) return;

      await bindings.patch(key, { chatId: target.chatId, threadId: target.threadId });
      const agent = await ensureAgent(target);
      await bindings.patch(key, { chatId: target.chatId, threadId: target.threadId });

      replies.claimSession(agent.id);
      logger.info(`[dsh-telegram] inbound message for ${agent.id} (chat ${target.chatId})`);
      if (options().typingIndicator !== false) typing.start(agent.id, target);
      agent.followup(userMessage(blocks));
    }

    /**
     * Build model-facing content. Photos become real image attachments when an
     * attachment service is mounted, so the agent can actually see them.
     */
    async function inboundBlocks(message, text) {
      const blocks = [];
      const t = translate();
      if (text) blocks.push({ type: 'text', text });

      const attachments = ctx.get('attachments');
      const photo = Array.isArray(message.photo) && message.photo.length > 0
        ? message.photo[message.photo.length - 1]
        : undefined;

      if (photo && attachments) {
        try {
          const file = await api.downloadFile(photo.file_id);
          const mediaType = detectImageType(file.data, file.name, file.mimeType);
          if (mediaType) {
            const ref = await attachments.saveImage({ data: file.data, mediaType, name: file.name });
            blocks.push({ type: 'image', attachment: ref });
          } else {
            // Never drop the photo silently: the model must at least learn one
            // arrived, or the user is left waiting on an answer about nothing.
            logger.warn(`[dsh-telegram] unrecognised image type (${file.mimeType}, ${file.name})`);
            blocks.push({ type: 'text', text: t('imageUnknownType') });
          }
        } catch (error) {
          logger.warn('[dsh-telegram] inbound image could not be attached', String(error));
          blocks.push({ type: 'text', text: t('imageUnreadable') });
        }
      } else if (photo) {
        blocks.push({ type: 'text', text: t('imageReceived') });
      }

      const document = message.document;
      if (document) {
        blocks.push({
          type: 'text',
          text: t(
            'fileReceived',
            document.file_name ?? t('unknownFileName'),
            document.mime_type ?? t('unknownFileType'),
            document.file_size ?? '?',
          ),
        });
      }

      if (message.voice || message.audio) {
        const audio = message.voice ?? message.audio;
        blocks.push({
          type: 'text',
          text: t('audioReceived', audio.duration ?? '?'),
        });
      }

      return blocks;
    }

    function allowed(userId) {
      // Read live: revoking access should take effect on the very next message,
      // not at the next restart.
      const list = options().allowedUsers ?? [];
      if (list.length === 0) return false;
      return list.map(String).includes(String(userId));
    }

    /**
     * A translator for the language currently configured.
     *
     * Built per call rather than captured once, so switching the language in
     * Settings reaches the very next message instead of the next restart.
     */
    function translate() {
      return translator(options().language);
    }

    /** `/start`, with or without the `@botname` suffix Telegram adds in groups. */
    function isStartCommand(message) {
      const text = (message.text ?? '').trim();
      return /^\/start(@[\w_]+)?$/i.test(text);
    }

    /**
     * Claim an unclaimed bot for whoever sent `/start` first.
     *
     * Returns whether the message was fully handled. A claim is only useful if
     * it persists, so a failed write must NOT report success — otherwise the
     * user is told they own the bot while the next restart forgets them.
     */
    async function handleStart(message) {
      const decision = decideStart(options(), message.from?.id);

      const t = translate();

      if (decision.kind === 'denied') {
        await api.sendHtml(
          message.chat.id,
          t('deniedClaimed', escapeHtml(String(message.from?.id ?? '?'))),
        );
        return true;
      }

      if (decision.kind !== 'claim') return false;

      if (!settings?.scope) {
        // Without a settings provider there is nowhere to record the claim, so
        // saying "you are the owner" would be a promise this process cannot
        // keep past its own lifetime.
        logger.warn('[dsh-telegram] /start cannot claim the bot: no settings provider');
        return false;
      }

      try {
        await settings.scope.update({ allowedUsers: [decision.userId] });
      } catch (error) {
        logger.error('[dsh-telegram] failed to record the bot owner', String(error));
        await api.sendHtml(message.chat.id, t('claimFailed', escapeHtml(decision.userId)));
        return true;
      }

      logger.info(`[dsh-telegram] bot claimed by user ${decision.userId}`);
      await api.sendHtml(message.chat.id, t('claimed', escapeHtml(decision.userId)));
      return true;
    }

    /* ---------------- registration ---------------- */

    const disposers = [];
    disposers.push(replies.attach(ctx));

    // Questions and approvals are answered through agent-scoped Cordis
    // waterfalls in DSH 0.1.5 (`user-questions/request`, `approval/request`),
    // not through the single `userQuestions.provider` slot of 0.1.0-rc.7. The
    // channel registers itself *first* on both: a request whose session is
    // bound to a Telegram chat becomes inline keyboards in that chat, and
    // anything else — another session, an unresolvable binding, a failed send —
    // calls `next()` and reaches the Web UI exactly as before.
    const channelProvider = questions.createProvider((request) => {
      const sessionId = request.agent ? String(request.agent.id) : undefined;
      return sessionId ? targetForSession(sessionId) : undefined;
    });

    const routingEnabled = startup.routeQuestions !== false;

    const questionRouting = routingEnabled
      ? installQuestionRouting({
          ctx,
          provider: channelProvider,
          resolveTarget: targetForSession,
          logger,
        })
      : { ok: false, reason: 'disabled by settings', dispose: () => {} };

    const approvalRouting = routingEnabled
      ? installApprovalRouting({
          ctx,
          approver: approvals,
          resolveTarget: targetForSession,
          logger,
        })
      : { ok: false, reason: 'disabled by settings', dispose: () => {} };

    for (const routing of [questionRouting, approvalRouting]) {
      if (routing.ok) disposers.push(routing.dispose);
    }

    if (!questionRouting.ok) {
      logger.warn(
        '[dsh-telegram] inline questions are unavailable on this build: the channel could not ' +
          'join the user-questions waterfall. Questions asked in a Telegram session will appear ' +
          'in the Web UI. (' +
          String(questionRouting.reason ?? 'unknown reason') +
          ')',
      );
    }

    await api.setCommands(COMMAND_MENU);
    await api.call('setMyCommands', { commands: COMMAND_MENU, language_code: 'ru' });
    for (const binding of Object.values(bindings.cache)) {
      if (binding.menuVersion === '0.3.0' || binding.threadId || !allowed(binding.chatId)) continue;
      const target = { chatId: binding.chatId, userId: binding.chatId, key: binding.key };
      const sent = await commands.navigation.menu(target);
      await bindings.patch(binding.key, { menuVersion: '0.3.0' });
      logger.info(`[dsh-telegram] Russian menu delivered (message ${sent.message_id})`);
    }

    const abort = new AbortController();
    const cursor = { offset: 0 };
    const polling = api
      .poll(cursor, onUpdate, abort.signal, { timeoutSeconds: 30 })
      .catch((error) => {
        if (!abort.signal.aborted) logger.error('[dsh-telegram] polling stopped', String(error));
      });

    return async () => {
      abort.abort();
      // Deliver buffered bursts before the agents go away; a merged message
      // that never left the buffer would be silently lost.
      debounce.flushAll();
      typing.stopAll();
      questions.disposeAll('the Telegram channel stopped');
      approvals.disposeAll('unavailable');
      await replies.flushAll().catch(() => {});
      for (const disposer of disposers) {
        try {
          disposer();
        } catch {
          // A failing disposer must not block the rest of teardown.
        }
      }
      const owned = [...handles.values()];
      handles.clear();
      await Promise.allSettled(owned.map((handle) => handle.dispose()));
      await polling;
      await api.dispatcher?.close();
      logger.info('[dsh-telegram] channel stopped');
    };
  });
}

/* ------------------------------------------------------------------ */

/**
 * Normalise the harness logger into a plain four-method object.
 *
 * `ctx.logger` is a factory in a full harness and may be absent in a bare
 * composition, and its instances do not always carry every level. Collapsing
 * both shapes here lets the rest of the plugin call `logger.info(...)`
 * unconditionally instead of guarding every call site — so a missing logger
 * can never silently swallow a startup failure.
 *
 * `warn`/`error` are additionally echoed to the process console: DSH registers
 * no cordis logger exporter, so host-plugin log lines end up only in the
 * harness's in-memory ring buffer and are unreachable from outside the process.
 * `dsh web` keeps stdout/stderr in $DSH_HOME/web-restart.log, so this is what
 * makes a failed Telegram turn diagnosable instead of a silent dead end.
 */
function makeLogger(ctx) {
  let base;
  try {
    base = typeof ctx.logger === 'function' ? ctx.logger('dsh-telegram') : ctx.logger;
  } catch {
    base = undefined;
  }
  const level = (levelName, fallback, echoTo) => {
    const method = base?.[levelName];
    const sink = typeof method === 'function'
      ? method.bind(base)
      : (...args) => fallback('[dsh-telegram]', ...args);
    if (!echoTo) return sink;
    return (...args) => {
      try {
        echoTo('[dsh-telegram]', ...args);
      } catch {
        /* logging must never break the channel */
      }
      return sink(...args);
    };
  };
  return {
    debug: level('debug', console.debug ?? console.log),
    info: level('info', console.log, console.log),
    warn: level('warn', console.warn, console.warn),
    error: level('error', console.error, console.error),
  };
}

async function resolveToken(ctx, ref, logger) {
  const fromEnv = process.env.TELEGRAM_BOT_TOKEN;
  const credentials = ctx.get('credentials');
  if (credentials) {
    try {
      const resolved = await credentials.resolve(credentialRef(ref));
      if (resolved?.value) return resolved.value;
    } catch (error) {
      logger.warn('[dsh-telegram] credential lookup failed', String(error));
    }
  }
  return fromEnv;
}

/**
 * A credential ref is the validated name itself (see `dsh-credentials`), so
 * this stays a plain string rather than a wrapper object.
 */
function credentialRef(name) {
  return name;
}

/**
 * Build a model-facing user message.
 *
 * `createUserMessage` is what mints the stable message id and freezes the
 * result; a hand-built object literal lacks that identity and is rejected by
 * the inbox without an error, so the message simply never reaches the model.
 *
 * `source.kind` is `user` because the author is a real human on the other end
 * of the chat — that is also what lets Harness run its user-only behavior such
 * as session title generation.
 */
function userMessage(content) {
  const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
  return createUserMessage({
    content: blocks.length > 0 ? blocks : [{ type: 'text', text: '' }],
    source: { kind: 'user' },
  });
}

/**
 * Decide an image's media type from its BYTES, then its filename, and only
 * then the declared header.
 *
 * Telegram serves photos as `application/octet-stream` — the header carries no
 * type at all. Trusting it meant every inbound photo resolved to "unsupported"
 * and was dropped without a trace. Magic bytes are also the honest answer: they
 * describe what the file actually is, not what a header claims.
 *
 * @param {Uint8Array} data raw file bytes
 * @param {string} [name] filename, used when the bytes are inconclusive
 * @param {string} [declared] the Content-Type header, trusted last
 * @returns {string|undefined} a media type the model accepts, or undefined
 */
function detectImageType(data, name, declared) {
  const bytes = data ?? new Uint8Array();
  const at = (index) => bytes[index];

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  // JPEG: FF D8 FF
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  // GIF: "GIF8"
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) return 'image/gif';
  // WebP: "RIFF" .... "WEBP"
  if (
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return 'image/webp';
  }

  const extension = /\.([a-z0-9]+)$/i.exec(String(name ?? ''))?.[1]?.toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    default:
      break;
  }

  return normalizeImageType(declared);
}

/** Normalise a declared Content-Type to a media type the model accepts. */
function normalizeImageType(mimeType) {
  const normalized = String(mimeType ?? '').split(';')[0].trim().toLowerCase();
  switch (normalized) {
    case 'image/png':
    case 'image/webp':
    case 'image/gif':
      return normalized;
    case 'image/jpg':
    case 'image/jpeg':
      return 'image/jpeg';
    default:
      return undefined;
  }
}

/**
 * Bound lazily: `@deepseek-ai/dsh-agent` is present in every harness that can
 * run this plugin, but importing it at module scope would make the plugin
 * unloadable in a composition that omits it. Without the binding `/model`
 * still works — it just cannot retarget an already-running agent.
 */
let installModelSelection = () => {
  throw new Error('model selection is unavailable in this composition');
};

try {
  const agentModule = await import('@deepseek-ai/dsh-agent');
  if (typeof agentModule.installModelSelection === 'function') {
    installModelSelection = agentModule.installModelSelection;
  }
} catch {
  // Left as the throwing stub.
}
