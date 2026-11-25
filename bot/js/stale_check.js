// After the weekday morning plan: ask about one stuck task (moved 3+ times, or a week without a date).
// After the 17:00 check: ask about an overdue critical task (at most once a day each).
const r = $('Context').first().json;
const now = kyivNow();
const nowMs = now.toMillis();
const rows = rowsOf('Get open tasks');
const out = (t, text, kb, why) => [{
  json: {
    id: t.id, chat_id: r.chat_id, nudged_ts: nowMs, kb, text: text + hiddenRef(`t${t.id}`),
    log_role: 'bot', log_text: `спитав, що робити з t${t.id} «${t.title}» — ${why}`, log_ids: `t${t.id}`,
  },
}];

if (r.digest && r.view === 'nudge') {
  const hot = rows.filter((t) => prio(t) === 5 && t.kind !== 'event' && t.deadline && parseWhen(t.deadline).toMillis() < nowMs
    && !(Number(t.nudged_ts) > nowMs - 20 * 3600000)).sort((a, b) => parseWhen(a.deadline) - parseWhen(b.deadline))[0];
  if (!hot) return [];
  const d = parseWhen(hot.deadline);
  const since = dayKeyOf(d) === dayKeyOf(now) ? (isDateOnly(d) ? 'сьогодні' : `була до ${fmtTime(d)}`) : `з ${relDay(d, now)}`;
  return out(hot, `🔴 «${esc(hot.title)}» досі не зроблено — ${since}. Що робимо?`, 'hot', 'критична й прострочена');
}
if (r.view !== 'morning' || !r.digest || now.weekday >= 6) return [];
const x = pickStale(rows, nowMs);
if (!x) return [];
return out(x.t, staleText(x, nowMs), 'stale', x.reason === 'moves' ? `переносив ${x.t.moves} рази` : 'тиждень без дати');
