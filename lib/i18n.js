/**
 * Channel copy in Vietnamese, English and Russian.
 *
 * DSH's own locale registry only ships `zh` and `en` — `LOCALE_IDS = ['zh',
 * 'en']`, and its schema is a union over exactly those two, so a `vi`
 * preference is rejected outright. Following the host locale would therefore
 * have meant hiding Vietnamese behind the Chinese option, which is a trick
 * rather than a translation.
 *
 * So this channel carries its own `language` setting. It governs both faces at
 * once — the messages the bot sends and the labels on the settings card —
 * because a bot answering in Vietnamese from a card labelled in English is one
 * product speaking two languages at the user.
 *
 * `ru` was added locally (see $DSH_HOME/local-patches/dsh-telegram-ru-card):
 * the stock 0.2.0 build speaks Vietnamese and English only, and a Russian DSH
 * deployment was otherwise left with a card and system messages in a language
 * its owner does not read.
 *
 * Every string lives here rather than at its use site so a missing translation
 * is visible as a missing key instead of surfacing as untranslated text in
 * production.
 */

/** Supported language tags, in menu order. */
export const LANGUAGES = ['vi', 'en', 'ru'];

/** Used when a stored value is absent or not one this build knows. */
export const DEFAULT_LANGUAGE = 'ru';

const DICTIONARY = {
  vi: {
    /* ---- bot messages ---- */
    denied: '⛔️ Bạn không có quyền dùng bot này.',
    deniedClaimed: (id) =>
      `⛔️ Bot này đã có chủ. Nhờ chủ bot thêm id của bạn: <code>${id}</code>`,
    claimFailed: (id) =>
      `⚠️ Không lưu được quyền sở hữu. Hãy thêm id của bạn trong Settings: <code>${id}</code>`,
    claimed: (id) =>
      [
        '✅ <b>Bạn là chủ bot này.</b>',
        '',
        `Từ giờ chỉ id <code>${id}</code> dùng được bot. ` +
          'Muốn cho thêm người thì vào Settings → Plugins → Telegram.',
        '',
        'Gõ /help để xem các lệnh.',
      ].join('\n'),
    welcome: 'Chào bạn! Gửi tin nhắn để trò chuyện với agent, hoặc gõ /help để xem các lệnh.',
    stopped: 'kênh Telegram đã dừng',
    error: (text) => `⚠️ <i>Lỗi: ${text}</i>`,
    imageReceived: '[người dùng gửi một ảnh]',
    imageUnreadable: '[người dùng gửi một ảnh không đọc được]',
    imageUnknownType: '[người dùng gửi một ảnh không nhận dạng được định dạng]',
    fileReceived: (name, mime, size) =>
      `[người dùng gửi tệp: ${name} (${mime}, ${size} byte)]`,
    unknownFileName: 'không rõ tên',
    unknownFileType: 'không rõ kiểu',
    audioReceived: (seconds) => `[người dùng gửi âm thanh dài ${seconds} giây]`,

    /* ---- questions in chat ---- */
    qPickOne: 'Bấm một nút bên dưới để trả lời.',
    qPickMany: 'Chọn một hoặc nhiều mục, rồi bấm Xong.',
    qTypeDirect: 'Trả lời trực tiếp bằng tin nhắn.',
    qDone: '✅ Xong',
    qType: '✍️ Tự nhập',
    qCancelled: '⏹ Đã huỷ',
    qAwaitingText: '✍️ Đang chờ bạn nhập câu trả lời — hãy gửi tin nhắn tiếp theo.',
    qChooseAtLeastOne: 'Hãy chọn ít nhất một mục.',
    qSelectedCount: (count) => `Đã chọn ${count} mục`,
    qTypePrompt: 'Hãy gõ câu trả lời của bạn.',
    qFinished: 'Câu hỏi này đã kết thúc.',
    qInvalidOption: 'Lựa chọn không hợp lệ.',

    /* ---- approvals in chat ---- */
    approvalTitle: '⚠️ Cần phê duyệt',
    approvalTool: (tool) => `Công cụ: <code>${tool}</code>`,
    approvalReason: (reason) => `Lý do: ${reason}`,
    approvalAllow: '✅ Cho phép',
    approvalDeny: '⛔️ Từ chối',
    approvalAllowed: '✅ Đã cho phép',
    approvalRejected: '⛔️ Đã từ chối',
    approvalCancelled: '⌛️ Đã huỷ yêu cầu',
    approvalStale: '⌛️ Yêu cầu không còn hiệu lực',

    /* ---- polling diagnostics ---- */
    pollingConflictNotice: (detail) =>
      '⚠️ <b>Xung đột Telegram:</b> token bot này đang được một tiến trình khác ' +
      'poll (CoPaw/QwenPaw, một DSH thứ hai, hoặc webhook), nên kênh này không ' +
      'nhận được tin nhắn. Hãy dừng tiến trình kia hoặc dùng token mới từ ' +
      '@BotFather.' +
      (detail ? `\n\n<i>${detail}</i>` : ''),

    /* ---- settings card ---- */
    cardTitle: 'Telegram',
    cardDescription:
      'Kênh Telegram: gửi ảnh, bảng thật, câu hỏi có nút bấm, đổi model trong chat.',
    unsaved: 'chưa lưu',
    tokenLabel: 'Bot token',
    tokenConfigured: 'đã cấu hình',
    tokenMissing: 'chưa có',
    tokenUnknown: 'không rõ',
    tokenPlaceholderSet: 'Đã lưu — nhập để thay',
    tokenPlaceholderEmpty: 'Dán token từ @BotFather',
    tokenHint: (ref) =>
      `Token nằm trong kho credential ${ref}, không nằm trong file cấu hình. ` +
      'Để trống nghĩa là giữ token đang có.',
    languageLabel: 'Ngôn ngữ',
    languageHint: 'Áp dụng cho tin nhắn bot và thẻ cấu hình này.',
    enabledLabel: 'Bật kênh Telegram',
    routeQuestionsLabel: 'Hỏi ngay trong Telegram',
    routeQuestionsHint:
      'Câu hỏi phát sinh từ phiên Telegram sẽ hiện nút bấm trong chat. Tắt thì chúng hiện ở Web.',
    allowedLabel: 'User được phép dùng bot',
    allowedHint:
      'Telegram user id, cách nhau bởi dấu phẩy. Để trống nghĩa là bot chưa có chủ — ' +
      'người gõ /start đầu tiên sẽ thành chủ.',
    workspaceLabel: 'Thư mục làm việc',
    workspaceHint: 'Nơi agent chạy lệnh và đọc ghi file.',
    restartNotice:
      'Token, thư mục làm việc và công tắc bật/tắt chỉ có hiệu lực sau khi khởi động lại DSH.',
    reset: 'Đặt lại',
    save: 'Lưu',
    saving: 'Đang lưu…',
    saved: 'Đã lưu',
    discard: 'Huỷ',
    saveFailed: 'Lưu không thành công — kiểm tra lại giá trị',
  },

  en: {
    /* ---- bot messages ---- */
    denied: '⛔️ You are not allowed to use this bot.',
    deniedClaimed: (id) =>
      `⛔️ This bot already has an owner. Ask them to add your id: <code>${id}</code>`,
    claimFailed: (id) =>
      `⚠️ Could not record ownership. Please add your id in Settings: <code>${id}</code>`,
    claimed: (id) =>
      [
        '✅ <b>You now own this bot.</b>',
        '',
        `Only id <code>${id}</code> can use it from now on. ` +
          'To let others in, go to Settings → Plugins → Telegram.',
        '',
        'Send /help to see the commands.',
      ].join('\n'),
    welcome: 'Hello! Send a message to talk to the agent, or /help to list the commands.',
    stopped: 'the Telegram channel stopped',
    error: (text) => `⚠️ <i>Error: ${text}</i>`,
    imageReceived: '[the user sent an image]',
    imageUnreadable: '[the user sent an image that could not be read]',
    imageUnknownType: '[the user sent an image in an unrecognised format]',
    fileReceived: (name, mime, size) =>
      `[the user sent a file: ${name} (${mime}, ${size} bytes)]`,
    unknownFileName: '(no name)',
    unknownFileType: '(no type)',
    audioReceived: (seconds) => `[the user sent audio lasting ${seconds} s]`,

    /* ---- questions in chat ---- */
    qPickOne: 'Press a button below to answer.',
    qPickMany: 'Pick one or more items, then press Done.',
    qTypeDirect: 'Answer with a direct message.',
    qDone: '✅ Done',
    qType: '✍️ Type an answer',
    qCancelled: '⏹ Cancelled',
    qAwaitingText: '✍️ Waiting for your answer — send the next message.',
    qChooseAtLeastOne: 'Pick at least one item.',
    qSelectedCount: (count) => `Selected ${count} item(s)`,
    qTypePrompt: 'Type your answer.',
    qFinished: 'This question has already finished.',
    qInvalidOption: 'Invalid option.',

    /* ---- approvals in chat ---- */
    approvalTitle: '⚠️ Approval required',
    approvalTool: (tool) => `Tool: <code>${tool}</code>`,
    approvalReason: (reason) => `Reason: ${reason}`,
    approvalAllow: '✅ Allow once',
    approvalDeny: '⛔️ Reject',
    approvalAllowed: '✅ Allowed once',
    approvalRejected: '⛔️ Rejected',
    approvalCancelled: '⌛️ Request withdrawn',
    approvalStale: '⌛️ This request is no longer pending',

    /* ---- polling diagnostics ---- */
    pollingConflictNotice: (detail) =>
      '⚠️ <b>Telegram conflict:</b> this bot token is already polled by another ' +
      'process (CoPaw/QwenPaw, a second DSH, or a webhook), so this channel ' +
      'receives nothing. Stop that process or take a new token from @BotFather.' +
      (detail ? `\n\n<i>${detail}</i>` : ''),

    /* ---- settings card ---- */
    cardTitle: 'Telegram',
    cardDescription:
      'Telegram channel: images, real tables, questions with buttons, model switching in chat.',
    unsaved: 'unsaved',
    tokenLabel: 'Bot token',
    tokenConfigured: 'configured',
    tokenMissing: 'not set',
    tokenUnknown: 'unknown',
    tokenPlaceholderSet: 'Stored — type to replace',
    tokenPlaceholderEmpty: 'Paste the token from @BotFather',
    tokenHint: (ref) =>
      `The token lives in credential ${ref}, never in a config file. ` +
      'Leave this blank to keep the stored one.',
    languageLabel: 'Language',
    languageHint: 'Applies to both bot messages and this card.',
    enabledLabel: 'Enable the Telegram channel',
    routeQuestionsLabel: 'Ask inside Telegram',
    routeQuestionsHint:
      'Questions raised by a Telegram session get buttons in the chat. Turn this off to answer them in the Web UI.',
    allowedLabel: 'Users allowed to use the bot',
    allowedHint:
      'Telegram user ids, comma separated. Empty means the bot is unclaimed — ' +
      'the first person to send /start becomes its owner.',
    workspaceLabel: 'Working directory',
    workspaceHint: 'Where the agent runs commands and reads or writes files.',
    restartNotice:
      'The token, working directory and on/off switch only take effect after DSH restarts.',
    reset: 'Reset',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    discard: 'Discard',
    saveFailed: 'Save failed — check the values',
  },

  ru: {
    /* ---- bot messages ---- */
    denied: '⛔️ У вас нет доступа к этому боту.',
    deniedClaimed: (id) =>
      `⛔️ У этого бота уже есть владелец. Попросите добавить ваш id: <code>${id}</code>`,
    claimFailed: (id) =>
      `⚠️ Не удалось сохранить владельца. Добавьте ваш id в настройках: <code>${id}</code>`,
    claimed: (id) =>
      [
        '✅ <b>Теперь вы владелец этого бота.</b>',
        '',
        `С этого момента ботом может пользоваться только id <code>${id}</code>. ` +
          'Чтобы добавить других — Настройки → Telegram.',
        '',
        'Отправьте /help, чтобы увидеть команды.',
      ].join('\n'),
    welcome: 'Здравствуйте! Напишите сообщение, чтобы поговорить с агентом, или /help — список команд.',
    stopped: 'канал Telegram остановлен',
    error: (text) => `⚠️ <i>Ошибка: ${text}</i>`,
    imageReceived: '[пользователь прислал изображение]',
    imageUnreadable: '[пользователь прислал изображение, которое не удалось прочитать]',
    imageUnknownType: '[пользователь прислал изображение в неизвестном формате]',
    fileReceived: (name, mime, size) =>
      `[пользователь прислал файл: ${name} (${mime}, ${size} байт)]`,
    unknownFileName: '(без имени)',
    unknownFileType: '(без типа)',
    audioReceived: (seconds) => `[пользователь прислал аудио длительностью ${seconds} с]`,

    /* ---- questions in chat ---- */
    qPickOne: 'Нажмите кнопку ниже, чтобы ответить.',
    qPickMany: 'Выберите один или несколько пунктов, затем нажмите «Готово».',
    qTypeDirect: 'Ответьте обычным сообщением.',
    qDone: '✅ Готово',
    qType: '✍️ Ввести текст',
    qCancelled: '⏹ Отменено',
    qAwaitingText: '✍️ Жду ваш ответ — отправьте следующее сообщение.',
    qChooseAtLeastOne: 'Выберите хотя бы один пункт.',
    qSelectedCount: (count) => `Выбрано: ${count}`,
    qTypePrompt: 'Напишите ваш ответ.',
    qFinished: 'Этот вопрос уже закрыт.',
    qInvalidOption: 'Некорректный вариант.',

    /* ---- approvals in chat ---- */
    approvalTitle: '⚠️ Требуется одобрение',
    approvalTool: (tool) => `Инструмент: <code>${tool}</code>`,
    approvalReason: (reason) => `Причина: ${reason}`,
    approvalAllow: '✅ Разрешить',
    approvalDeny: '⛔️ Отклонить',
    approvalAllowed: '✅ Разрешено',
    approvalRejected: '⛔️ Отклонено',
    approvalCancelled: '⌛️ Запрос отменён',
    approvalStale: '⌛️ Запрос уже неактуален',

    /* ---- polling diagnostics ---- */
    pollingConflictNotice: (detail) =>
      '⚠️ <b>Конфликт Telegram:</b> этот токен бота уже опрашивает другой процесс ' +
      '(CoPaw/QwenPaw, второй DSH или вебхук) — поэтому сюда не доходят сообщения. ' +
      'Останови тот процесс или возьми новый токен у @BotFather.' +
      (detail ? `\n\n<i>${detail}</i>` : ''),

    /* ---- settings card ---- */
    cardTitle: 'Telegram',
    cardDescription:
      'Канал Telegram: картинки, настоящие таблицы, вопросы с кнопками, смена модели прямо в чате.',
    unsaved: 'не сохранено',
    tokenLabel: 'Токен бота',
    tokenConfigured: 'настроен',
    tokenMissing: 'не задан',
    tokenUnknown: 'неизвестно',
    tokenPlaceholderSet: 'Сохранён — введите, чтобы заменить',
    tokenPlaceholderEmpty: 'Вставьте токен от @BotFather',
    tokenHint: (ref) =>
      `Токен хранится в credential ${ref}, а не в файле настроек. ` +
      'Пустое поле означает «оставить текущий».',
    languageLabel: 'Язык',
    languageHint: 'Действует и для сообщений бота, и для этой карточки.',
    enabledLabel: 'Включить канал Telegram',
    routeQuestionsLabel: 'Спрашивать прямо в Telegram',
    routeQuestionsHint:
      'Вопросы из telegram-сессии приходят кнопками в чат. Выключите — они появятся в веб-интерфейсе.',
    allowedLabel: 'Пользователи, которым разрешён бот',
    allowedHint:
      'Telegram user id через запятую. Пусто — бот не закреплён за владельцем: ' +
      'первый, кто отправит /start, станет владельцем.',
    workspaceLabel: 'Рабочий каталог',
    workspaceHint: 'Где агент выполняет команды и читает или записывает файлы.',
    restartNotice:
      'Токен, рабочий каталог и переключатель включения вступят в силу после перезапуска DSH.',
    reset: 'Сбросить',
    save: 'Сохранить',
    saving: 'Сохранение…',
    saved: 'Сохранено',
    discard: 'Отмена',
    saveFailed: 'Не удалось сохранить — проверьте значения',
  },
};


// Navigation and command copy share the channel's existing language setting.
Object.assign(DICTIONARY.ru, {
  "projectNone": "не выбран",
  "modeReadLabel": "🔒 Только чтение",
  "modeReadDescription": "Запись файлов запрещена",
  "modeWorkspaceLabel": "📝 Запись в проекте",
  "modeWorkspaceDescription": "Разрешена запись в рабочей папке",
  "modeFullLabel": "⚠️ Полный доступ",
  "modeFullDescription": "Доступ к файлам за пределами проекта",
  "presetStandardName": "Стандартный",
  "presetStandardDescription": "Обычная работа с проектом и инструментами",
  "presetPtcName": "Оркестрация PTC",
  "presetPtcDescription": "Программное управление рабочим процессом",
  "presetMinimalName": "Минимальный",
  "presetMinimalDescription": "Минимальный набор возможностей агента",
  "presetCordisName": "Разработка Cordis",
  "presetCordisDescription": "Работа с системой плагинов Cordis",
  "commandMenu": "Главное меню управления",
  "commandProjects": "Выбрать проект",
  "commandTasks": "Задачи выбранного проекта",
  "commandDone": "Завершённые задачи и результаты",
  "commandResult": "Итог выбранной задачи",
  "commandStart": "Открыть главное меню",
  "commandNew": "Создать новую задачу",
  "commandModel": "Выбрать модель",
  "commandPreset": "Выбрать режим новой задачи",
  "commandMode": "Выбрать разрешения",
  "commandStatus": "Статус выбранной задачи",
  "commandStop": "Остановить текущий ответ",
  "commandCompact": "Сжать историю беседы",
  "commandClear": "Начать новую беседу, сохранив старую",
  "commandHelp": "Помощь по командам",
  "commandFailed": "⚠️ Команда <code>/{0}</code> завершилась ошибкой: {1}",
  "helpTitle": "<b>Доступные команды</b>",
  "helpHint": "<i>Обычные сообщения продолжают выбранную задачу. Сначала выберите проект через /projects.</i>",
  "newTaskCreated": "🆕 Создана новая задача. Отправьте её описание.\n<code>{0}</code>",
  "noTaskSelected": "Задача ещё не выбрана. Откройте /menu.",
  "defaultValue": "(по умолчанию)",
  "awaitingDescription": "⚪ Ожидает описания задачи",
  "statusTitle": "<b>Статус задачи</b>",
  "statusTask": "Задача: <code>{0}</code>",
  "statusState": "Состояние: {0}",
  "statusModel": "Модель: <code>{0}</code>",
  "statusPreset": "Режим агента: <code>{0}</code>",
  "statusPermissions": "Разрешения: <code>{0}</code>",
  "statusFolder": "Папка: <code>{0}</code>",
  "noRunningResponse": "Нет выполняющегося ответа.",
  "stopRequested": "⏹ Отправлен запрос на остановку текущего ответа.",
  "noConversationToCompact": "Нет загруженной беседы для сжатия.",
  "compactionUnavailable": "Сервис сжатия истории недоступен в режиме этой задачи.",
  "compacting": "🗜 Сжимаю историю…",
  "compacted": "✅ История беседы сжата.",
  "compactionUnnecessary": "История пока не требует сжатия.",
  "modelsUnavailable": "Сервис моделей недоступен.",
  "modelNameNeeded": "{0} · (введите название модели)",
  "noProviders": "Провайдеры моделей не найдены.",
  "modelTitle": "<b>Выберите модель</b>",
  "currentValue": "Сейчас: <code>{0}</code>",
  "modelUnknown": "Текущая модель не определена.",
  "modelHint": "<i>Или введите: /model provider/model</i>",
  "modelFormat": "Формат: <code>/model provider/model</code>",
  "modelUnavailable": "⚠️ Модель недоступна: {0}",
  "modelSelected": "✅ Модель: <code>{0}</code>",
  "appliedToTask": "Применено к выбранной задаче.",
  "appliesNextResponse": "Применится со следующего ответа.",
  "presetsUnavailable": "Режимы агента недоступны.",
  "noPresets": "Нет доступных режимов агента.",
  "presetNotFound": "Режим не найден: <code>{0}</code>. Доступные варианты: {1}",
  "presetTitle": "<b>Выберите режим агента</b>",
  "presetHint": "<i>Новый режим применяется к новой задаче.</i>",
  "presetSelected": "✅ Режим агента: <code>{0}</code>\nИспользуйте /new, чтобы создать задачу с этим режимом.",
  "unknownPermissions": "Неизвестное разрешение. Выберите: {0}",
  "permissionsTitle": "<b>Разрешения на запись файлов</b>",
  "permissionsSelected": "✅ Разрешения: <code>{0}</code>",
  "choiceExpired": "Выбор устарел. Откройте меню снова.",
  "menuOtherUser": "Это меню другого пользователя.",
  "choiceUnavailable": "Вариант недоступен.",
  "modelNamePrompt": "Введите: <code>/model {0}/название-модели</code>",
  "stateCompleted": "✅ Завершена",
  "stateError": "❌ Ошибка",
  "stateAborted": "⏹ Остановлена",
  "stateInterrupted": "⚠️ Прервана",
  "stateBlocked": "⏸ Заблокирована",
  "stateMaxTokens": "⚠️ Лимит ответа",
  "stateForked": "⑂ Ответвление",
  "menuTitle": "<b>Управление харнесом</b>\n\n",
  "menuProject": "Проект: <b>{0}</b>\n",
  "menuHint": "Выберите проект или задачу. Обычные сообщения отправляются в выбранную задачу.",
  "buttonProjects": "📁 Проекты",
  "buttonTasks": "📋 Задачи",
  "buttonDone": "✅ Завершённые",
  "buttonResult": "📄 Итог задачи",
  "buttonNew": "➕ Новая задача",
  "buttonStatus": "📊 Статус",
  "buttonModel": "🤖 Модель",
  "buttonPreset": "🧩 Режим агента",
  "buttonPermissions": "🔐 Разрешения",
  "buttonStop": "⏹ Остановить",
  "buttonCompact": "🗜 Сжать историю",
  "buttonHelp": "❓ Помощь",
  "projectUnavailable": "Каталог проекта недоступен.",
  "projectSelected": "📁 Проект выбран: <b>{0}</b>\n<code>{1}</code>\nВыберите существующую задачу или отправьте описание новой.",
  "buttonMainMenu": "🏠 Главное меню",
  "projectsTitle": "<b>Проекты</b> · {0}\nВыберите рабочую папку проекта.",
  "buttonPrevious": "← Назад",
  "buttonNext": "Далее →",
  "stateRunning": "🟢 Выполняется",
  "stateWaiting": "⏳ Ожидает ответа",
  "stateNoAnswer": "⚪ Без завершённого ответа",
  "historyReadFailed": "Не удалось прочитать историю задачи",
  "historyUnavailable": "⚠️ История недоступна",
  "buttonMenu": "🏠 Меню",
  "tasksCompletedTitle": "Завершённые задачи",
  "tasksTitle": "Задачи проекта",
  "projectNotSelected": "Проект не выбран",
  "pageNumber": "Страница {0} из {1}.",
  "noTasks": "Задач пока нет.",
  "completedPageHint": "\nПоказаны задачи этой страницы с завершённым последним ответом агента.",
  "noCompletedTasks": "\nНа этой странице завершённых задач нет.",
  "taskNotFound": "Задача отсутствует в выбранном проекте. Обновите список.",
  "buttonViewResult": "📄 Посмотреть итог",
  "buttonSelectTask": "💬 Управлять этой задачей",
  "taskSelected": "💬 Выбрана задача: <b>{0}</b>\nСледующее сообщение продолжит эту беседу. /stop остановит её текущий ответ.",
  "buttonBackToTasks": "📋 К задачам",
  "resultTitle": "<b>Итог: {0}</b>\n{1}",
  "resultError": "Ошибка: {0}",
  "noTextResult": "Завершённого текстового ответа пока нет.",
  "menuExpired": "Меню устарело. Откройте /menu.",
  "toolUnknown": "инструмент",
  "toolBash": "⚙️ выполняю команду…",
  "toolRead": "📖 читаю файл…",
  "toolWrite": "✏️ записываю файл…",
  "toolEdit": "✏️ изменяю файл…",
  "toolGlob": "🔍 ищу файл…",
  "toolGrep": "🔍 ищу текст…",
  "toolWebSearch": "🌐 ищу в интернете…",
  "toolSubagent": "🤖 передаю работу субагенту…",
  "toolTodo": "📋 обновляю список задач…",
  "toolUsing": "⚙️ использую {0}…",
  "unknownError": "неизвестная ошибка",
  "imageUnsupportedTitle": "⚠️ <b>Текущая модель не принимает изображения.</b>",
  "imageUnsupportedHint": "Изображение сохранено в беседе, но модель не может его прочитать.",
  "imageModelHint": "Выберите модель с поддержкой изображений через <code>/model</code> или",
  "newConversationHint": "создайте новую беседу через <code>/new</code>.",
  "contentUnsupported": "⚠️ <b>Модель не может обработать это содержимое.</b>\n\n<i>{0}</i>",
  "responseFailed": "⚠️ <b>Не удалось получить ответ.</b>\n\n<i>{0}</i>",
  "taskOtherChat": "Этой задачей уже управляют из другого Telegram-чата."
});
Object.assign(DICTIONARY.en, {
  "projectNone": "not selected",
  "modeReadLabel": "🔒 Read only",
  "modeReadDescription": "File writes are disabled",
  "modeWorkspaceLabel": "📝 Write in project",
  "modeWorkspaceDescription": "Allow writes in the working directory",
  "modeFullLabel": "⚠️ Full access",
  "modeFullDescription": "Access files outside the project",
  "presetStandardName": "Standard",
  "presetStandardDescription": "Work with projects and tools",
  "presetPtcName": "PTC orchestration",
  "presetPtcDescription": "Programmatic workflow control",
  "presetMinimalName": "Minimal",
  "presetMinimalDescription": "Minimal agent capabilities",
  "presetCordisName": "Cordis development",
  "presetCordisDescription": "Work with the Cordis plugin system",
  "commandMenu": "Main control menu",
  "commandProjects": "Select a project",
  "commandTasks": "Tasks in the selected project",
  "commandDone": "Completed tasks and results",
  "commandResult": "Selected task result",
  "commandStart": "Open the main menu",
  "commandNew": "Create a new task",
  "commandModel": "Select a model",
  "commandPreset": "Select a preset for a new task",
  "commandMode": "Select permissions",
  "commandStatus": "Selected task status",
  "commandStop": "Stop the current response",
  "commandCompact": "Compact conversation history",
  "commandClear": "Start a new conversation and keep the old one",
  "commandHelp": "Command help",
  "commandFailed": "⚠️ Command <code>/{0}</code> failed: {1}",
  "helpTitle": "<b>Available commands</b>",
  "helpHint": "<i>Messages continue the selected task. First select a project with /projects.</i>",
  "newTaskCreated": "🆕 New task created. Send its description.\n<code>{0}</code>",
  "noTaskSelected": "No task selected yet. Open /menu.",
  "defaultValue": "(default)",
  "awaitingDescription": "⚪ Waiting for a task description",
  "statusTitle": "<b>Task status</b>",
  "statusTask": "Task: <code>{0}</code>",
  "statusState": "State: {0}",
  "statusModel": "Model: <code>{0}</code>",
  "statusPreset": "Agent preset: <code>{0}</code>",
  "statusPermissions": "Permissions: <code>{0}</code>",
  "statusFolder": "Folder: <code>{0}</code>",
  "noRunningResponse": "No response is running.",
  "stopRequested": "⏹ Requested to stop the current response.",
  "noConversationToCompact": "No loaded conversation to compact.",
  "compactionUnavailable": "History compaction is unavailable in this task's preset.",
  "compacting": "🗜 Compacting history…",
  "compacted": "✅ Conversation history compacted.",
  "compactionUnnecessary": "History does not need compaction yet.",
  "modelsUnavailable": "The model service is unavailable.",
  "modelNameNeeded": "{0} · (enter a model name)",
  "noProviders": "No model providers found.",
  "modelTitle": "<b>Select a model</b>",
  "currentValue": "Current: <code>{0}</code>",
  "modelUnknown": "The current model is unknown.",
  "modelHint": "<i>Or type: /model provider/model</i>",
  "modelFormat": "Format: <code>/model provider/model</code>",
  "modelUnavailable": "⚠️ Model unavailable: {0}",
  "modelSelected": "✅ Model: <code>{0}</code>",
  "appliedToTask": "Applied to the selected task.",
  "appliesNextResponse": "Applies from the next response.",
  "presetsUnavailable": "Agent presets are unavailable.",
  "noPresets": "No agent presets available.",
  "presetNotFound": "Preset not found: <code>{0}</code>. Available options: {1}",
  "presetTitle": "<b>Select an agent preset</b>",
  "presetHint": "<i>The new preset applies to a new task.</i>",
  "presetSelected": "✅ Agent preset: <code>{0}</code>\nUse /new to create a task with this preset.",
  "unknownPermissions": "Unknown permissions. Choose: {0}",
  "permissionsTitle": "<b>File write permissions</b>",
  "permissionsSelected": "✅ Permissions: <code>{0}</code>",
  "choiceExpired": "This selection has expired. Open the menu again.",
  "menuOtherUser": "This menu belongs to another user.",
  "choiceUnavailable": "This option is unavailable.",
  "modelNamePrompt": "Type: <code>/model {0}/model-name</code>",
  "stateCompleted": "✅ Completed",
  "stateError": "❌ Error",
  "stateAborted": "⏹ Stopped",
  "stateInterrupted": "⚠️ Interrupted",
  "stateBlocked": "⏸ Blocked",
  "stateMaxTokens": "⚠️ Response limit",
  "stateForked": "⑂ Forked",
  "menuTitle": "<b>Harness controls</b>\n\n",
  "menuProject": "Project: <b>{0}</b>\n",
  "menuHint": "Select a project or task. Messages are sent to the selected task.",
  "buttonProjects": "📁 Projects",
  "buttonTasks": "📋 Tasks",
  "buttonDone": "✅ Completed",
  "buttonResult": "📄 Task result",
  "buttonNew": "➕ New task",
  "buttonStatus": "📊 Status",
  "buttonModel": "🤖 Model",
  "buttonPreset": "🧩 Agent preset",
  "buttonPermissions": "🔐 Permissions",
  "buttonStop": "⏹ Stop",
  "buttonCompact": "🗜 Compact history",
  "buttonHelp": "❓ Help",
  "projectUnavailable": "The project directory is unavailable.",
  "projectSelected": "📁 Project selected: <b>{0}</b>\n<code>{1}</code>\nSelect an existing task or send a new task description.",
  "buttonMainMenu": "🏠 Main menu",
  "projectsTitle": "<b>Projects</b> · {0}\nSelect a project's working directory.",
  "buttonPrevious": "← Previous",
  "buttonNext": "Next →",
  "stateRunning": "🟢 Running",
  "stateWaiting": "⏳ Waiting for a response",
  "stateNoAnswer": "⚪ No completed response",
  "historyReadFailed": "Could not read task history",
  "historyUnavailable": "⚠️ History unavailable",
  "buttonMenu": "🏠 Menu",
  "tasksCompletedTitle": "Completed tasks",
  "tasksTitle": "Project tasks",
  "projectNotSelected": "No project selected",
  "pageNumber": "Page {0} of {1}.",
  "noTasks": "No tasks yet.",
  "completedPageHint": "\nShowing tasks on this page with a completed last agent response.",
  "noCompletedTasks": "\nNo completed tasks on this page.",
  "taskNotFound": "This task is missing from the selected project. Refresh the list.",
  "buttonViewResult": "📄 View result",
  "buttonSelectTask": "💬 Control this task",
  "taskSelected": "💬 Task selected: <b>{0}</b>\nYour next message continues this conversation. /stop stops its current response.",
  "buttonBackToTasks": "📋 Back to tasks",
  "resultTitle": "<b>Result: {0}</b>\n{1}",
  "resultError": "Error: {0}",
  "noTextResult": "No completed text response yet.",
  "menuExpired": "This menu has expired. Open /menu.",
  "toolUnknown": "tool",
  "toolBash": "⚙️ running a command…",
  "toolRead": "📖 reading a file…",
  "toolWrite": "✏️ writing a file…",
  "toolEdit": "✏️ editing a file…",
  "toolGlob": "🔍 finding files…",
  "toolGrep": "🔍 searching text…",
  "toolWebSearch": "🌐 searching the web…",
  "toolSubagent": "🤖 delegating to a subagent…",
  "toolTodo": "📋 updating the task list…",
  "toolUsing": "⚙️ using {0}…",
  "unknownError": "unknown error",
  "imageUnsupportedTitle": "⚠️ <b>The current model does not support images.</b>",
  "imageUnsupportedHint": "The image is saved in the conversation, but the model cannot read it.",
  "imageModelHint": "Select a model that supports images with <code>/model</code> or",
  "newConversationHint": "start a new conversation with <code>/new</code>.",
  "contentUnsupported": "⚠️ <b>The model cannot process this content.</b>\n\n<i>{0}</i>",
  "responseFailed": "⚠️ <b>Could not get a response.</b>\n\n<i>{0}</i>",
  "taskOtherChat": "This task is already controlled from another Telegram chat."
});

/** Human-readable names for the language picker, in their own language. */
export const LANGUAGE_NAMES = { vi: 'Tiếng Việt', en: 'English', ru: 'Русский' };

/**
 * Build a translator for one language.
 *
 * An unknown key returns the key itself rather than empty text: a visible
 * `tokenLabel` in the UI names the missing entry, while a blank label would
 * look like a rendering bug and hide which string was never written.
 *
 * @param {string} [language] one of {@link LANGUAGES}
 * @returns {(key: string, ...args: unknown[]) => string}
 */
export function translator(language) {
  const table = DICTIONARY[language] ?? DICTIONARY[DEFAULT_LANGUAGE];
  return (key, ...args) => {
    const entry = table[key] ?? DICTIONARY[DEFAULT_LANGUAGE][key];
    if (entry === undefined) return key;
    return typeof entry === 'function' ? entry(...args) : entry.replace(/\{(\d+)\}/g, (match, index) => args[index] === undefined ? match : String(args[index]));
  };
}
