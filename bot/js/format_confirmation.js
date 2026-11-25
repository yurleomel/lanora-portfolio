let prefix = '';
try {
  prefix = ($('Interpret').all().find((i) => i.json.heard_prefix) || { json: {} }).json.heard_prefix || '';
} catch (e) { /* created from a button */ }

const rows = $input.all().map((i) => i.json).filter((t) => t && t.id);

// More than three at once (photo drafts, long lists): one summary message with "↩️ Скасувати все".
if (rows.length > 3) {
  return [{
    json: {
      batch: true, chat_id: rows[0].chat_id, kind: 'undo', status: 'new', single: null,
      text: `створив ${rows.length} записів`,
      ops: JSON.stringify(rows.map((t) => ({ t: 'task', id: t.id, created: true, title: t.title }))),
      user_text: clip(rows[0].source || '', 300),
    },
  }];
}

// One line per item: "✅ Заявка на стажування — сьогодні до кінця дня".
return rows.map((t, i) => {
  const lines = [];
  const ctx = contextLabel(t);
  if (isUndated(t) && !t.next_ts && !ctx && !areaLabel(t) && prio(t) === 3) {
    lines.push(`📌 Без дати: ${esc(t.title)}`, '<i>Покажу вранці серед «Коли буде час».</i>');
  } else {
    const icon = t.kind === 'event' ? '🗓' : '✅';
    const at = isUndated(t) ? '' : ` — ${whenShort(t)}`;
    const extra = [];
    if (prio(t) !== 3) extra.push(`${pmark(t)}${PRIORITY_NAME[prio(t)]}`);
    if (areaLabel(t)) extra.push(areaLabel(t));
    if (ctx) extra.push(ctx);
    if (t.repeat) extra.push(`🔁 ${repeatText(t.repeat)}`);
    if (!isDefaultReminder(t) && t.next_ts) extra.push(ruleText(t) ? `нагадую ${ruleText(t)}` : `нагадаю ${when(DateTime.fromMillis(t.next_ts, { zone: TZ }))}`);
    lines.push(`${icon} ${esc(t.title)}${at}${extra.length ? ` · ${extra.join(' · ')}` : ''}`);
  }
  return {
    json: {
      batch: false, id: t.id, chat_id: t.chat_id, text: (i === 0 ? prefix : '') + lines.join('\n') + hiddenRef(`t${t.id}`),
      log_role: 'bot', log_text: `створив t${t.id} «${t.title}» (${whenShort(t)})`, log_ids: `t${t.id}`,
    },
  };
});
