// "🔔 Поки була тиша: …" — one message with everything held back by an ended pause; closes the pause.
const nowMs = Date.now();
const now = kyivNow();
const state = pauseState(rowsOf('Get pause'), nowMs);
if (state.active || !state.ended.length) return [];
// Events that are already over are not worth a mention.
const due = rowsOf('Due tasks').filter((t) => !(t.kind === 'event' && parseWhen(t.starts_at) && parseWhen(t.starts_at).toMillis() < nowMs));
const out = state.ended.map((a) => ({ json: { kind: 'close', id: a.id, status: 'used' } }));
if (due.length) {
  const refs = due.map((t) => `t${t.id}`);
  out.push({
    json: {
      kind: 'send', chat_id: due[0].chat_id,
      text: `🔔 Поки була тиша:\n${due.map((t, i) => `${i + 1}. ${reminderText(t, now)}${i >= MAX_BUTTONS ? ` /t${t.id}` : ''}`).join('\n')}`,
      btns: numberButtons(refs), nav: [],
      log_text: listLog('що пропустив за тишу', refs, (ref) => (due.find((t) => `t${t.id}` === ref) || {}).title || ''), log_ids: refs.join(','),
    },
  });
}
return out;
