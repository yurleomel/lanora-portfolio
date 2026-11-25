// "✅ Створити все" / "✖️ Ні" under a photo draft.
const r = $('Context').first().json;
const a = $input.first().json;
const out = [];
const push = (route, data) => out.push({ json: { route, chat_id: r.chat_id, ...data } });

if (!a || !a.id || a.kind !== 'draft' || a.status !== 'new') {
  push('answer', { query_id: r.query_id, toast: 'Вже оброблено' });
  return out;
}
push('action_used', { id: a.id, status: r.arg === 'ok' ? 'used' : 'cancelled' });
if (r.arg !== 'ok') {
  push('summary', { text: '✖️ Добре, нічого не створюю.', single: null, ops: '' });
  push('answer', { query_id: r.query_id, toast: 'Скасовано' });
  push('log', { log_role: 'bot', log_text: 'користувач відхилив чернетку з фото', log_ids: '' });
  return out;
}
let items = [];
try { items = JSON.parse(a.ops || '[]'); } catch (e) { items = []; }
// Notes from the photo carry their knowledge-base plans: written together, one line with ↩️.
const plans = items.filter((b) => b.kind === 'note' && b.vault && Array.isArray(b.vault.ops)).map((b) => b.vault);
const updates = items.filter((b) => b.kind === 'update');
for (const b of updates) push('task_update', { id: b.id, task: b.task });
if (updates.length) {
  push('summary', { text: `✏️ Додав з фото в опис: ${updates.map((b) => `«${esc(b.title)}»`).join(', ')}`, single: null, ops: JSON.stringify(updates.map((b) => b.before)), user_text: a.user_text || '📷 фото' });
  push('log', { log_role: 'bot', log_text: `додав з фото в опис ${updates.map((b) => `t${b.id} «${b.title}»`).join(', ')}`, log_ids: updates.map((b) => `t${b.id}`).join(',') });
}
for (const b of items) {
  if (b.kind === 'update') continue;
  if (b.kind === 'note' && !(b.vault && Array.isArray(b.vault.ops))) push('create_note', { note: b.note });
  else if (b.kind !== 'note') push('create_task', { task: b.task, batch: items.length > 3 });
}
if (plans.length) {
  push('kb_write', { text: kbNotesText(plans), ops: mergePlans(plans).ops, user_text: a.user_text || '', log_text: `записав у базу знань з фото: ${plans.map((x) => x.where).join(', ')}` });
}
push('answer', { query_id: r.query_id, toast: updates.length === items.length ? 'Додано' : `Створюю: ${items.length - updates.length}` });
return out;
