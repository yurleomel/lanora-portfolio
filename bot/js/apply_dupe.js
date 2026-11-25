// "Оновити" / "Створити окрему" when a new task looked like an existing one,
// and "✅ Все одно" / "✖️ Ні" when a new event overlapped another one.
const r = $('Context').first().json;
const a = $input.first().json;
const out = [];
const push = (route, data) => out.push({ json: { route, chat_id: r.chat_id, ...data } });

if (!a || !a.id || !['dupe', 'conflict'].includes(a.kind) || a.status !== 'new') {
  push('answer', { query_id: r.query_id, toast: 'Вже оброблено' });
  return out;
}
let d = {};
try { d = JSON.parse(a.ops || '{}'); } catch (e) { d = {}; }
push('action_used', { id: a.id, status: r.arg === 'no' ? 'cancelled' : 'used' });

if (a.kind === 'conflict') {
  if (r.arg === 'new' && d.task) {
    push('create_task', { task: d.task });
    push('answer', { query_id: r.query_id, toast: 'Ставлю' });
  } else {
    push('say', { text: 'Добре, не ставлю. Напиши інший час.' });
    push('answer', { query_id: r.query_id, toast: 'Не ставлю' });
    push('log', { log_role: 'bot', log_text: `не став «${(d.task || {}).title || ''}» через накладку, попросив інший час`, log_ids: '' });
  }
  return out;
}

if (r.arg === 'new' || !d.target) {
  push('create_task', { task: d.task });
  push('answer', { query_id: r.query_id, toast: 'Створюю окрему' });
  return out;
}
const target = rowsOf('Get open tasks').find((t) => t.id === d.target);
if (!target) {
  push('create_task', { task: d.task });
  push('answer', { query_id: r.query_id, toast: 'Старої вже немає — створюю нову' });
  return out;
}
const nowMs = Date.now();
const row = applyPatch(target, d.set || {}, [], nowMs);
const changes = diffText(target, row, nowMs).filter((c) => !c.startsWith('назва'));
push('task_update', { id: target.id, task: row });
push('summary', {
  text: `✏️ ${esc(target.title)}: ${changes.join(', ') || 'без змін'}`, single: target.id,
  ops: JSON.stringify([snapshot('task', target)]), user_text: a.user_text || '',
});
push('answer', { query_id: r.query_id, toast: 'Оновив' });
push('log', { log_role: 'bot', log_text: `оновив t${target.id} «${target.title}» замість дубля: ${changes.join(', ')}`, log_ids: `t${target.id}` });
return out;
