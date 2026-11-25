let prefix = '';
try {
  prefix = ($('Interpret').all().find((i) => i.json.heard_prefix) || { json: {} }).json.heard_prefix || '';
} catch (e) { /* not from the router */ }

return $input.all().map(({ json: n }, i) => {
  const tags = String(n.tags || '').split(',').filter(Boolean).map((t) => `#${esc(t)}`).join(' ');
  const lines = [`${i === 0 ? prefix : ''}📝 <b>${esc(n.title)}</b>`];
  if (n.text && n.text.trim().toLowerCase() !== n.title.trim().toLowerCase()) lines.push(`<i>${esc(clip(n.text.replace(/\n+/g, ' '), 200))}</i>`);
  if (tags) lines.push(tags);
  return {
    json: {
      id: n.id, chat_id: n.chat_id, text: lines.join('\n') + hiddenRef(`n${n.id}`),
      log_role: 'bot', log_text: `записав нотатку n${n.id} «${n.title}»`, log_ids: `n${n.id}`,
    },
  };
});
