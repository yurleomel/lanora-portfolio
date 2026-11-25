const r = $('Context').first().json;
const t = $('Get task for card').first().json;
const steps = $input.all().map((i) => i.json).filter((s) => s && s.id && Number(s.parent_id) === t.id && s.status !== 'deleted');

if (!t || !t.id) {
  return [{ json: { id: 0, chat_id: r.chat_id, text: '⚠️ Такої задачі вже немає.', log_role: 'bot', log_text: 'задачу не знайдено', log_ids: '' } }];
}
const icon = t.kind === 'event' ? '🗓' : '📌';
const lines = [`${icon} <b>${esc(t.title)}</b>`];
const w = whenLine(t);
if (w) lines.push(w.replace(' · 🔔', '\n🔔'));
if (prio(t) !== 3) lines.push(`${pmark(t)}${PRIORITY_NAME[prio(t)][0].toUpperCase()}${PRIORITY_NAME[prio(t)].slice(1)}`);
if (areaLabel(t)) lines.push(areaLabel(t));
if (contextLabel(t)) lines.push(contextLabel(t));
if (t.status === 'done') lines.push('✅ виконано');
if (t.status === 'deleted') lines.push('🗑 видалено');
if (t.status === 'past') lines.push('🕓 минуло');
if (t.description) lines.push('', esc(t.description));
else if (!steps.length && t.source && t.source.trim().toLowerCase() !== String(t.title).trim().toLowerCase()) lines.push('', `💬 <i>${esc(clip(t.source, 300))}</i>`);
if (steps.length) {
  steps.sort((a, b) => a.id - b.id);
  lines.push('', `Кроки (${steps.filter((s) => s.status === 'done').length} з ${steps.length} готово):`);
  steps.forEach((s, i) => lines.push(`${i + 1}. ${s.status === 'done' ? `<s>${esc(s.title)}</s>` : `${esc(s.title)} /t${s.id}`}`));
}
return [{
  json: {
    id: t.id, chat_id: t.chat_id || r.chat_id, text: lines.join('\n') + hiddenRef(`t${t.id}`),
    log_role: 'bot', log_text: `показав картку t${t.id} «${t.title}»`, log_ids: `t${t.id}`,
  },
}];
