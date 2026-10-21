import { randomBytes } from 'node:crypto';
import { escapeHtml } from './markdown.js';

const PAGE_SIZE = 8;
const STATUS = {
  completed: 'stateCompleted', error: 'stateError', aborted: 'stateAborted',
  interrupted: 'stateInterrupted', blocked: 'stateBlocked',
  'max-tokens': 'stateMaxTokens', forked: 'stateForked',
};
const textOf = (message) => typeof message?.content === 'string' ? message.content : (message?.content ?? [])
  .filter(block => block.type === 'text').map(block => block.text).join('\n');

/** Projects and task history use the same Host services as the Web UI. */
export class TelegramNavigation {
  constructor(commands, { selectSession }) {
    this.commands = commands;
    this.ctx = commands.ctx;
    this.selectSession = selectSession;
    this.pending = new Map();
  }

  button(target, text, action) {
    const token = randomBytes(9).toString('hex');
    this.pending.set(token, { target, action, expires: Date.now() + 600_000 });
    for (const [key, value] of this.pending) {
      if (value.expires < Date.now()) this.pending.delete(key);
    }
    return { text, callback_data: `n:${token}` };
  }

  async menu(target) {
    const binding = await this.commands.bindings.get(target.key);
    const workspace = this.ctx.get('workspaceRegistry').list().find(w => w.path === binding?.cwd);
    const html = this.commands.t('menuTitle') +
      this.commands.t('menuProject', escapeHtml(workspace?.title ?? binding?.cwd ?? this.commands.t('projectNone'))) +
      this.commands.t('menuHint');
    const actions = [
      [[this.commands.t('buttonProjects'), () => this.projects(target)], [this.commands.t('buttonTasks'), () => this.tasks(target)]],
      [[this.commands.t('buttonDone'), () => this.tasks(target, true)], [this.commands.t('buttonResult'), () => this.result(target)]],
      [[this.commands.t('buttonNew'), () => this.commands.cmd_new({ rest: '' }, target)], [this.commands.t('buttonStatus'), () => this.commands.cmd_status({}, target)]],
      [[this.commands.t('buttonModel'), () => this.commands.cmd_model({}, target)], [this.commands.t('buttonPreset'), () => this.commands.cmd_preset({}, target)]],
      [[this.commands.t('buttonPermissions'), () => this.commands.cmd_mode({}, target)], [this.commands.t('buttonStop'), () => this.commands.cmd_stop({}, target)]],
      [[this.commands.t('buttonCompact'), () => this.commands.cmd_compact({}, target)], [this.commands.t('buttonHelp'), () => this.commands.cmd_help({}, target)]],
    ];
    return this.commands.reply(target, html, actions.map(row => row.map(([label, fn]) => this.button(target, label, fn))));
  }

  async projects(target, offset = 0) {
    const workspaces = this.ctx.get('workspaceRegistry').list();
    const binding = await this.commands.bindings.get(target.key);
    const keyboard = workspaces.slice(offset, offset + PAGE_SIZE).map(workspace => [
      this.button(target, `${binding?.cwd === workspace.path ? '✅ ' : '📁 '}${workspace.title}`.slice(0, 80), async () => {
        const current = this.ctx.get('workspaceRegistry').get(workspace.id);
        if (!current || await current.status() !== 'ok') throw new Error(this.commands.t('projectUnavailable'));
        await this.commands.startNewSession(target, '', current.path);
        await this.commands.reply(target, this.commands.t('projectSelected', escapeHtml(current.title), escapeHtml(current.path)));
        await this.tasks(target);
      }),
    ]);
    this.pages(keyboard, target, offset, workspaces.length, next => this.projects(target, next));
    keyboard.push([this.button(target, this.commands.t('buttonMainMenu'), () => this.menu(target))]);
    return this.commands.reply(target, this.commands.t('projectsTitle', workspaces.length), keyboard);
  }

  pages(keyboard, target, offset, total, action) {
    const row = [];
    if (offset > 0) row.push(this.button(target, this.commands.t('buttonPrevious'), () => action(Math.max(0, offset - PAGE_SIZE))));
    if (offset + PAGE_SIZE < total) row.push(this.button(target, this.commands.t('buttonNext'), () => action(offset + PAGE_SIZE)));
    if (row.length) keyboard.push(row);
  }

  async rows(target) {
    const binding = await this.commands.bindings.get(target.key);
    const { items } = await this.ctx.get('sessionController').list({});
    return items.filter(row => row.cwd === binding?.cwd && !row.blank);
  }

  title(row) {
    return row.projections?.values?.title || row.sessionId;
  }

  async inspect(row) {
    const snapshot = await this.ctx.get('sessionQuery').readSession(row.sessionId);
    const own = snapshot.events.slice(snapshot.inheritedEventCount);
    const end = own.findLast(e => e.type === 'turn/end');
    const lastWork = own.findLast(e => e.type === 'turn/start' || e.type === 'user/message');
    const waiting = lastWork && (!end || lastWork.seq > end.seq);
    const kind = row.running ? 'running' : waiting ? 'waiting' : end?.data.reason.kind;
    const answer = end && own.findLast(e => e.type === 'assistant/message' && e.data.turn === end.data.turn);
    return {
      kind,
      status: kind === 'running' ? this.commands.t('stateRunning') : kind === 'waiting' ? this.commands.t('stateWaiting') : (STATUS[kind] && this.commands.t(STATUS[kind])) ?? this.commands.t('stateNoAnswer'),
      text: answer ? textOf(answer.data.message) : '',
      error: end?.data.reason.kind === 'error' ? end.data.reason.error?.message : undefined,
    };
  }

  async tasks(target, completed = false, offset = 0) {
    const rows = await this.rows(target);
    const chunk = rows.slice(offset, offset + PAGE_SIZE);
    const keyboard = [];
    // Bound exact history reads to the visible page, including on very large projects.
    for (const row of chunk) {
      let status;
      try { status = await this.inspect(row); }
      catch (error) {
        this.commands.logger.warn(this.commands.t('historyReadFailed'), row.sessionId, String(error));
        status = { kind: 'unavailable', status: this.commands.t('historyUnavailable') };
      }
      if (completed && status.kind !== 'completed') continue;
      keyboard.push([this.button(target, `${status.status} · ${this.title(row)}`.slice(0, 100), () => this.task(target, row.sessionId))]);
    }
    this.pages(keyboard, target, offset, rows.length, next => this.tasks(target, completed, next));
    keyboard.push([
      this.button(target, this.commands.t('buttonProjects'), () => this.projects(target)),
      this.button(target, this.commands.t('buttonMenu'), () => this.menu(target)),
    ]);
    const binding = await this.commands.bindings.get(target.key);
    return this.commands.reply(target,
      `<b>${completed ? this.commands.t('tasksCompletedTitle') : this.commands.t('tasksTitle')}</b>\n<code>${escapeHtml(binding?.cwd ?? this.commands.t('projectNotSelected'))}</code>\n` +
      (rows.length ? this.commands.t('pageNumber', Math.floor(offset / PAGE_SIZE) + 1, Math.ceil(rows.length / PAGE_SIZE)) : this.commands.t('noTasks')) +
      (completed ? this.commands.t('completedPageHint') : '') +
      (completed && keyboard.length <= 2 ? this.commands.t('noCompletedTasks') : ''), keyboard);
  }

  async find(target, sessionId) {
    const row = (await this.rows(target)).find(r => r.sessionId === sessionId);
    if (!row) throw new Error(this.commands.t('taskNotFound'));
    return row;
  }

  async task(target, sessionId) {
    const row = await this.find(target, sessionId);
    const status = await this.inspect(row);
    const keyboard = [
      [this.button(target, this.commands.t('buttonViewResult'), () => this.result(target, sessionId))],
      [this.button(target, this.commands.t('buttonSelectTask'), async () => {
        const fresh = await this.find(target, sessionId);
        await this.selectSession(target, fresh);
        await this.commands.reply(target, this.commands.t('taskSelected', escapeHtml(this.title(fresh))));
        await this.menu(target);
      })],
      [this.button(target, this.commands.t('buttonBackToTasks'), () => this.tasks(target))],
    ];
    return this.commands.reply(target, `<b>${escapeHtml(this.title(row))}</b>\n${status.status}\n<code>${escapeHtml(sessionId)}</code>`, keyboard);
  }

  async result(target, sessionId) {
    sessionId ??= (await this.commands.bindings.get(target.key))?.sessionId;
    const row = await this.find(target, sessionId);
    const result = await this.inspect(row);
    await this.commands.reply(target, this.commands.t('resultTitle', escapeHtml(this.title(row)), result.status));
    if (result.error && result.text) await this.commands.reply(target, this.commands.t('resultError', escapeHtml(result.error).slice(0, 3000)));
    if (!result.text) {
      return this.commands.reply(target, result.error ? this.commands.t('resultError', escapeHtml(result.error).slice(0, 3000)) : this.commands.t('noTextResult'));
    }
    // Plain escaped chunks preserve all of a long result and stay below the Bot API limit.
    for (let start = 0; start < result.text.length; start += 900) {
      await this.commands.reply(target, escapeHtml(result.text.slice(start, start + 900)));
    }
  }

  async handleCallback(query) {
    if (!String(query.data).startsWith('n:')) return false;
    const token = query.data.slice(2);
    const state = this.pending.get(token);
    if (!state || state.expires < Date.now()) {
      await this.commands.api.answerCallback(query.id, { text: this.commands.t('menuExpired') });
      return true;
    }
    if (String(query.message?.chat.id) !== String(state.target.chatId) ||
        String(query.message?.message_thread_id ?? '') !== String(state.target.threadId ?? '') ||
        String(query.from?.id) !== String(state.target.userId)) {
      await this.commands.api.answerCallback(query.id, { text: this.commands.t('menuOtherUser') });
      return true;
    }
    // Consume before awaiting to prevent a repeated tap from starting two tasks.
    this.pending.delete(token);
    await this.commands.api.answerCallback(query.id);
    try { await state.action(); }
    catch (error) { await this.commands.reply(state.target, `⚠️ ${escapeHtml(String(error)).slice(0, 2000)}`); }
    return true;
  }
}
