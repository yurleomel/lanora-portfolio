// Fired by the 9:00 / 17:00 / 21:00 schedule triggers; Sunday 21:00 is the weekly review, weekends skip 17:00.
const now = kyivNow();
if (pauseState(rowsOf('Get pause (digest)'), now.toMillis()).active) return []; // quiet mode: no digests
const h = now.hour;
let view = h < 11 ? 'morning' : h < 20 ? 'nudge' : 'evening';
if (view === 'evening' && now.weekday === 7) view = 'weekly';
if (view === 'nudge' && now.weekday >= 6) return []; // no 17:00 check on weekends
return [{ json: { kind: 'view', view, chat_id: OWNER_ID, date: dayKeyOf(now), mode: 'send', digest: true } }];
