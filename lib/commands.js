/**
 * In-chat control commands.
 *
 * These are handled by the channel itself rather than registered with
 * `ctx.commands`, because they must work before an agent exists (`/new` on a
 * fresh chat) and they answer through Telegram's own affordances — inline
 * keyboards for choices instead of a text prompt.
 *
 * `/model` and `/preset` present their choices as buttons; the selection is
 * applied through the same seams the Web UI uses:
 *   - model  -> `sessionController.selectModel`
 *   - mode   -> `permissionPresets.set`
 *   - preset -> recorded for the next session (a live agent cannot swap presets)
 */

import { escapeHtml } from './markdown.js';
import { translator } from './i18n.js';
import { TelegramNavigation } from './navigation.js';

/** Sandbox modes offered by `/mode`, in increasing order of permission. */
const SANDBOX_MODES = [
  { id: 'read-only', label: 'modeReadLabel', description: 'modeReadDescription' },
  { id: 'workspace-write', label: 'modeWorkspaceLabel', description: 'modeWorkspaceDescription' },
  { id: 'danger-full-access', label: 'modeFullLabel', description: 'modeFullDescription' },
];

const PRESET_LABELS = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  ptc: { name: 'presetPtcName', description: 'presetPtcDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
};

const COMMAND_DEFINITIONS = [
  { command: 'menu', description: 'commandMenu' },
  { command: 'projects', description: 'commandProjects' },
  { command: 'tasks', description: 'commandTasks' },
  { command: 'done', description: 'commandDone' },
  { command: 'result', description: 'commandResult' },
  { command: 'start', description: 'commandStart' },
  { command: 'new', description: 'commandNew' },
  { command: 'model', description: 'commandModel' },
  { command: 'preset', description: 'commandPreset' },
  { command: 'mode', description: 'commandMode' },
  { command: 'status', description: 'commandStatus' },
  { command: 'stop', description: 'commandStop' },
  { command: 'compact', description: 'commandCompact' },
  { command: 'clear', description: 'commandClear' },
  { command: 'help', description: 'commandHelp' },
];

/** Bot command identifiers stay stable across languages. */
export function commandMenu(language) {
  const t = translator(language);
  return COMMAND_DEFINITIONS.map(entry => ({ ...entry, description: t(entry.description) }));
}
export const COMMAND_MENU = commandMenu('ru');

export class TelegramCommands {
  /**
   * @param {{
   *   api: any, ctx: any, logger?: any,
   *   bindings: any, sessions: any,
   *   startNewSession: Function,
   *   getAgent: Function,
   * }} options
   */
  constructor(options) {
    this.translate = options.translate ?? (() => translator());
    this.api = options.api;
    this.ctx = options.ctx;
    this.logger = options.logger ?? console;
    this.bindings = options.bindings;
    this.startNewSession = options.startNewSession;
    this.getAgent = options.getAgent;
    this.navigation = new TelegramNavigation(this, options);
    /** token -> pending choice state, addressed by inline-keyboard callbacks. */
    this.pending = new Map();
  }

  /** Parse `/name rest` including the `/name@botusername` form Telegram uses in groups. */
  static parse(text) {
    const match = /^\/([a-zA-Z][a-zA-Z0-9_]*)(?:@[\w_]+)?(?:\s+([\s\S]*))?$/.exec(String(text).trim());
    if (!match) return undefined;
    return { name: match[1].toLowerCase(), rest: (match[2] ?? '').trim() };
  }

  /**
   * Execute a command. Returns true when it was handled (and therefore must
   * not reach the agent).
   */
  async handle(command, target) {
    const handler = this[`cmd_${command.name}`];
    if (typeof handler !== 'function') return false;
    try {
      await handler.call(this, command, target);
    } catch (error) {
      this.logger.error?.(`[dsh-telegram] /${command.name} failed`, String(error));
      await this.reply(target, this.t('commandFailed', escapeHtml(command.name), escapeHtml(String(error))));
    }
    return true;
  }

  t(key, ...args) { return this.translate()(key, ...args); }

  sandboxModes() {
    return SANDBOX_MODES.map(mode => ({ ...mode, label: this.t(mode.label), description: this.t(mode.description) }));
  }

  reply(target, html, keyboard) {
    return this.api.sendHtml(target.chatId, html, { threadId: target.threadId, keyboard });
  }

  /* ------------------------------------------------------------------ */

  async cmd_help(command, target) {
    const lines = [
      this.t('helpTitle'),
      '',
      ...COMMAND_DEFINITIONS.map((entry) => `/${entry.command} — ${escapeHtml(this.t(entry.description))}`),
      '',
      this.t('helpHint'),
    ];
    await this.reply(target, lines.join('\n'));
  }

  async cmd_start(command, target) { return this.navigation.menu(target); }
  async cmd_menu(command, target) { return this.navigation.menu(target); }
  async cmd_projects(command, target) { return this.navigation.projects(target); }
  async cmd_tasks(command, target) { return this.navigation.tasks(target); }
  async cmd_done(command, target) { return this.navigation.tasks(target, true); }
  async cmd_result(command, target) { return this.navigation.result(target); }

  async cmd_new(command, target) {
    const sessionId = await this.startNewSession(target, command.rest);
    await this.reply(
      target,
      this.t('newTaskCreated', escapeHtml(String(sessionId).slice(0, 20))),
    );
  }

  async cmd_clear(command, target) {
    return this.cmd_new(command, target);
  }

  async cmd_status(command, target) {
    const binding = await this.bindings.get(target.key);
    if (!binding) {
      await this.reply(target, this.t('noTaskSelected'));
      return;
    }
    const agent = this.getAgent(binding.sessionId);
    const selection = binding.provider && binding.model ? binding : this.currentSelection(agent);
    const preset = (agent && this.ctx.get('agentPresets')?.composedPreset(agent.ctx)) ?? binding.preset ?? this.t('defaultValue');
    const row = (await this.navigation.rows(target)).find(row => row.sessionId === binding.sessionId);
    const state = row ? (await this.navigation.inspect(row)).status : this.t('awaitingDescription');
    const mode = agent ? this.ctx.get('permissionPresets').current(agent.session) : binding.sandboxMode ?? this.defaultSandboxMode();

    const lines = [
      this.t('statusTitle'),
      '',
      this.t('statusTask', escapeHtml(String(binding.sessionId).slice(0, 24))),
      this.t('statusState', state),
      this.t('statusModel', escapeHtml(selection ? `${selection.provider}/${selection.model}` : this.t('tokenUnknown'))),
      this.t('statusPreset', escapeHtml(preset)),
      this.t('statusPermissions', escapeHtml(mode)),
      this.t('statusFolder', escapeHtml(binding.cwd ?? this.t('defaultValue'))),
    ];
    await this.reply(target, lines.join('\n'));
  }

  async cmd_stop(command, target) {
    const binding = await this.bindings.get(target.key);
    const agent = binding && this.getAgent(binding.sessionId);
    if (!agent) {
      await this.reply(target, this.t('noRunningResponse'));
      return;
    }
    agent.cancel({ kind: 'user' });
    await this.reply(target, this.t('stopRequested'));
  }

  async cmd_compact(command, target) {
    const binding = await this.bindings.get(target.key);
    const agent = binding && this.getAgent(binding.sessionId);
    if (!agent) {
      await this.reply(target, this.t('noConversationToCompact'));
      return;
    }
    const compaction = this.ctx.get('agentPresets')?.serviceFor(agent, 'compaction');
    if (!compaction) {
      await this.reply(target, this.t('compactionUnavailable'));
      return;
    }
    await this.reply(target, this.t('compacting'));
    const controller = new AbortController();
    const result = await compaction.compactNow(agent, controller.signal);
    await this.reply(
      target,
      result ? this.t('compacted') : this.t('compactionUnnecessary'),
    );
  }

  /* ---------------------------- model ------------------------------ */

  async cmd_model(command, target) {
    const llm = this.ctx.get('llm');
    if (!llm) {
      await this.reply(target, this.t('modelsUnavailable'));
      return;
    }

    // `/model provider/model` applies directly, skipping the picker.
    if (command.rest) {
      await this.applyModel(target, command.rest);
      return;
    }

    const providers = llm.listProviders();
    const choices = [];
    for (const provider of providers) {
      let models = [];
      try {
        models = await llm.listModels(provider.id);
      } catch (error) {
        this.logger.warn?.(`[dsh-telegram] listModels(${provider.id}) failed`, String(error));
      }
      for (const model of models) {
        choices.push({ provider: provider.id, model: model.id, label: `${provider.displayName ?? provider.id} · ${model.name ?? model.id}` });
      }
      if (models.length === 0) {
        choices.push({ provider: provider.id, model: undefined, label: this.t('modelNameNeeded', provider.displayName ?? provider.id) });
      }
    }

    if (choices.length === 0) {
      await this.reply(target, this.t('noProviders'));
      return;
    }

    const binding = await this.bindings.get(target.key);
    const agent = binding && this.getAgent(binding.sessionId);
    const current = this.currentSelection(agent);
    const token = this.stash({ kind: 'model', choices, target });

    const keyboard = choices.slice(0, 40).map((choice, index) => [
      {
        text:
          current && current.provider === choice.provider && current.model === choice.model
            ? `✅ ${choice.label}`
            : choice.label,
        callback_data: `c:${token}:${index}`,
      },
    ]);

    await this.reply(
      target,
      [
        this.t('modelTitle'),
        '',
        current
          ? this.t('currentValue', escapeHtml(`${current.provider}/${current.model}`))
          : this.t('modelUnknown'),
        '',
        this.t('modelHint'),
      ].join('\n'),
      keyboard,
    );
  }

  async applyModel(target, spec) {
    const separator = spec.indexOf('/');
    const provider = separator > 0 ? spec.slice(0, separator) : undefined;
    const model = separator > 0 ? spec.slice(separator + 1) : spec;
    if (!provider || !model) {
      await this.reply(target, this.t('modelFormat'));
      return;
    }
    await this.selectModel(target, provider, model);
  }

  async selectModel(target, provider, model) {
    const llm = this.ctx.get('llm');
    let resolved;
    try {
      resolved = await llm.resolveCallConfig({ provider, model });
    } catch (error) {
      await this.reply(target, this.t('modelUnavailable', escapeHtml(String(error))));
      return;
    }

    const selection = { provider: resolved.provider, model: resolved.model };
    const binding = await this.bindings.get(target.key);
    const agent = binding && this.getAgent(binding.sessionId);

    let applied = false;
    if (agent) {
      await this.ctx.get('sessionController').selectModel({ sessionId: binding.sessionId, ...selection });
      const ref = this.selectionRefs?.get(agent);
      if (ref) ref.current = selection;
      applied = true;
    }

    await this.bindings.patch(target.key, { model: selection.model, provider: selection.provider, pendingModel: !applied });

    await this.reply(
      target,
      [
        this.t('modelSelected', escapeHtml(`${selection.provider}/${selection.model}`)),
        applied
          ? this.t('appliedToTask')
          : this.t('appliesNextResponse'),
      ].join('\n'),
    );
  }

  /* ---------------------------- preset ----------------------------- */

  async cmd_preset(command, target) {
    const presets = this.ctx.get('agentPresets');
    if (!presets) {
      await this.reply(target, this.t('presetsUnavailable'));
      return;
    }

    const available = (await presets.list()).map(preset => ({ ...preset, ...Object.fromEntries(Object.entries(PRESET_LABELS[preset.id] ?? {}).map(([key, value]) => [key, this.t(value)])) }));
    const usable = available.filter((preset) => !preset.broken);
    if (usable.length === 0) {
      await this.reply(target, this.t('noPresets'));
      return;
    }

    if (command.rest) {
      const chosen = usable.find((preset) => preset.id === command.rest);
      if (!chosen) {
        await this.reply(
          target,
          this.t('presetNotFound', escapeHtml(command.rest), usable.map((p) => p.id).join(', ')),
        );
        return;
      }
      await this.applyPreset(target, chosen.id);
      return;
    }

    const binding = await this.bindings.get(target.key);
    const token = this.stash({ kind: 'preset', choices: usable.map((p) => ({ id: p.id, label: p.name ?? p.id })), target });

    const keyboard = usable.map((preset, index) => [
      {
        text: binding?.preset === preset.id ? `✅ ${preset.name ?? preset.id}` : (preset.name ?? preset.id),
        callback_data: `c:${token}:${index}`,
      },
    ]);

    await this.reply(
      target,
      [
        this.t('presetTitle'),
        '',
        ...usable.map((preset) => `• <b>${escapeHtml(preset.name ?? preset.id)}</b> — ${escapeHtml(preset.description ?? preset.id)}`),
        '',
        this.t('presetHint'),
      ].join('\n'),
      keyboard,
    );
  }

  async applyPreset(target, presetId) {
    await this.bindings.patch(target.key, { preset: presetId });
    await this.reply(
      target,
      this.t('presetSelected', escapeHtml(presetId)),
    );
  }

  /* ----------------------------- mode ------------------------------ */

  async cmd_mode(command, target) {
    if (command.rest) {
      const chosen = this.sandboxModes().find((mode) => mode.id === command.rest);
      if (!chosen) {
        await this.reply(target, this.t('unknownPermissions', this.sandboxModes().map((m) => m.id).join(', ')));
        return;
      }
      await this.applyMode(target, chosen.id);
      return;
    }

    const binding = await this.bindings.get(target.key);
    const agent = binding && this.getAgent(binding.sessionId);
    const current = agent ? this.ctx.get('permissionPresets').current(agent.session) : binding?.sandboxMode ?? this.defaultSandboxMode();
    const token = this.stash({ kind: 'mode', choices: this.sandboxModes(), target });

    const keyboard = this.sandboxModes().map((mode, index) => [
      { text: current === mode.id ? `✅ ${mode.label}` : mode.label, callback_data: `c:${token}:${index}` },
    ]);

    await this.reply(
      target,
      [
        this.t('permissionsTitle'),
        '',
        ...this.sandboxModes().map((mode) => `• <b>${escapeHtml(mode.label)}</b> — ${escapeHtml(mode.description)}`),
        '',
        current ? this.t('currentValue', escapeHtml(current)) : '',
      ]
        .filter(Boolean)
        .join('\n'),
      keyboard,
    );
  }

  async applyMode(target, modeId) {
    await this.bindings.patch(target.key, { sandboxMode: modeId, pendingSandboxMode: modeId });
    const binding = await this.bindings.get(target.key);
    const agent = binding && this.getAgent(binding.sessionId);
    if (agent) {
      this.ctx.get('permissionPresets').set(agent.session, modeId);
      await this.bindings.patch(target.key, { pendingSandboxMode: undefined });
    }
    await this.reply(target, this.t('permissionsSelected', escapeHtml(modeId)));
  }

  defaultSandboxMode() {
    return this.ctx.get('permissionPresets').defaultPreset;
  }

  currentSelection(agent) {
    if (agent) {
      const ref = this.selectionRefs?.get(agent);
      if (ref?.current) return ref.current;
      const header = agent.session.requestHeader?.()?.config;
      if (header) return { provider: header.provider, model: header.model };
    }
    return this.ctx.get('agentDefaultModel')?.currentSelection();
  }

  /* --------------------------- callbacks --------------------------- */

  stash(state) {
    const token = Math.random().toString(36).slice(2, 8);
    this.pending.set(token, state);
    // Choice keyboards are short-lived; drop them after ten minutes.
    setTimeout(() => this.pending.delete(token), 10 * 60_000).unref?.();
    return token;
  }

  /** Handle a `c:` callback produced by a command keyboard. */
  async handleCallback(query) {
    if (await this.navigation.handleCallback(query)) return true;
    const data = String(query.data ?? '');
    if (!data.startsWith('c:')) return false;

    const [, token, indexText] = data.split(':');
    const state = this.pending.get(token);
    if (!state) {
      await this.api.answerCallback(query.id, { text: this.t('choiceExpired') });
      return true;
    }

    if (String(query.message?.chat.id) !== String(state.target.chatId) ||
        String(query.from?.id) !== String(state.target.userId) ||
        String(query.message?.message_thread_id ?? '') !== String(state.target.threadId ?? '')) {
      await this.api.answerCallback(query.id, { text: this.t('menuOtherUser') });
      return true;
    }
    const index = Number(indexText);
    const choice = Number.isInteger(index) && index >= 0 ? state.choices[index] : undefined;
    if (!choice) {
      await this.api.answerCallback(query.id, { text: this.t('choiceUnavailable') });
      return true;
    }

    this.pending.delete(token);
    await this.api.answerCallback(query.id, { text: choice.label ?? choice.id });
    await this.api.editKeyboard(state.target.chatId, query.message?.message_id, [
      [{ text: `✅ ${choice.label ?? choice.id}`, callback_data: 'c:done:noop' }],
    ]);

    if (state.kind === 'model') {
      if (!choice.model) {
        await this.reply(state.target, this.t('modelNamePrompt', escapeHtml(choice.provider)));
        return true;
      }
      await this.selectModel(state.target, choice.provider, choice.model);
    } else if (state.kind === 'preset') {
      await this.applyPreset(state.target, choice.id);
    } else if (state.kind === 'mode') {
      await this.applyMode(state.target, choice.id);
    }

    return true;
  }
}
