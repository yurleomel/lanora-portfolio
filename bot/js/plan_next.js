// Sends due reminders ("⏰ О 18:30 — Зустріч команди") and plans the next one for repeating rules.
// Items held back by quiet mode only get their next time planned (the pause summary lists them).
const nowMs = Date.now();
const now = kyivNow();

return $input.all().map(({ json: t }) => {
  let next = null;
  if (t.rule === 'daily_until_done') {
    next = nextDaily(parseHM(t.remind_time) || { hour: 9, minute: 0 }, nowMs);
  } else if (t.rule === 'interval' && t.every_minutes) {
    next = nextInterval(t.next_ts, t.every_minutes, nowMs);
  } else if (prio(t) === 5) {
    // Critical: one more ping an hour before a timed deadline (or start).
    const due = parseWhen(t.kind === 'event' ? t.starts_at : t.deadline);
    const lastCall = due && !isDateOnly(due) ? due.minus({ hours: 1 }).toMillis() : null;
    if (lastCall && lastCall - nowMs > 5 * 60000) next = lastCall;
  }

  return {
    json: {
      id: t.id, chat_id: t.chat_id, next_ts: next, held: Boolean(t.held), text: `⏰ ${reminderText(t, now)}${hiddenRef(`t${t.id}`)}`,
      log_text: `нагадав про t${t.id} «${t.title}»`, log_ids: `t${t.id}`,
    },
  };
});
