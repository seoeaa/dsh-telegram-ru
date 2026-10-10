/**
 * Keep a chat's "typing…" alive for the whole turn.
 *
 * Telegram clears a chat action after about five seconds, so the one
 * `sendChatAction` the channel used to fire before `followup()` covered only
 * the first seconds of a turn — a long tool-heavy turn then looked like a dead
 * bot with a sent message. This keeper re-sends the action on a short interval
 * until the turn ends.
 *
 * Stopping is the hard part, so every path is covered:
 *
 * - the reply router stops it on `turn/end`, whichever way the turn ended
 *   (answer, error, cancellation);
 * - `/new` stops the session it rotates away from;
 * - unloading the channel stops everything;
 * - a wall-clock cap stops it anyway, because a turn whose end event never
 *   arrives (a crashed loop, an update the router does not see) must not leave
 *   one chat "typing" forever.
 *
 * The timer is unref'd so it can never hold the process open by itself.
 */
export class TypingKeeper {
  /**
   * @param {{ api: any, logger?: any, intervalMs?: number, maxMs?: number }} options
   */
  constructor(options = {}) {
    this.api = options.api;
    this.logger = options.logger ?? console;
    this.intervalMs = options.intervalMs ?? 4_500;
    this.maxMs = options.maxMs ?? 10 * 60_000;
    /** sessionId -> { timer, cap, chatId, threadId } */
    this.active = new Map();
  }

  /** Start (or restart) the indicator for one session's chat. */
  start(sessionId, target) {
    if (!sessionId || !target || !this.api) return;
    const key = String(sessionId);
    this.stop(key);

    const send = () => {
      void this.api
        .sendChatAction(target.chatId, 'typing', { threadId: target.threadId })
        .catch((error) => {
          this.logger.debug?.('[dsh-telegram] typing action failed', String(error));
        });
    };

    send();
    const timer = setInterval(send, this.intervalMs);
    timer.unref?.();

    const cap = setTimeout(() => {
      this.logger.warn?.(
        `[dsh-telegram] typing indicator for ${key} stopped after ` +
          `${Math.round(this.maxMs / 1000)}s without a turn end`,
      );
      this.stop(key);
    }, this.maxMs);
    cap.unref?.();

    this.active.set(key, { timer, cap, chatId: target.chatId, threadId: target.threadId });
  }

  /** Stop the indicator for one session. Idempotent. */
  stop(sessionId) {
    const key = String(sessionId);
    const entry = this.active.get(key);
    if (!entry) return;
    this.active.delete(key);
    clearInterval(entry.timer);
    clearTimeout(entry.cap);
  }

  /** Stop every indicator — used on channel unload. */
  stopAll() {
    for (const key of [...this.active.keys()]) this.stop(key);
  }

  /** How many chats currently show "typing…" (diagnostics and tests). */
  get size() {
    return this.active.size;
  }
}
