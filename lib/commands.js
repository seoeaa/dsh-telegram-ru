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
import { TelegramNavigation } from './navigation.js';

/** Sandbox modes offered by `/mode`, in increasing order of permission. */
const SANDBOX_MODES = [
  { id: 'read-only', label: '🔒 Только чтение', description: 'Запись файлов запрещена' },
  { id: 'workspace-write', label: '📝 Запись в проекте', description: 'Разрешена запись в рабочей папке' },
  { id: 'danger-full-access', label: '⚠️ Полный доступ', description: 'Доступ к файлам за пределами проекта' },
];

const PRESET_LABELS = {
  standard: { name: 'Стандартный', description: 'Обычная работа с проектом и инструментами' },
  ptc: { name: 'Оркестрация PTC', description: 'Программное управление рабочим процессом' },
  minimal: { name: 'Минимальный', description: 'Минимальный набор возможностей агента' },
  cordis: { name: 'Разработка Cordis', description: 'Работа с системой плагинов Cordis' },
};

export const COMMAND_MENU = [
  { command: 'menu', description: 'Главное меню управления' },
  { command: 'projects', description: 'Выбрать проект' },
  { command: 'tasks', description: 'Задачи выбранного проекта' },
  { command: 'done', description: 'Завершённые задачи и результаты' },
  { command: 'result', description: 'Итог выбранной задачи' },
  { command: 'start', description: 'Открыть главное меню' },
  { command: 'new', description: 'Создать новую задачу' },
  { command: 'model', description: 'Выбрать модель' },
  { command: 'preset', description: 'Выбрать режим новой задачи' },
  { command: 'mode', description: 'Выбрать разрешения' },
  { command: 'status', description: 'Статус выбранной задачи' },
  { command: 'stop', description: 'Остановить текущий ответ' },
  { command: 'compact', description: 'Сжать историю беседы' },
  { command: 'clear', description: 'Начать новую беседу, сохранив старую' },
  { command: 'help', description: 'Помощь по командам' },
];

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
      await this.reply(target, `⚠️ Команда <code>/${escapeHtml(command.name)}</code> завершилась ошибкой: ${escapeHtml(String(error))}`);
    }
    return true;
  }

  reply(target, html, keyboard) {
    return this.api.sendHtml(target.chatId, html, { threadId: target.threadId, keyboard });
  }

  /* ------------------------------------------------------------------ */

  async cmd_help(command, target) {
    const lines = [
      '<b>Доступные команды</b>',
      '',
      ...COMMAND_MENU.map((entry) => `/${entry.command} — ${escapeHtml(entry.description)}`),
      '',
      '<i>Обычные сообщения продолжают выбранную задачу. Сначала выберите проект через /projects.</i>',
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
      `🆕 Создана новая задача. Отправьте её описание.\n<code>${escapeHtml(String(sessionId).slice(0, 20))}</code>`,
    );
  }

  async cmd_clear(command, target) {
    return this.cmd_new(command, target);
  }

  async cmd_status(command, target) {
    const binding = await this.bindings.get(target.key);
    if (!binding) {
      await this.reply(target, 'Задача ещё не выбрана. Откройте /menu.');
      return;
    }
    const agent = this.getAgent(binding.sessionId);
    const selection = binding.provider && binding.model ? binding : this.currentSelection(agent);
    const preset = (agent && this.ctx.get('agentPresets')?.composedPreset(agent.ctx)) ?? binding.preset ?? '(по умолчанию)';
    const row = (await this.navigation.rows(target)).find(row => row.sessionId === binding.sessionId);
    const state = row ? (await this.navigation.inspect(row)).status : '⚪ Ожидает описания задачи';
    const mode = agent ? this.ctx.get('permissionPresets').current(agent.session) : binding.sandboxMode ?? this.defaultSandboxMode();

    const lines = [
      '<b>Статус задачи</b>',
      '',
      `Задача: <code>${escapeHtml(String(binding.sessionId).slice(0, 24))}</code>`,
      `Состояние: ${state}`,
      `Модель: <code>${escapeHtml(selection ? `${selection.provider}/${selection.model}` : 'неизвестно')}</code>`,
      `Режим агента: <code>${escapeHtml(preset)}</code>`,
      `Разрешения: <code>${escapeHtml(mode)}</code>`,
      `Папка: <code>${escapeHtml(binding.cwd ?? '(по умолчанию)')}</code>`,
    ];
    await this.reply(target, lines.join('\n'));
  }

  async cmd_stop(command, target) {
    const binding = await this.bindings.get(target.key);
    const agent = binding && this.getAgent(binding.sessionId);
    if (!agent) {
      await this.reply(target, 'Нет выполняющегося ответа.');
      return;
    }
    agent.cancel({ kind: 'user' });
    await this.reply(target, '⏹ Отправлен запрос на остановку текущего ответа.');
  }

  async cmd_compact(command, target) {
    const binding = await this.bindings.get(target.key);
    const agent = binding && this.getAgent(binding.sessionId);
    if (!agent) {
      await this.reply(target, 'Нет загруженной беседы для сжатия.');
      return;
    }
    const compaction = this.ctx.get('agentPresets')?.serviceFor(agent, 'compaction');
    if (!compaction) {
      await this.reply(target, 'Сервис сжатия истории недоступен в режиме этой задачи.');
      return;
    }
    await this.reply(target, '🗜 Сжимаю историю…');
    const controller = new AbortController();
    const result = await compaction.compactNow(agent, controller.signal);
    await this.reply(
      target,
      result ? '✅ История беседы сжата.' : 'История пока не требует сжатия.',
    );
  }

  /* ---------------------------- model ------------------------------ */

  async cmd_model(command, target) {
    const llm = this.ctx.get('llm');
    if (!llm) {
      await this.reply(target, 'Сервис моделей недоступен.');
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
        choices.push({ provider: provider.id, model: undefined, label: `${provider.displayName ?? provider.id} · (введите название модели)` });
      }
    }

    if (choices.length === 0) {
      await this.reply(target, 'Провайдеры моделей не найдены.');
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
        '<b>Выберите модель</b>',
        '',
        current
          ? `Сейчас: <code>${escapeHtml(`${current.provider}/${current.model}`)}</code>`
          : 'Текущая модель не определена.',
        '',
        '<i>Или введите: /model provider/model</i>',
      ].join('\n'),
      keyboard,
    );
  }

  async applyModel(target, spec) {
    const separator = spec.indexOf('/');
    const provider = separator > 0 ? spec.slice(0, separator) : undefined;
    const model = separator > 0 ? spec.slice(separator + 1) : spec;
    if (!provider || !model) {
      await this.reply(target, 'Формат: <code>/model provider/model</code>');
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
      await this.reply(target, `⚠️ Модель недоступна: ${escapeHtml(String(error))}`);
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
        `✅ Модель: <code>${escapeHtml(`${selection.provider}/${selection.model}`)}</code>`,
        applied
          ? 'Применено к выбранной задаче.'
          : 'Применится со следующего ответа.',
      ].join('\n'),
    );
  }

  /* ---------------------------- preset ----------------------------- */

  async cmd_preset(command, target) {
    const presets = this.ctx.get('agentPresets');
    if (!presets) {
      await this.reply(target, 'Режимы агента недоступны.');
      return;
    }

    const available = (await presets.list()).map(preset => ({ ...preset, ...(PRESET_LABELS[preset.id] ?? {}) }));
    const usable = available.filter((preset) => !preset.broken);
    if (usable.length === 0) {
      await this.reply(target, 'Нет доступных режимов агента.');
      return;
    }

    if (command.rest) {
      const chosen = usable.find((preset) => preset.id === command.rest);
      if (!chosen) {
        await this.reply(
          target,
          `Режим не найден: <code>${escapeHtml(command.rest)}</code>. Доступные варианты: ${usable.map((p) => p.id).join(', ')}`,
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
        '<b>Выберите режим агента</b>',
        '',
        ...usable.map((preset) => `• <b>${escapeHtml(preset.name ?? preset.id)}</b> — ${escapeHtml(preset.description ?? preset.id)}`),
        '',
        '<i>Новый режим применяется к новой задаче.</i>',
      ].join('\n'),
      keyboard,
    );
  }

  async applyPreset(target, presetId) {
    await this.bindings.patch(target.key, { preset: presetId });
    await this.reply(
      target,
      `✅ Режим агента: <code>${escapeHtml(presetId)}</code>\nИспользуйте /new, чтобы создать задачу с этим режимом.`,
    );
  }

  /* ----------------------------- mode ------------------------------ */

  async cmd_mode(command, target) {
    if (command.rest) {
      const chosen = SANDBOX_MODES.find((mode) => mode.id === command.rest);
      if (!chosen) {
        await this.reply(target, `Неизвестное разрешение. Выберите: ${SANDBOX_MODES.map((m) => m.id).join(', ')}`);
        return;
      }
      await this.applyMode(target, chosen.id);
      return;
    }

    const binding = await this.bindings.get(target.key);
    const agent = binding && this.getAgent(binding.sessionId);
    const current = agent ? this.ctx.get('permissionPresets').current(agent.session) : binding?.sandboxMode ?? this.defaultSandboxMode();
    const token = this.stash({ kind: 'mode', choices: SANDBOX_MODES, target });

    const keyboard = SANDBOX_MODES.map((mode, index) => [
      { text: current === mode.id ? `✅ ${mode.label}` : mode.label, callback_data: `c:${token}:${index}` },
    ]);

    await this.reply(
      target,
      [
        '<b>Разрешения на запись файлов</b>',
        '',
        ...SANDBOX_MODES.map((mode) => `• <b>${escapeHtml(mode.label)}</b> — ${escapeHtml(mode.description)}`),
        '',
        current ? `Сейчас: <code>${escapeHtml(current)}</code>` : '',
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
    await this.reply(target, `✅ Разрешения: <code>${escapeHtml(modeId)}</code>`);
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
      await this.api.answerCallback(query.id, { text: 'Выбор устарел. Откройте меню снова.' });
      return true;
    }

    if (String(query.message?.chat.id) !== String(state.target.chatId) ||
        String(query.from?.id) !== String(state.target.userId) ||
        String(query.message?.message_thread_id ?? '') !== String(state.target.threadId ?? '')) {
      await this.api.answerCallback(query.id, { text: 'Это меню другого пользователя.' });
      return true;
    }
    const index = Number(indexText);
    const choice = Number.isInteger(index) && index >= 0 ? state.choices[index] : undefined;
    if (!choice) {
      await this.api.answerCallback(query.id, { text: 'Вариант недоступен.' });
      return true;
    }

    this.pending.delete(token);
    await this.api.answerCallback(query.id, { text: choice.label ?? choice.id });
    await this.api.editKeyboard(state.target.chatId, query.message?.message_id, [
      [{ text: `✅ ${choice.label ?? choice.id}`, callback_data: 'c:done:noop' }],
    ]);

    if (state.kind === 'model') {
      if (!choice.model) {
        await this.reply(state.target, `Введите: <code>/model ${escapeHtml(choice.provider)}/название-модели</code>`);
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
