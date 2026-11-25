// "📅 Все на завтра" button.
const r = $('Context').first().json;
const { out, moved } = planMove(rowsOf('Get open tasks'), Date.now(), r.chat_id);
out.push({ route: 'answer', chat_id: r.chat_id, query_id: r.query_id, toast: moved.length ? `Перенесено: ${moved.length}` : 'Нічого переносити' });
return out.map((json) => ({ json }));
