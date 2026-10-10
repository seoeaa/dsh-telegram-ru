/**
 * Telegram Bot API client.
 *
 * A thin, dependency-free wrapper over the HTTP API. It owns exactly three
 * concerns beyond the raw calls:
 *
 *  1. **HTML-first sending with a plain-text fallback.** A malformed entity is
 *     the one Telegram error that must never lose a message, so a rejected
 *     HTML payload is retried once as plain text.
 *  2. **Rate-limit handling.** `429` carries `retry_after`; the client sleeps
 *     and retries instead of surfacing an error the caller cannot act on.
 *  3. **Long-poll offset discipline.** The cursor advances only after a
 *     handler accepted the update, so a thrown handler re-delivers rather
 *     than silently dropping a message.
 *  4. **An explicit egress policy.** This host resolves `api.telegram.org` to
 *     IPv6 as well as IPv4 while IPv6 has no route (`curl -6` fails in a
 *     millisecond, `curl -4` answers), and the default fetch order then fails
 *     every request with `fetch failed` — the channel goes deaf and nothing in
 *     the log explains why. See {@link TelegramApi.applyNetworkPolicy}.
 */

import dns from 'node:dns';

const DEFAULT_BASE_URL = 'https://api.telegram.org';

/**
 * Hide credentials in a proxy URL before it reaches a log line.
 *
 * @param {string} url
 * @returns {string}
 */
export function redactUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      parsed.username = '***';
      parsed.password = '';
    }
    return parsed.toString();
  } catch {
    return '<unparseable url>';
  }
}

/** Telegram's hard caps. */
export const LIMITS = {
  message: 4096,
  caption: 1024,
  callbackData: 64,
  buttonRows: 100,
};

/** Error carrying the Telegram error payload for callers that branch on it. */
export class TelegramApiError extends Error {
  constructor(method, description, code, parameters) {
    super(`telegram ${method} failed: ${description}`);
    this.name = 'TelegramApiError';
    this.method = method;
    this.description = description;
    this.code = code;
    this.parameters = parameters;
  }

  /** Whether the failure is an HTML/entity parse problem worth retrying as text. */
  get isParseError() {
    return /can't parse entities|unsupported start tag|unclosed|bad entity|TAG_INVALID/i.test(
      this.description ?? '',
    );
  }

  /** Whether the message is unchanged — an expected, harmless edit outcome. */
  get isNotModified() {
    return /message is not modified/i.test(this.description ?? '');
  }

  /**
   * Whether this Bot API server does not implement the method at all.
   *
   * Distinct from a rejected payload: an unknown method is permanent for this
   * server, so the caller should stop attempting it rather than retrying per
   * message. Telegram answers a missing method with 404 "Not Found".
   */
  get isUnknownMethod() {
    return this.code === 404 || /method not found|unknown method/i.test(this.description ?? '');
  }

  /** Whether the target message no longer exists or cannot be edited. */
  get isGone() {
    return /message to edit not found|message can't be edited|MESSAGE_ID_INVALID/i.test(
      this.description ?? '',
    );
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Long-poll retry policy.
 *
 * A failed `getUpdates` is one of two very different things, and treating them
 * alike is what turns a token conflict into a silent hot loop:
 *
 * - **conflict** (HTTP 409, "terminated by other getUpdates request"): another
 *   process already polls this bot token — CoPaw/QwenPaw, a second DSH, or a
 *   webhook. Nothing this process does will help until that instance stops, so
 *   it backs off on a flat, long delay instead of hammering, and says so once.
 * - **everything else** (network, timeout, 5xx): transient, so it backs off
 *   exponentially up to a ceiling.
 *
 * Modelled on CoPaw's Telegram channel watchdog
 * (`qwenpaw/app/channels/telegram/channel.py`: `_plan_polling_reconnect`,
 * `_looks_like_polling_conflict`), which separates the same two classes.
 */
export const POLL_RETRY = {
  conflictDelayMs: 30_000,
  baseDelayMs: 2_000,
  maxDelayMs: 60_000,
  /** Minimum gap between two user-visible conflict notices. */
  noticeEveryMs: 30 * 60_000,
};

/**
 * Whether a `getUpdates` failure means another instance holds this token.
 *
 * @param {any} error
 * @returns {boolean}
 */
export function isPollingConflict(error) {
  const text = `${error?.description ?? ''} ${error?.message ?? ''}`.toLowerCase();
  return (
    error?.code === 409 ||
    text.includes('terminated by other getupdates request') ||
    text.includes('another bot instance') ||
    text.includes('conflict')
  );
}

/**
 * Classify one polling failure and plan the next attempt.
 *
 * Mutates `state` (streak counters) so the caller can log a streak, notice a
 * conflict once, and reset everything on the next successful poll.
 *
 * @param {any} error the failure from `call('getUpdates', ...)`
 * @param {{ conflicts: number, networkErrors: number }} state streak counters
 * @param {{ conflictDelayMs?: number, baseDelayMs?: number, maxDelayMs?: number }} [options]
 * @returns {{ kind: 'conflict' | 'error', attempt: number, delayMs: number }}
 */
export function planPollRetry(error, state, options = {}) {
  const policy = { ...POLL_RETRY, ...options };
  if (isPollingConflict(error)) {
    state.conflicts += 1;
    state.networkErrors = 0;
    return { kind: 'conflict', attempt: state.conflicts, delayMs: policy.conflictDelayMs };
  }
  state.networkErrors += 1;
  state.conflicts = 0;
  return {
    kind: 'error',
    attempt: state.networkErrors,
    delayMs: Math.min(policy.baseDelayMs * 2 ** (state.networkErrors - 1), policy.maxDelayMs),
  };
}

export class TelegramApi {
  /**
   * @param {string} token bot token
   * @param {{ baseUrl?: string, timeoutMs?: number, logger?: any, fetch?: typeof fetch }} [options]
   */
  constructor(token, options = {}) {
    if (!token) throw new Error('dsh-telegram: a bot token is required');
    this.token = token;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.logger = options.logger ?? console;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    /**
     * Egress policy, applied once by {@link TelegramApi.applyNetworkPolicy}:
     * `forceIPv4` puts IPv4 first in the process DNS order (this host's IPv6
     * has no route), `proxyUrl` routes the API through a proxy when the direct
     * path is blocked. `options.undici` exists so tests can inject a fake
     * module instead of depending on the harness's internal one.
     */
    this.forceIPv4 = options.forceIPv4 !== false;
    this.proxyUrl = String(options.proxyUrl ?? '');
    this.undici = options.undici;
    /** Environment the proxy fallback reads; a test seam. */
    this.env = options.env ?? process.env;
    this.dispatcher = undefined;
    this.networkApplied = false;
    /**
     * Called once per conflict streak, so the channel can tell its owner in
     * the chat that the bot token is being polled elsewhere. Sending is not
     * affected by a getUpdates conflict, which is what makes the notice useful.
     */
    this.onPollingConflict = options.onPollingConflict;
    /** Observable polling health: streaks, last error, last successful poll. */
    this.pollState = {
      conflicts: 0,
      networkErrors: 0,
      conflictsTotal: 0,
      errorsTotal: 0,
      lastError: undefined,
      lastErrorAt: undefined,
      lastOkAt: undefined,
      lastNoticeAt: undefined,
    };
  }

  /**
   * Apply the configured egress policy. Idempotent; awaited before the first
   * request (the channel does it right after construction, before `getMe`).
   *
   * The proxy comes from `telegram.proxyUrl`, or — when that is empty — from the
   * standard `HTTPS_PROXY` / `ALL_PROXY` environment variables, so a launch
   * environment that already carries a proxy needs no duplicate setting. The
   * dispatcher only ever reaches the Bot API calls of this client, never the
   * rest of the harness.
   *
   * @returns {Promise<{ forceIPv4: boolean, proxy?: string, dispatcher?: string }>}
   */
  async applyNetworkPolicy() {
    if (this.networkApplied) return this.networkHealth();
    this.networkApplied = true;

    if (this.forceIPv4) {
      try {
        dns.setDefaultResultOrder('ipv4first');
        this.logger.info?.(
          '[dsh-telegram] network: preferring IPv4 for API requests ' +
            '(set telegram.forceIPv4=false to keep the resolver order)',
        );
      } catch (error) {
        this.logger.warn?.('[dsh-telegram] network: cannot set the DNS result order', String(error));
      }
    }

    this.proxyUrl = this.proxyUrl || proxyFromEnvironment(this.env);
    if (this.proxyUrl) {
      const transport = await import('undici');
      this.fetchImpl = transport.fetch;
      this.dispatcher = new transport.ProxyAgent(this.proxyUrl);
    }

    return this.networkHealth();
  }

  /** The effective egress policy, for `/status` and the boot log. */
  networkHealth() {
    return {
      forceIPv4: this.forceIPv4,
      ...(this.proxyUrl ? { proxy: redactUrl(this.proxyUrl) } : {}),
      ...(this.dispatcher ? { dispatcher: 'active' } : {}),
    };
  }

  get endpoint() {
    return `${this.baseUrl}/bot${this.token}`;
  }

  get fileEndpoint() {
    return `${this.baseUrl}/file/bot${this.token}`;
  }

  /**
   * Invoke one Bot API method.
   *
   * @param {string} method API method name
   * @param {object|FormData} payload request body
   * @param {{ signal?: AbortSignal, timeoutMs?: number, retries?: number }} [options]
   */
  async call(method, payload = {}, options = {}) {
    const retries = options.retries ?? 3;
    let attempt = 0;

    for (;;) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? this.timeoutMs);
      const onAbort = () => controller.abort();
      options.signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const isForm = typeof FormData !== 'undefined' && payload instanceof FormData;
        const response = await this.fetchImpl(`${this.endpoint}/${method}`, {
          method: 'POST',
          headers: isForm ? undefined : { 'content-type': 'application/json' },
          body: isForm ? payload : JSON.stringify(payload),
          signal: controller.signal,
          ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
        });

        const body = await response.json().catch(() => ({
          ok: false,
          description: `non-JSON response (HTTP ${response.status})`,
        }));

        if (body.ok) return body.result;

        const error = new TelegramApiError(
          method,
          body.description ?? 'unknown error',
          body.error_code,
          body.parameters,
        );

        // 429: obey the server's own backoff instruction.
        const retryAfter = body.parameters?.retry_after;
        if (retryAfter && attempt < retries) {
          attempt += 1;
          await sleep((retryAfter + 1) * 1000);
          continue;
        }

        // 5xx: transient upstream trouble, worth one bounded retry chain.
        if (body.error_code >= 500 && attempt < retries) {
          attempt += 1;
          await sleep(500 * 2 ** attempt);
          continue;
        }

        throw error;
      } catch (error) {
        if (error instanceof TelegramApiError) throw error;
        if (options.signal?.aborted) throw error;
        if (attempt >= retries) throw error;
        attempt += 1;
        await sleep(500 * 2 ** attempt);
      } finally {
        clearTimeout(timeout);
        options.signal?.removeEventListener('abort', onAbort);
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Identity and webhook
   * ---------------------------------------------------------------- */

  getMe(options) {
    return this.call('getMe', {}, options);
  }

  deleteWebhook(options) {
    return this.call('deleteWebhook', { drop_pending_updates: false }, options);
  }

  /* ---------------------------------------------------------------- *
   * Receiving
   * ---------------------------------------------------------------- */

  /**
   * Long-poll updates, advancing the shared cursor only after `onUpdate`
   * resolves. A rejected handler leaves the offset untouched so Telegram
   * redelivers the update on the next poll.
   *
   * @param {{ offset: number }} cursor mutable shared cursor
   * @param {(update: object) => Promise<void>} onUpdate
   * @param {AbortSignal} signal
   * @param {{ timeoutSeconds?: number, allowedUpdates?: string[] }} [options]
   */
  async poll(cursor, onUpdate, signal, options = {}) {
    const timeoutSeconds = options.timeoutSeconds ?? 30;
    const allowedUpdates = options.allowedUpdates ?? ['message', 'edited_message', 'callback_query'];

    const state = this.pollState;

    while (!signal.aborted) {
      let updates;
      try {
        updates = await this.call(
          'getUpdates',
          {
            offset: cursor.offset,
            timeout: timeoutSeconds,
            allowed_updates: allowedUpdates,
          },
          { signal, timeoutMs: (timeoutSeconds + 15) * 1000, retries: 0 },
        );
      } catch (error) {
        if (signal.aborted) return;
        const plan = planPollRetry(error, state, options.retry);
        const detail = describe(error);
        state.lastError = detail;
        state.lastErrorAt = Date.now();
        const seconds = Math.round(plan.delayMs / 1000);

        if (plan.kind === 'conflict') {
          state.conflictsTotal += 1;
          if (plan.attempt === 1) {
            this.logger.warn?.(
              `[dsh-telegram] getUpdates conflict: this bot token is already being polled by ` +
                `another instance (CoPaw/QwenPaw, a second DSH, or a webhook). While that ` +
                `instance holds the token this channel receives nothing. Retrying in ${seconds}s.`,
              detail,
            );
            const policy = { ...POLL_RETRY, ...(options.retry ?? {}) };
            const due =
              state.lastNoticeAt === undefined ||
              Date.now() - state.lastNoticeAt >= policy.noticeEveryMs;
            if (due) {
              state.lastNoticeAt = Date.now();
              try {
                await this.onPollingConflict?.({ attempt: plan.attempt, detail });
              } catch (noticeError) {
                this.logger.warn?.(
                  '[dsh-telegram] could not announce the polling conflict',
                  describe(noticeError),
                );
              }
            }
          } else if (plan.attempt % 20 === 0) {
            this.logger.warn?.(
              `[dsh-telegram] getUpdates still conflicting after ${plan.attempt} attempts`,
              detail,
            );
          }
        } else {
          state.errorsTotal += 1;
          this.logger.warn?.(
            `[dsh-telegram] getUpdates failed (attempt ${plan.attempt}); retrying in ${seconds}s`,
            detail,
          );
        }

        await sleep(plan.delayMs);
        continue;
      }

      // A clean poll ends the streak: the next failure starts a fresh plan.
      state.conflicts = 0;
      state.networkErrors = 0;
      state.lastOkAt = Date.now();
      state.lastError = undefined;

      for (const update of updates ?? []) {
        if (signal.aborted) return;
        try {
          await onUpdate(update);
        } catch (error) {
          this.logger.error?.('[dsh-telegram] update handler failed', describe(error));
        }
        // Commit after dispatch so a crash mid-handler redelivers.
        if (typeof update.update_id === 'number') {
          cursor.offset = Math.max(cursor.offset, update.update_id + 1);
        }
      }
    }
  }

  /**
   * One-line polling health, for logs and operator surfaces.
   *
   * @returns {{ status: 'ok' | 'conflict' | 'error', detail: string, conflicts: number, errors: number }}
   */
  pollHealth() {
    const state = this.pollState;
    if (state.conflicts > 0) {
      return {
        status: 'conflict',
        detail:
          `another instance is polling this token (${state.conflicts} attempt(s))` +
          (state.lastError ? `: ${state.lastError}` : ''),
        conflicts: state.conflicts,
        errors: state.networkErrors,
      };
    }
    if (state.networkErrors > 0) {
      return {
        status: 'error',
        detail:
          `getUpdates failing (${state.networkErrors} attempt(s))` +
          (state.lastError ? `: ${state.lastError}` : ''),
        conflicts: 0,
        errors: state.networkErrors,
      };
    }
    const age = state.lastOkAt === undefined ? undefined : Math.round((Date.now() - state.lastOkAt) / 1000);
    return {
      status: 'ok',
      detail: age === undefined ? 'polling (no update yet)' : `polling, last update ${age}s ago`,
      conflicts: 0,
      errors: 0,
    };
  }

  /* ---------------------------------------------------------------- *
   * Sending
   * ---------------------------------------------------------------- */

  /**
   * Send one HTML message, falling back to plain text when Telegram rejects
   * the markup. `plainText` is the caller's already-stripped fallback.
   */
  async sendHtml(chatId, html, { plainText, replyTo, threadId, keyboard, signal, silent } = {}) {
    const body = {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };
    if (replyTo) body.reply_parameters = { message_id: Number(replyTo), allow_sending_without_reply: true };
    if (threadId) body.message_thread_id = Number(threadId);
    if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
    if (silent) body.disable_notification = true;

    try {
      return await this.call('sendMessage', body, { signal });
    } catch (error) {
      if (error instanceof TelegramApiError && error.isParseError) {
        this.logger.warn?.(
          '[dsh-telegram] HTML rejected, retrying as plain text',
          error.description,
        );
        const { parse_mode: _drop, ...rest } = body;
        return this.call(
          'sendMessage',
          { ...rest, text: (plainText ?? stripTags(html)).slice(0, LIMITS.message) },
          { signal },
        );
      }
      throw error;
    }
  }

  /**
   * Send one rich message: a structured document rather than a markup string.
   *
   * This is the only way to send a real table — `sendMessage` rejects
   * `<table>` outright, so the HTML path has to draw one in monospace, and that
   * drawing shears when a phone soft-wraps it.
   *
   * The method is newer than the rest of the Bot API surface, so a deployment
   * may be talking to a server that does not implement it. `richSupported`
   * records the first definitive answer: on an unknown-method error the caller
   * is told to fall back, and every later send skips the doomed round trip.
   *
   * @returns {Promise<object|undefined>} the sent message, or `undefined` when
   *   this server has no rich support and the caller must use HTML instead
   */
  async sendRich(chatId, blocks, { replyTo, threadId, keyboard, signal, silent } = {}) {
    if (this.richSupported === false) return undefined;
    if (!Array.isArray(blocks) || blocks.length === 0) return undefined;

    const body = { chat_id: chatId, rich_message: { blocks } };
    if (replyTo) body.reply_parameters = { message_id: Number(replyTo), allow_sending_without_reply: true };
    if (threadId) body.message_thread_id = Number(threadId);
    if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
    if (silent) body.disable_notification = true;

    try {
      const sent = await this.call('sendRichMessage', body, { signal });
      this.richSupported = true;
      return sent;
    } catch (error) {
      if (error instanceof TelegramApiError && error.isUnknownMethod) {
        // Permanent for this server: stop trying.
        this.richSupported = false;
        this.logger.warn?.('[dsh-telegram] sendRichMessage unavailable, using HTML');
        return undefined;
      }
      // A malformed document is our bug, not a capability limit. Report it and
      // let the caller fall back so the user still receives the answer.
      this.logger.warn?.('[dsh-telegram] rich send rejected, using HTML', describe(error));
      return undefined;
    }
  }

  /**
   * Edit one message's HTML text. `not modified` resolves quietly — it is the
   * expected outcome when a streaming preview has not changed.
   */
  async editHtml(chatId, messageId, html, { plainText, keyboard, signal } = {}) {
    const body = {
      chat_id: chatId,
      message_id: Number(messageId),
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    };
    if (keyboard) body.reply_markup = { inline_keyboard: keyboard };

    try {
      return await this.call('editMessageText', body, { signal });
    } catch (error) {
      if (error instanceof TelegramApiError && error.isNotModified) return undefined;
      if (error instanceof TelegramApiError && error.isParseError) {
        const { parse_mode: _drop, ...rest } = body;
        try {
          return await this.call(
            'editMessageText',
            { ...rest, text: (plainText ?? stripTags(html)).slice(0, LIMITS.message) },
            { signal },
          );
        } catch (retryError) {
          if (retryError instanceof TelegramApiError && retryError.isNotModified) return undefined;
          throw retryError;
        }
      }
      throw error;
    }
  }

  /** Replace only a message's inline keyboard (used to freeze answered questions). */
  async editKeyboard(chatId, messageId, keyboard, { signal } = {}) {
    try {
      return await this.call(
        'editMessageReplyMarkup',
        {
          chat_id: chatId,
          message_id: Number(messageId),
          reply_markup: keyboard ? { inline_keyboard: keyboard } : {},
        },
        { signal },
      );
    } catch (error) {
      if (error instanceof TelegramApiError && (error.isNotModified || error.isGone)) return undefined;
      throw error;
    }
  }

  /**
   * Upload one media item. `source` is either `{ data, filename }` for bytes
   * or `{ url }` for a public URL / previously uploaded `file_id`.
   */
  async sendMedia(chatId, kind, source, { caption, captionHtml, replyTo, threadId, signal } = {}) {
    const [method, field] = MEDIA_METHODS[kind] ?? MEDIA_METHODS.document;

    const attach = (append) => {
      if (caption || captionHtml) {
        append('caption', (captionHtml ?? caption).slice(0, LIMITS.caption));
        if (captionHtml) append('parse_mode', 'HTML');
      }
      if (replyTo) {
        append(
          'reply_parameters',
          JSON.stringify({ message_id: Number(replyTo), allow_sending_without_reply: true }),
        );
      }
      if (threadId) append('message_thread_id', String(threadId));
    };

    if (source.data) {
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append(
        field,
        new Blob([source.data], { type: source.mimeType ?? 'application/octet-stream' }),
        source.filename ?? defaultName(kind),
      );
      attach((key, value) => form.append(key, value));
      return this.call(method, form, { signal, timeoutMs: 120_000 });
    }

    const body = { chat_id: chatId, [field]: source.url };
    attach((key, value) => {
      body[key] = key === 'reply_parameters' ? JSON.parse(value) : value;
    });
    return this.call(method, body, { signal });
  }

  /** Send several images as one album. Only the first item carries a caption. */
  async sendMediaGroup(chatId, items, { caption, captionHtml, replyTo, threadId, signal } = {}) {
    const form = new FormData();
    form.append('chat_id', String(chatId));

    const media = items.map((item, index) => {
      const entry = { type: item.kind === 'video' ? 'video' : 'photo' };
      if (index === 0 && (caption || captionHtml)) {
        entry.caption = (captionHtml ?? caption).slice(0, LIMITS.caption);
        if (captionHtml) entry.parse_mode = 'HTML';
      }
      if (item.data) {
        const name = `file${index}`;
        entry.media = `attach://${name}`;
        form.append(
          name,
          new Blob([item.data], { type: item.mimeType ?? 'application/octet-stream' }),
          item.filename ?? defaultName(item.kind),
        );
      } else {
        entry.media = item.url;
      }
      return entry;
    });

    form.append('media', JSON.stringify(media));
    if (replyTo) {
      form.append(
        'reply_parameters',
        JSON.stringify({ message_id: Number(replyTo), allow_sending_without_reply: true }),
      );
    }
    if (threadId) form.append('message_thread_id', String(threadId));
    return this.call('sendMediaGroup', form, { signal, timeoutMs: 180_000 });
  }

  /* ---------------------------------------------------------------- *
   * Interaction
   * ---------------------------------------------------------------- */

  /** Acknowledge a callback query. Failure here must never break the flow. */
  async answerCallback(callbackQueryId, { text, alert } = {}) {
    try {
      return await this.call('answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text ? { text: text.slice(0, 200) } : {}),
        ...(alert ? { show_alert: true } : {}),
      });
    } catch {
      return undefined;
    }
  }

  /** Best-effort typing indicator. */
  async sendChatAction(chatId, action = 'typing', { threadId } = {}) {
    try {
      return await this.call('sendChatAction', {
        chat_id: chatId,
        action,
        ...(threadId ? { message_thread_id: Number(threadId) } : {}),
      });
    } catch {
      return undefined;
    }
  }

  /** Publish the bot's slash-command menu. */
  async setCommands(commands) {
    try {
      return await this.call('setMyCommands', { commands });
    } catch (error) {
      this.logger.warn?.('[dsh-telegram] setMyCommands failed', describe(error));
      return undefined;
    }
  }

  async deleteMessage(chatId, messageId) {
    try {
      return await this.call('deleteMessage', { chat_id: chatId, message_id: Number(messageId) });
    } catch {
      return undefined;
    }
  }

  /* ---------------------------------------------------------------- *
   * Files
   * ---------------------------------------------------------------- */

  getFile(fileId, options) {
    return this.call('getFile', { file_id: fileId }, options);
  }

  /** Download a file's bytes by `file_id`. */
  async downloadFile(fileId, { signal } = {}) {
    const file = await this.getFile(fileId, { signal });
    if (!file?.file_path) throw new Error('telegram getFile returned no file_path');
    const response = await this.fetchImpl(`${this.fileEndpoint}/${file.file_path}`, {
      signal,
      ...(this.dispatcher ? { dispatcher: this.dispatcher } : {}),
    });
    if (!response.ok) throw new Error(`telegram file download failed: HTTP ${response.status}`);
    const data = new Uint8Array(await response.arrayBuffer());
    return {
      data,
      name: file.file_name ?? file.file_path.split('/').pop(),
      mimeType: response.headers.get('content-type') ?? undefined,
      size: file.file_size,
    };
  }
}

const MEDIA_METHODS = {
  image: ['sendPhoto', 'photo'],
  photo: ['sendPhoto', 'photo'],
  document: ['sendDocument', 'document'],
  file: ['sendDocument', 'document'],
  audio: ['sendAudio', 'audio'],
  voice: ['sendVoice', 'voice'],
  video: ['sendVideo', 'video'],
  animation: ['sendAnimation', 'animation'],
};

function defaultName(kind) {
  switch (kind) {
    case 'image':
    case 'photo':
      return 'image.png';
    case 'audio':
      return 'audio.mp3';
    case 'voice':
      return 'voice.ogg';
    case 'video':
      return 'video.mp4';
    default:
      return 'file.bin';
  }
}

function stripTags(html) {
  return String(html)
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}

/**
/**
 * The proxy the launch environment already names, if any.
 *
 * Standard variables, in the order every other tool reads them. `telegram.proxyUrl`
 * wins over these when it is set, so an explicit channel choice is never
 * overridden by an inherited environment.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string} the proxy URL, or an empty string
 */
export function proxyFromEnvironment(env = process.env) {
  for (const name of ['HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy']) {
    const value = env?.[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * One-line description of a failure, including the transport cause.
 *
 * undici reports every socket problem as `fetch failed` and hides the reason in
 * `error.cause` (`ENETUNREACH`, `ECONNREFUSED`, `EAI_AGAIN`, …). That code is
 * the difference between "the bot is broken" and "this host has no route to
 * Telegram", so it is part of the message.
 *
 * @param {any} error
 * @returns {string}
 */
export function describe(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  const code = cause?.code ?? cause?.errno;
  const causeMessage = cause?.message;
  const suffix = code ? ` (${code}${causeMessage && causeMessage !== code ? `: ${causeMessage}` : ''})` : '';
  return `${error.message}${suffix}`;
}
