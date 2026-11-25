const r = $('Context').first().json;
const n = $input.first().json;

if (!n || !n.id || n.status !== 'active') {
  return [{ json: { id: 0, chat_id: r.chat_id, text: '⚠️ Такої нотатки вже немає.', log_role: 'bot', log_text: 'нотатку не знайдено', log_ids: '' } }];
}
const tags = String(n.tags || '').split(',').filter(Boolean).map((t) => `#${esc(t)}`).join(' ');
const date = n.createdAt ? when(DateTime.fromISO(n.createdAt).setZone(TZ)) : '';
const lines = [`📝 <b>${esc(n.title)}</b>`, '', esc(String(n.text || '').slice(0, 3500))];
lines.push('', [tags, date ? `<i>${date}</i>` : ''].filter(Boolean).join(' · '));
return [{
  json: {
    id: n.id, chat_id: n.chat_id, text: lines.join('\n') + hiddenRef(`n${n.id}`),
    log_role: 'bot', log_text: `показав нотатку n${n.id} «${n.title}»`, log_ids: `n${n.id}`,
  },
}];
