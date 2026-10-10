/**
 * Telegram-backed approval answerer.
 *
 * A tool that needs a human decision (`approval/request`, e.g. a sandbox
 * escalation) asks the answerer chain and waits for one of four outcomes:
 * `allowed-once`, `rejected`, `cancelled` or `unavailable`. In a web profile
 * the Web UI answers, so a decision raised while the owner is on a phone is
 * invisible: the turn simply stops.
 *
 * This module answers for sessions the channel owns, with two buttons. It is
 * deliberately small — one decision per message, no free text, no batching —
 * because an approval is a yes/no question and the interesting failure is
 * silence, not nuance.
 *
 * Design decisions:
 *
 * - **Callback data is a short token.** Telegram caps `callback_data` at 64
 *   bytes; the decision itself travels as `y`/`n` next to a random token.
 * - **The keyboard is frozen on decision**, so a stale button cannot decide
 *   twice and the transcript records what was chosen.
 * - **Abort is `cancelled`, not `rejected`.** A withdrawn request must not read
 *   as the human saying no.
 * - **Delivery failure is not an answer.** The caller rethrows, and the router
 *   hands the request to the Web UI instead of failing the tool.
 */

import { escapeHtml } from './markdown.js';

const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function shortId(length = 6) {
  let id = '';
  for (let i = 0; i < length; i += 1) {
    id += TOKEN_ALPHABET[Math.floor(Math.random() * TOKEN_ALPHABET.length)];
  }
  return id;
}

/** Truncate a button label to Telegram's practical width. */
function buttonLabel(text, max = 60) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

export class TelegramApprovals {
  /**
   * @param {{ api: any, logger?: any, translate?: () => (key: string, ...args: unknown[]) => string }} options
   */
  constructor(options) {
    this.api = options.api;
    this.logger = options.logger ?? console;
    /** Translator factory from the channel; falls back to the key itself. */
    this.translate = typeof options.translate === 'function' ? options.translate : () => (key) => key;
    /** token -> pending decision */
    this.pending = new Map();
  }

  /**
   * Ask for one decision in a chat.
   *
   * @param {{ chatId: string|number, threadId?: string }} target
   * @param {{ toolName?: string, reason?: string, signal?: AbortSignal }} request
   * @returns {Promise<'allowed-once' | 'rejected' | 'cancelled'>}
   */
  async ask(target, request) {
    const t = this.translate();
    const token = shortId();

    const lines = [`<b>${t('approvalTitle')}</b>`];
    lines.push(t('approvalTool', escapeHtml(String(request.toolName ?? '?'))));
    if (request.reason) lines.push(t('approvalReason', escapeHtml(String(request.reason))));

    const keyboard = [
      [
        { text: buttonLabel(t('approvalAllow')), callback_data: `ap:${token}:y` },
        { text: buttonLabel(t('approvalDeny')), callback_data: `ap:${token}:n` },
      ],
    ];

    const sent = await this.api.sendHtml(target.chatId, lines.join('\n'), {
      threadId: target.threadId,
      keyboard,
    });

    return new Promise((resolve) => {
      const state = {
        token,
        chatId: String(target.chatId),
        messageId: sent.message_id,
        resolve,
        settled: false,
      };

      const finish = (outcome, label) => {
        if (state.settled) return;
        state.settled = true;
        this.pending.delete(token);
        request.signal?.removeEventListener('abort', onAbort);
        void this.freeze(state, label);
        resolve(outcome);
      };

      state.finish = finish;

      const onAbort = () => finish('cancelled', t('approvalCancelled'));

      request.signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(token, state);
    });
  }

  /**
   * Handle one `callback_query`. Returns true when it belonged to an approval.
   */
  async handleCallback(query) {
    const t = this.translate();
    const data = String(query.data ?? '');
    if (!data.startsWith('ap:')) return false;

    const [, token, action] = data.split(':');
    const state = this.pending.get(token);

    if (!state) {
      await this.api.answerCallback(query.id, { text: t('approvalStale') });
      return true;
    }

    const allowed = action === 'y';
    const label = t(allowed ? 'approvalAllowed' : 'approvalRejected');
    await this.api.answerCallback(query.id, { text: label });
    state.finish(allowed ? 'allowed-once' : 'rejected', label);
    return true;
  }

  /** Replace a settled request's keyboard with its recorded decision. */
  async freeze(state, label) {
    try {
      await this.api.editKeyboard(state.chatId, state.messageId, [
        [{ text: buttonLabel(label, 64), callback_data: 'ap:done:noop' }],
      ]);
    } catch (error) {
      this.logger.warn?.('[dsh-telegram] failed to freeze approval keyboard', String(error));
    }
  }

  /** Settle every pending decision — used on plugin unload. */
  disposeAll(outcome = 'unavailable') {
    for (const state of [...this.pending.values()]) state.finish(outcome, outcome);
    this.pending.clear();
  }
}
