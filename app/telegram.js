// Telegram Bot API over fetch: long polling, messages with HTML and keyboards, edits, callback answers, files.
const MAX_BUTTONS = 12;

function client(token) {
  const base = `https://api.telegram.org/bot${token}`;
  async function call(method, body, { soft = false, timeoutMs = 20000 } = {}) {
    const t0 = Date.now();
    try {
      const res = await fetch(`${base}/${method}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(`Telegram ${method}: ${j.error_code} ${j.description}`);
      return j.result;
    } catch (e) {
      // Edits, answers and «typing» were "continue on error" in n8n: a stale button must not break the run.
      if (soft) return null;
      throw e;
    } finally {
      if (method !== 'getUpdates' && Date.now() - t0 > 3000) console.log(`slow Telegram ${method}: ${Date.now() - t0} ms`);
    }
  }
  const html = { parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
  return {
    getUpdates: (offset) => call('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, { timeoutMs: 65000 }),
    deleteWebhook: () => call('deleteWebhook', { drop_pending_updates: false }),
    send: (chatId, text, markup) => call('sendMessage', { chat_id: chatId, text: String(text ?? ''), ...html, ...(markup ? { reply_markup: markup } : {}) }),
    edit: (chatId, messageId, text, markup) => call('editMessageText', { chat_id: chatId, message_id: messageId, text: String(text ?? ''), ...html, ...(markup ? { reply_markup: markup } : {}) }, { soft: true }),
    answer: (queryId, text) => (queryId ? call('answerCallbackQuery', { callback_query_id: queryId, ...(text ? { text: String(text) } : {}) }, { soft: true }) : null),
    typing: (chatId) => call('sendChatAction', { chat_id: chatId, action: 'typing' }, { soft: true }),
    async download(fileId) {
      const f = await call('getFile', { file_id: fileId });
      const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { signal: AbortSignal.timeout(60000) });
      return Buffer.from(await res.arrayBuffer()).toString('base64');
    },
  };
}

const inline = (rows) => (rows && rows.some((r) => r.length) ? { inline_keyboard: rows.filter((r) => r.length).map((r) => r.map(([text, data]) => ({ text, callback_data: String(data) }))) } : null);

// The numbered keyboards n8n built as fixed variants: up to 6 numbers in one row, 7–12 in two (the first holds
// (k+1)/2), then the nav row; buttons beyond 12 are already /tN commands in the text.
function numbered(btns = [], nav = []) {
  const nums = (btns || []).slice(0, MAX_BUTTONS).map((b) => [b.t, b.d]);
  const split = nums.length <= 6 ? nums.length : Math.floor((nums.length + 1) / 2);
  return inline([nums.slice(0, split), nums.slice(split), (nav || []).map((b) => [b.t, b.d])]);
}

const KB = {
  // No «✅ Готово» under a task just created or changed: it was tapped by mistake there.
  task: (id) => inline([[['✏️ Змінити', `edit:${id}`], ['🗑', `del:${id}`]]]),
  taskFull: (id) => inline([[['✅ Готово', `done:${id}`], ['✏️ Змінити', `edit:${id}`]],
    [['⏰ 1 год', `snz:${id}:60`], ['🌆 Ввечері', `snz:${id}:eve`], ['📅 Завтра', `snz:${id}:tmr`]], [['🗑 Видалити', `del:${id}`]]]),
  note: (id) => inline([[['📌 Зробити задачею', `n2t:${id}`], ['🗑 Видалити', `ndel:${id}`]]]),
  summaryCard: (id, single, close = false) => inline([[['↩️ Скасувати', `u:${id}`], ...(close ? [['✅ Закрити справу', `done:${single}`]] : [['✏️ Змінити', `edit:${single}`]])]]),
  draft: (id, label = '✅ Створити все') => inline([[[label, `dr:${id}:ok`], ['✖️ Ні', `dr:${id}:no`]]]),
  undo: (id) => inline([[['↩️ Скасувати', `u:${id}`]]]),
  dupe: (id) => inline([[['Оновити', `dp:${id}:upd`], ['Створити окрему', `dp:${id}:new`]]]),
  conflict: (id) => inline([[['✅ Все одно', `cf:${id}:new`], ['✖️ Ні', `cf:${id}:no`]]]),
  person: (id) => inline([[['Робота', `pp:${id}:0`], ['Навчання', `pp:${id}:1`], ['Дім', `pp:${id}:2`], ['Хобі', `pp:${id}:3`]],
    [['👤 Просто людина', `pp:${id}:4`], ['🙅 Не питай', `pp:${id}:5`]]]),
  later: (id) => inline([[['⏰ 1 год', `snz:${id}:60`], ['🌆 Ввечері', `snz:${id}:eve`], ['📅 Завтра', `snz:${id}:tmr`]]]),
  stale: (id) => inline([[['🪜 Розбити', `st:${id}:split`], ['🕐 Поставити час', `edit:${id}`], ['🗑 Прибрати', `del:${id}`]]]),
  hot: (id) => inline([[['✅ Готово', `done:${id}`], ['⏰ Пізніше', `later:${id}`], ['🕐 Інший час', `edit:${id}`]]]),
  reminder: (id) => inline([[['✅ Готово', `done:${id}`], ['⏰ Пізніше', `later:${id}`]]]),
  forceReply: { force_reply: true },
  menu: { keyboard: [[{ text: '📅 Сьогодні' }, { text: '🗓 Тиждень' }], [{ text: '📋 Задачі' }, { text: '📝 Нотатки' }]], resize_keyboard: true },
};

module.exports = { client, numbered, KB };
