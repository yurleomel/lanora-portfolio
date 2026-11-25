// «Хто це — Ніна?» answered with a sphere, «👤 Просто людина» or «🙅 Не питай».
const r = $('Context').first().json;
const a = $input.first().json;
const out = [];
const push = (route, data) => out.push({ json: { route, chat_id: r.chat_id, ...data } });

if (!a || !a.id || a.kind !== 'person' || a.status !== 'new') {
  push('answer', { query_id: r.query_id, toast: 'Вже оброблено' });
  return out;
}
let d = {};
try { d = JSON.parse(a.ops || '{}'); } catch (e) { d = {}; }
const choice = Number(r.arg);
const name = d.name || a.text;
if (choice === PERSON_SKIP || !name) {
  push('action_used', { id: a.id, status: 'cancelled' });
  push('summary', { text: `Добре, більше не питатиму про «${esc(name || '')}».`, single: null, ops: '' });
  push('answer', { query_id: r.query_id, toast: 'Не питатиму' });
  push('log', { log_role: 'bot', log_text: `не записав ${name}: власник попросив не питати`, log_ids: '' });
  return out;
}
const sphere = choice >= 0 && choice < PERSON_SPHERES.length ? PERSON_SPHERES[choice] : null;
const plan = personPlan(vaultNotes(), name, sphere, d.user_text || a.user_text || '', kyivNow());
push('action_used', { id: a.id, status: 'used' });
if (!plan) {
  push('summary', { text: `«${esc(name)}» вже є — нічого не додаю.`, single: null, ops: '' });
  push('answer', { query_id: r.query_id, toast: 'Вже є' });
  return out;
}
push('kb_write', {
  text: `👤 Записав: <b>${esc(plan.where)}</b>${sphere ? ` (${esc(sphere)})` : ''}. Далі розумітиму, про кого мова.`,
  ops: plan.ops, user_text: d.user_text || a.user_text || '', log_text: `записав людину ${plan.where}${sphere ? ` — ${sphere}` : ''}`,
});
push('answer', { query_id: r.query_id, toast: 'Записав' });
return out;
