const r = $('Context').first().json;
const n = $input.first().json;
const base = { query_id: r.query_id, chat_id: r.chat_id, message_id: r.message_id, create_task: false, task: null, log_role: 'bot' };

if (!n || !n.id) {
  return [{ json: { ...base, id: -1, status: 'missing', toast: 'Нотатку не знайдено', text: '⚠️ Цієї нотатки вже немає.', log_text: 'нотатку не знайдено', log_ids: '' } }];
}
const ref = `n${n.id}`;
const title = esc(n.title);
const keep = pick(n, NOTE_COLS);
if (n.status !== 'active') {
  return [{ json: { ...base, id: n.id, note: keep, status: n.status, toast: 'Вже оброблено', text: `📝 <s>${title}</s>${hiddenRef(ref)}`, log_text: `${ref} вже оброблена`, log_ids: ref } }];
}
if (r.action === 'ndel') {
  return [{ json: { ...base, id: n.id, note: { ...keep, status: 'deleted' }, status: 'deleted', toast: 'Видалено', text: `🗑 <s>${title}</s>${hiddenRef(ref)}`, log_text: `видалив нотатку ${ref}`, log_ids: ref } }];
}
if (r.action === 'n2t') {
  return [{
    json: {
      ...base, id: n.id, note: { ...keep, status: 'converted' }, status: 'converted', create_task: true,
      task: {
        chat_id: n.chat_id, title: n.title, description: n.text && n.text !== n.title ? n.text : null, kind: 'task',
        deadline: null, starts_at: null, ends_at: null, rule: 'none', remind_time: null, every_minutes: null,
        next_ts: null, status: 'open', source: String(n.text || n.title).slice(0, 1000),
      },
      toast: 'Тепер це задача',
      text: `📌 <b>${title}</b> — тепер задача.\n<i>Напиши, до коли — і я поставлю дедлайн.</i>${hiddenRef(ref)}`,
      log_text: `перетворив нотатку ${ref} «${n.title}» на задачу`, log_ids: ref,
    },
  }];
}
return [{ json: { ...base, id: n.id, note: keep, status: n.status, toast: 'Невідома дія', text: `<b>${title}</b>${hiddenRef(ref)}`, log_text: 'невідома дія', log_ids: ref } }];
