import { randomBytes } from 'node:crypto';
import { escapeHtml } from './markdown.js';

const PAGE_SIZE = 8;
const STATUS = {
  completed: '✅ Завершена', error: '❌ Ошибка', aborted: '⏹ Остановлена',
  interrupted: '⚠️ Прервана', blocked: '⏸ Заблокирована',
  'max-tokens': '⚠️ Лимит ответа', forked: '⑂ Ответвление',
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
    const html = '<b>Управление харнесом</b>\n\n' +
      `Проект: <b>${escapeHtml(workspace?.title ?? binding?.cwd ?? 'не выбран')}</b>\n` +
      'Выберите проект или задачу. Обычные сообщения отправляются в выбранную задачу.';
    const actions = [
      [['📁 Проекты', () => this.projects(target)], ['📋 Задачи', () => this.tasks(target)]],
      [['✅ Завершённые', () => this.tasks(target, true)], ['📄 Итог задачи', () => this.result(target)]],
      [['➕ Новая задача', () => this.commands.cmd_new({ rest: '' }, target)], ['📊 Статус', () => this.commands.cmd_status({}, target)]],
      [['🤖 Модель', () => this.commands.cmd_model({}, target)], ['🧩 Режим агента', () => this.commands.cmd_preset({}, target)]],
      [['🔐 Разрешения', () => this.commands.cmd_mode({}, target)], ['⏹ Остановить', () => this.commands.cmd_stop({}, target)]],
      [['🗜 Сжать историю', () => this.commands.cmd_compact({}, target)], ['❓ Помощь', () => this.commands.cmd_help({}, target)]],
    ];
    return this.commands.reply(target, html, actions.map(row => row.map(([label, fn]) => this.button(target, label, fn))));
  }

  async projects(target, offset = 0) {
    const workspaces = this.ctx.get('workspaceRegistry').list();
    const binding = await this.commands.bindings.get(target.key);
    const keyboard = workspaces.slice(offset, offset + PAGE_SIZE).map(workspace => [
      this.button(target, `${binding?.cwd === workspace.path ? '✅ ' : '📁 '}${workspace.title}`.slice(0, 80), async () => {
        const current = this.ctx.get('workspaceRegistry').get(workspace.id);
        if (!current || await current.status() !== 'ok') throw new Error('Каталог проекта недоступен.');
        await this.commands.startNewSession(target, '', current.path);
        await this.commands.reply(target, `📁 Проект выбран: <b>${escapeHtml(current.title)}</b>\n<code>${escapeHtml(current.path)}</code>\nВыберите существующую задачу или отправьте описание новой.`);
        await this.tasks(target);
      }),
    ]);
    this.pages(keyboard, target, offset, workspaces.length, next => this.projects(target, next));
    keyboard.push([this.button(target, '🏠 Главное меню', () => this.menu(target))]);
    return this.commands.reply(target, `<b>Проекты</b> · ${workspaces.length}\nВыберите рабочую папку проекта.`, keyboard);
  }

  pages(keyboard, target, offset, total, action) {
    const row = [];
    if (offset > 0) row.push(this.button(target, '← Назад', () => action(Math.max(0, offset - PAGE_SIZE))));
    if (offset + PAGE_SIZE < total) row.push(this.button(target, 'Далее →', () => action(offset + PAGE_SIZE)));
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
      status: kind === 'running' ? '🟢 Выполняется' : kind === 'waiting' ? '⏳ Ожидает ответа' : STATUS[kind] ?? '⚪ Без завершённого ответа',
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
        this.commands.logger.warn('Не удалось прочитать историю задачи', row.sessionId, String(error));
        status = { kind: 'unavailable', status: '⚠️ История недоступна' };
      }
      if (completed && status.kind !== 'completed') continue;
      keyboard.push([this.button(target, `${status.status} · ${this.title(row)}`.slice(0, 100), () => this.task(target, row.sessionId))]);
    }
    this.pages(keyboard, target, offset, rows.length, next => this.tasks(target, completed, next));
    keyboard.push([
      this.button(target, '📁 Проекты', () => this.projects(target)),
      this.button(target, '🏠 Меню', () => this.menu(target)),
    ]);
    const binding = await this.commands.bindings.get(target.key);
    return this.commands.reply(target,
      `<b>${completed ? 'Завершённые задачи' : 'Задачи проекта'}</b>\n<code>${escapeHtml(binding?.cwd ?? 'Проект не выбран')}</code>\n` +
      (rows.length ? `Страница ${Math.floor(offset / PAGE_SIZE) + 1} из ${Math.ceil(rows.length / PAGE_SIZE)}.` : 'Задач пока нет.') +
      (completed ? '\nПоказаны задачи этой страницы с завершённым последним ответом агента.' : '') +
      (completed && keyboard.length <= 2 ? '\nНа этой странице завершённых задач нет.' : ''), keyboard);
  }

  async find(target, sessionId) {
    const row = (await this.rows(target)).find(r => r.sessionId === sessionId);
    if (!row) throw new Error('Задача отсутствует в выбранном проекте. Обновите список.');
    return row;
  }

  async task(target, sessionId) {
    const row = await this.find(target, sessionId);
    const status = await this.inspect(row);
    const keyboard = [
      [this.button(target, '📄 Посмотреть итог', () => this.result(target, sessionId))],
      [this.button(target, '💬 Управлять этой задачей', async () => {
        const fresh = await this.find(target, sessionId);
        await this.selectSession(target, fresh);
        await this.commands.reply(target, `💬 Выбрана задача: <b>${escapeHtml(this.title(fresh))}</b>\nСледующее сообщение продолжит эту беседу. /stop остановит её текущий ответ.`);
        await this.menu(target);
      })],
      [this.button(target, '📋 К задачам', () => this.tasks(target))],
    ];
    return this.commands.reply(target, `<b>${escapeHtml(this.title(row))}</b>\n${status.status}\n<code>${escapeHtml(sessionId)}</code>`, keyboard);
  }

  async result(target, sessionId) {
    sessionId ??= (await this.commands.bindings.get(target.key))?.sessionId;
    const row = await this.find(target, sessionId);
    const result = await this.inspect(row);
    await this.commands.reply(target, `<b>Итог: ${escapeHtml(this.title(row))}</b>\n${result.status}`);
    if (result.error && result.text) await this.commands.reply(target, `Ошибка: ${escapeHtml(result.error).slice(0, 3000)}`);
    if (!result.text) {
      return this.commands.reply(target, result.error ? `Ошибка: ${escapeHtml(result.error).slice(0, 3000)}` : 'Завершённого текстового ответа пока нет.');
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
      await this.commands.api.answerCallback(query.id, { text: 'Меню устарело. Откройте /menu.' });
      return true;
    }
    if (String(query.message?.chat.id) !== String(state.target.chatId) ||
        String(query.message?.message_thread_id ?? '') !== String(state.target.threadId ?? '') ||
        String(query.from?.id) !== String(state.target.userId)) {
      await this.commands.api.answerCallback(query.id, { text: 'Это меню другого пользователя.' });
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
