// Moves recurring events whose occurrence is over to the next one (tasks roll only when marked done). A one-off
// event is over the day after it (status past): it is not «не виконано» then.
const nowMs = Date.now();
const todayKey = dayKeyOf(kyivNow());
const out = [];
for (const { json: t } of $input.all()) {
  if (!t || !t.id || t.kind !== 'event') continue;
  const s = parseWhen(t.starts_at);
  if (!s) continue;
  const end = parseWhen(t.ends_at) || s.plus({ hours: 1 });
  if (!parseRepeat(t.repeat)) {
    if (dayKeyOf(end) < todayKey) out.push({ json: { id: t.id, row: { ...pick(t, TASK_COLS), status: 'past', next_ts: null } } });
    continue;
  }
  if (end.toMillis() > nowMs) continue;
  const c = completeRow(t, nowMs);
  if (c.rolled) out.push({ json: { id: t.id, row: c.row } });
}
return out;
