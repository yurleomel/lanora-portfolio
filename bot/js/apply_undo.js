// "↩️ Скасувати": restores the snapshots stored in lanora_actions and marks the action used.
const r = $('Context').first().json;
const a = $input.first().json;
const out = [];
const push = (route, data) => out.push({ json: { route, chat_id: r.chat_id, ...data } });

if (!a || !a.id || a.kind !== 'undo') {
  push('answer', { query_id: r.query_id, toast: 'Нема чого скасовувати' });
  return out;
}
if (a.status !== 'new') {
  push('answer', { query_id: r.query_id, toast: 'Вже скасовано' });
  return out;
}

let ops = [];
try { ops = JSON.parse(a.ops || '[]'); } catch (e) { ops = []; }
const names = [];
for (const op of ops) {
  // Knowledge-base writes (entities, entries, links, tasks moved by a merge) are restored by the service.
  if (op.kb) {
    push('kb_restore', { snap: op });
    names.push(op.title || '…');
    continue;
  }
  if (op.created) {
    push(op.t === 'note' ? 'note_status' : 'task_status', { id: op.id, status: 'deleted' });
    names.push(op.title || `${op.t === 'note' ? 'n' : 't'}${op.id}`);
  } else if (op.before) {
    push(op.t === 'note' ? 'note_update' : 'task_update', { id: op.id, [op.t === 'note' ? 'note' : 'task']: op.before });
    names.push(op.before.title);
  }
}
push('action_used', { id: a.id, status: 'used' });
push('summary', { text: names.length ? `↩️ Скасовано:\n${names.map((n) => `• ${esc(n)}`).join('\n')}` : '↩️ Нема чого скасовувати.', single: null, ops: '' });
push('answer', { query_id: r.query_id, toast: 'Скасовано' });
push('log', {
  log_role: 'bot',
  log_text: `користувач натиснув «Скасувати» — бот помилився у відповідь на «${clip(a.user_text || '', 200)}»; відновив: ${names.join(', ')}`,
  log_ids: ops.filter((o) => !o.kb).map((o) => `${o.t === 'note' ? 'n' : 't'}${o.id}`).join(','),
});
return out;
