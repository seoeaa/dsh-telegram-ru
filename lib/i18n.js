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
    return typeof entry === 'function' ? entry(...args) : entry;
  };
}
