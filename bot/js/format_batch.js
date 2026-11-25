// One message for many created items (photo drafts, long lists) with "↩️ Скасувати все".
const undo = $input.first().json;
const rows = $('Insert task').all().map((i) => i.json).filter((t) => t && t.id);
const now = kyivNow();
const refs = rows.map((t) => `t${t.id}`);
const lines = rows.map((t, i) => {
  return `${i + 1}. ${esc(t.title)}${t.repeat ? ' 🔁' : ''} · <i>${whenShort(t, now)}${t.repeat ? `, ${repeatText(t.repeat)}` : ''}</i>${i >= MAX_BUTTONS ? ` /t${t.id}` : ''}`;
});
return [{
  json: {
    chat_id: undo.chat_id, mode: 'send',
    text: `✅ Створив ${rows.length}:\n${lines.join('\n')}`,
    btns: numberButtons(refs),
    nav: [navBtn('↩️ Скасувати все', `u:${undo.id}`), navBtn('🗓 Тиждень', `v:w:${dayKeyOf(now)}`)],
    log_role: 'bot', log_text: listLog('створені записи', refs, (ref) => (rows.find((t) => `t${t.id}` === ref) || {}).title || ''), log_ids: refs.join(','),
  },
}];
