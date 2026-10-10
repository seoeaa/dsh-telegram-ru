/**
 * Route each question and each approval to the surface its session belongs to.
 *
 * DSH 0.1.0-rc.7 asked a single `userQuestions.provider` to answer, and the web
 * profile's bridge registered first — which is why the original channel tried to
 * *steal the slot* and hand it back for foreign sessions.
 *
 * DSH 0.1.5 replaced that slot with two agent-scoped Cordis **waterfalls**:
 *
 *   'user-questions/request'(request, next) -> Promise<AskUserQuestionAnswer>
 *   'approval/request'(request, next)       -> Promise<ApprovalOutcome>
 *
 * Every answerer is now a *listener*: return a value to claim the request, or
 * call `next()` to delegate. The Web bridge (`@deepseek-ai/dsh-api-remotes`) is
 * one such listener, registered on the root context, so the old
 * `userQuestions.registerProvider(...)` call is simply gone — with it the
 * channel died at boot with
 *
 *     TypeError: userQuestions.registerProvider is not a function
 *
 * and every question asked during a Telegram turn was answered in the browser
 * while the bot sat silent.
 *
 * This module installs the channel as a **prepended** listener on both
 * waterfalls: a request whose agent is bound to a Telegram chat is answered
 * with inline keyboards in that chat; everything else — including any session
 * the binding lookup cannot resolve, and any delivery failure — calls `next()`
 * and reaches the Web UI exactly as before. Uncertainty routes to the browser,
 * never to a silent drop.
 */

/**
 * Resolve the Telegram target for one waterfall request.
 *
 * @param {(sessionId: string) => unknown} resolveTarget
 * @param {any} request the waterfall request (`agent` carries the session id)
 * @param {any} [logger]
 * @returns {unknown} the target, or a falsy value when the session is not ours
 */
function targetOf(resolveTarget, request, logger) {
  try {
    const agent = request?.agent;
    const sessionId = agent ? String(agent.id) : undefined;
    return sessionId && resolveTarget ? resolveTarget(sessionId) : undefined;
  } catch (error) {
    // A lookup failure must not strand the request: defer to the next answerer,
    // which is where it would have gone without this plugin.
    logger?.warn?.('[dsh-telegram] surface routing lookup failed; deferring', String(error));
    return undefined;
  }
}

/**
 * Register one prepended waterfall listener.
 *
 * @param {object} params
 * @param {any} params.ctx the channel's context (an `on` root listener sees
 *   agent-scoped dispatches, exactly like the Web bridge does)
 * @param {string} params.event waterfall event name
 * @param {string} params.label human-readable surface name for the log
 * @param {Function} params.handler `(request, next) => Promise<value>`
 * @param {any} [params.logger]
 * @returns {{ ok: boolean, reason?: string, dispose: () => void }}
 */
function installWaterfall({ ctx, event, label, handler, logger }) {
  const noop = { ok: false, reason: 'unavailable', dispose: () => {} };
  if (typeof ctx?.on !== 'function') return noop;

  let dispose;
  try {
    // Prepended: the Web bridge is registered first at boot, and a waterfall
    // stops at the first answerer that returns a value.
    dispose = ctx.on(event, handler, { prepend: true });
  } catch (error) {
    logger?.warn?.(`[dsh-telegram] ${label} routing could not register`, String(error));
    return { ok: false, reason: String(error), dispose: () => {} };
  }

  logger?.info?.(
    `[dsh-telegram] ${label} routing active: Telegram sessions answer in Telegram, ` +
      'every other session keeps answering in the Web UI',
  );

  let disposed = false;
  return {
    ok: true,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      try {
        dispose?.();
      } catch {
        /* cordis unwinds fibers more than once; a second call must not throw */
      }
    },
  };
}

/**
 * Install session-aware routing for `ask_user_question`.
 *
 * @param {object} params
 * @param {any} params.ctx the channel's context
 * @param {{ ask: (request: any) => Promise<any> }} params.provider this
 *   channel's question provider (already bound to a target resolver)
 * @param {(sessionId: string) => unknown} params.resolveTarget
 * @param {any} [params.logger]
 */
export function installQuestionRouting({ ctx, provider, resolveTarget, logger }) {
  if (!provider) return { ok: false, reason: 'no-provider', dispose: () => {} };

  const handler = async function (request, next) {
    const target = targetOf(resolveTarget, request, logger);
    if (!target) return next();
    logger?.info?.(
      `[dsh-telegram] question routed to chat ${target.chatId}` +
        `${target.threadId ? ` (thread ${target.threadId})` : ''}`,
    );
    try {
      return await provider.ask(request);
    } catch (error) {
      // An aborted request was withdrawn by its owner: rethrow so the caller
      // sees the cancellation it caused, rather than asking the browser.
      if (request?.signal?.aborted) throw error;
      logger?.warn?.(
        '[dsh-telegram] question could not be delivered to Telegram; deferring to the Web UI',
        String(error),
      );
      return next();
    }
  };

  return installWaterfall({ ctx, event: 'user-questions/request', label: 'question', handler, logger });
}

/**
 * Install session-aware routing for approvals (sandbox escalations, hooks).
 *
 * @param {object} params
 * @param {any} params.ctx the channel's context
 * @param {{ ask: (target: any, request: any) => Promise<string> }} params.approver
 *   the Telegram approval answerer (`TelegramApprovals`)
 * @param {(sessionId: string) => unknown} params.resolveTarget
 * @param {any} [params.logger]
 */
export function installApprovalRouting({ ctx, approver, resolveTarget, logger }) {
  if (!approver) return { ok: false, reason: 'no-approver', dispose: () => {} };

  const handler = async function (request, next) {
    const target = targetOf(resolveTarget, request, logger);
    if (!target) return next();
    logger?.info?.(
      `[dsh-telegram] approval routed to chat ${target.chatId}` +
        `${target.threadId ? ` (thread ${target.threadId})` : ''}`,
    );
    try {
      return await approver.ask(target, request);
    } catch (error) {
      if (request?.signal?.aborted) return 'cancelled';
      logger?.warn?.(
        '[dsh-telegram] approval could not be delivered to Telegram; deferring to the Web UI',
        String(error),
      );
      return next();
    }
  };

  return installWaterfall({ ctx, event: 'approval/request', label: 'approval', handler, logger });
}
