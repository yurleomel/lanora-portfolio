const TZ = 'Europe/Kyiv';
const OWNER_ID = __OWNER_ID__;
const BOT_USERNAME = String(process.env.BOT_USERNAME || '');
const BOT_URL = /^[A-Za-z0-9_]{5,32}$/.test(BOT_USERNAME) ? 'https://t.me/' + BOT_USERNAME : '';
const LATE_NIGHT_HOUR = 5;
const EVENT_REMIND_BEFORE_MIN = 60;
const MAX_BUTTONS = 12;
const GEMINI_FAST = 'gemini-3.5-flash-lite';
// The «second opinion» (long messages, photos, doubted replies, the whole base): 3.8-flash timed out and returned
// 503/429 on the free keys (24.10), 3.5-flash of the same generation as the fast one answers in about a second.
const GEMINI_STRONG = 'gemini-3.5-flash';
const WEEKDAY_UK = ['', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя'];
const MONTH_UK = ['', 'січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];

// ---------- time ----------

function kyivNow() {
  return DateTime.now().setZone(TZ);
}

// Times are Kyiv wall-clock: Gemini often writes the current UTC offset for dates past a DST switch
// ("2026-10-26T10:00+03:00" when it is +02:00), so a numeric offset is ignored and the wall time kept.
// A trailing "Z" is a real UTC instant (system timestamps such as createdAt) and is converted.
function parseWhen(iso) {
  if (!iso) return null;
  const s = String(iso).trim();
  if (/[zZ]$/.test(s)) {
    const u = DateTime.fromISO(s, { setZone: true });
    return u.isValid ? u.setZone(TZ) : null;
  }
  const d = DateTime.fromISO(s, { setZone: true });
  if (!d.isValid) return null;
  return DateTime.fromObject({ year: d.year, month: d.month, day: d.day, hour: d.hour, minute: d.minute, second: d.second }, { zone: TZ });
}

function toIso(dt) {
  return dt ? dt.setZone(TZ).toISO({ suppressMilliseconds: true }) : null;
}

function parseHM(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

function hmText(hm) {
  return `${String(hm.hour).padStart(2, '0')}:${String(hm.minute).padStart(2, '0')}`;
}

function nextDaily(hm, afterMs) {
  let c = DateTime.fromMillis(afterMs, { zone: TZ }).set({ ...hm, second: 0, millisecond: 0 });
  if (c.toMillis() <= afterMs) c = c.plus({ days: 1 });
  return c.toMillis();
}

function nextInterval(prevMs, everyMin, nowMs) {
  const step = everyMin * 60000;
  let n = (prevMs || nowMs) + step;
  if (n <= nowMs) n += Math.ceil((nowMs - n + 1) / step) * step;
  return n;
}

function isDateOnly(dt) {
  return dt.hour === 23 && dt.minute === 59;
}

function dayKeyOf(dt) {
  return dt.setZone(TZ).toFormat('yyyy-LL-dd');
}

// "Logical today": before LATE_NIGHT_HOUR the user has not slept yet, so "завтра" is still the current date.
function logicalTomorrow(now) {
  return now.hour < LATE_NIGHT_HOUR ? now.startOf('day') : now.startOf('day').plus({ days: 1 });
}

function parseDayArg(s, now) {
  const t = String(s || '').trim().toLowerCase().replace(/['’`]/g, 'ʼ');
  const today = now.startOf('day');
  const late = now.hour < LATE_NIGHT_HOUR;
  if (!t || t === 'сьогодні' || t === 'today') return today;
  if (t === 'завтра' || t === 'tomorrow') return logicalTomorrow(now);
  if (t === 'післязавтра') return today.plus({ days: late ? 1 : 2 });
  if (t === 'вчора') return today.minus({ days: 1 });
  const WD = {
    пн: 1, понеділок: 1, вт: 2, вівторок: 2, ср: 3, середа: 3, середу: 3, чт: 4, четвер: 4,
    пт: 5, пʼятниця: 5, пʼятницю: 5, пятниця: 5, пятницю: 5, сб: 6, субота: 6, суботу: 6,
    нд: 7, неділя: 7, неділю: 7,
  };
  if (WD[t]) return today.plus({ days: (WD[t] - today.weekday + 7) % 7 });
  let m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?$/.exec(t);
  if (m) {
    const year = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : today.year;
    const d = DateTime.fromObject({ year, month: Number(m[2]), day: Number(m[1]) }, { zone: TZ });
    return d.isValid ? d : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) {
    const d = DateTime.fromISO(m[0], { zone: TZ });
    return d.isValid ? d : null;
  }
  return null;
}

// Snooze targets for buttons: minutes, "eve" (19:00) or "tmr" (09:00 tomorrow).
function snoozeTo(arg, nowMs) {
  const now = DateTime.fromMillis(nowMs, { zone: TZ });
  if (arg === 'eve') {
    const eve = now.set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
    return (eve.toMillis() - nowMs > 10 * 60000 ? eve : eve.plus({ days: 1 })).toMillis();
  }
  if (arg === 'tmr') return logicalTomorrow(now).set({ hour: 9 }).toMillis();
  return nowMs + Math.max(1, Number(arg) || 60) * 60000;
}

// ---------- formatting ----------

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fmtTime(dt) {
  return dt.setZone(TZ).toFormat('HH:mm');
}

function fmtDay(dt) {
  return dt.setZone(TZ).setLocale('uk').toFormat('ccc dd.LL');
}

function fmt(ms) {
  return DateTime.fromMillis(ms, { zone: TZ }).setLocale('uk').toFormat('ccc dd.LL HH:mm');
}

function longDay(dt) {
  const d = dt.setZone(TZ);
  const wd = WEEKDAY_UK[d.weekday];
  return `${wd[0].toUpperCase()}${wd.slice(1)}, ${d.day} ${MONTH_UK[d.month]}`;
}

// At night the owner's «завтра» is still the current date (see logicalTomorrow), so the bot's own
// «завтра»/«вчора» would be read a day off: the weekday and date are named instead. «Післязавтра»
// always becomes «пт 23.10» — the weekday is what the owner says and checks against.
function relDay(dt, now = kyivNow()) {
  const diff = Math.round(dt.setZone(TZ).startOf('day').diff(now.startOf('day'), 'days').days);
  const night = now.hour < LATE_NIGHT_HOUR;
  if (diff === 0) return 'сьогодні';
  if (diff === 1 && !night) return 'завтра';
  if (diff === -1 && !night) return 'вчора';
  return fmtDay(dt);
}

// "сьогодні 20:00", "завтра", "чт 22.10 10:00"
function when(dt, now = kyivNow(), withTime = true) {
  const day = relDay(dt, now);
  return withTime && !isDateOnly(dt) ? `${day} ${fmtTime(dt)}` : day;
}

function ago(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  if (min < 60) return `${min} хв`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} год`;
  return `${Math.round(h / 24)} дн`;
}

function humanMinutes(m) {
  if (m % 1440 === 0) return `${m / 1440} дн.`;
  if (m % 60 === 0) return `${m / 60} год.`;
  return `${m} хв`;
}

function ruleText(t) {
  switch (t.rule) {
    case 'daily_until_done': return `щодня о ${t.remind_time}`;
    case 'interval': return `кожні ${humanMinutes(t.every_minutes)}`;
    default: return '';
  }
}

function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

function hiddenRef(ref) {
  if (!BOT_URL) return '';
  return `<a href="${BOT_URL}?start=${ref}">&#8203;</a>`;
}

function clip(s, n) {
  const t = String(s || '').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

// One-line "when" for a task/event: ⏳ / 🕡 / 🔥 plus reminder.
function whenLine(t, nowMs = Date.now()) {
  const now = DateTime.fromMillis(nowMs, { zone: TZ });
  const parts = [];
  if (t.kind === 'event') {
    const s = parseWhen(t.starts_at);
    const e = parseWhen(t.ends_at);
    if (s) parts.push(`🕡 ${relDay(s, now)} ${fmtTime(s)}${e ? `–${fmtTime(e)}` : ''}`);
  } else {
    const d = parseWhen(t.deadline);
    if (d && d.toMillis() < nowMs && t.status !== 'done') parts.push(`🔥 прострочено на ${ago(nowMs - d.toMillis())} (було ${when(d, now)})`);
    else if (d) parts.push(`⏳ ${relDay(d, now)}${isDateOnly(d) ? ', до кінця дня' : ` до ${fmtTime(d)}`}`);
  }
  if (t.next_ts) {
    const n = DateTime.fromMillis(t.next_ts, { zone: TZ });
    const sameDay = parts.length && dayKeyOf(n) === dayKeyOf(parseWhen(t.starts_at || t.deadline) || n);
    parts.push(`🔔 ${sameDay ? `о ${fmtTime(n)}` : when(n, now)}${ruleText(t) ? ` · ${ruleText(t)}` : ''}`);
  } else if (ruleText(t)) {
    parts.push(`🔔 ${ruleText(t)}`);
  }
  if (t.repeat && repeatText(t.repeat)) parts.push(`🔁 ${repeatText(t.repeat)}`);
  return parts.join(' · ');
}

// The key itself failed — out of prepaid credits (402), rate-limited (429), revoked (401/403): another key helps,
// another model on the same key does not.
function keyFailure(res) {
  return Boolean(res && res.error) && /\b(401|402|403|429)\b|RESOURCE_EXHAUSTED|PERMISSION_DENIED|API key/i.test(JSON.stringify(res.error));
}

// The Gemini keys (GEMINI_KEYS in the service's .env, from the GEMINI_API_KEY_* lines of .envi) are equal and take
// turns: the bot remembers the one that works and moves on to the next only when it fails as a key, so a message
// costs one call on a live key — no tries on a dead one first. The service sets the count; tests use 3.
const GEMINI_KEYS = Number(globalThis.GEMINI_KEY_COUNT) || 3;
function geminiKey() {
  const k = Number($getWorkflowStaticData('global').geminiKey);
  return Number.isInteger(k) && k >= 0 && k < GEMINI_KEYS ? k : 0;
}
function setGeminiKey(k) {
  $getWorkflowStaticData('global').geminiKey = ((k % GEMINI_KEYS) + GEMINI_KEYS) % GEMINI_KEYS;
}

// Is a Gemini router reply usable? Garbage, an unknown intent, or an action without its data («split» without
// steps, «create» without records, a query without a view) goes to the strong model instead of «не зрозумів».
const INTENTS = ['create', 'edit', 'complete', 'delete', 'move_pending', 'query', 'answer', 'chat', 'clarify', 'split', 'pause', 'resume'];
function replyOk(res) {
  try {
    const raw = (res.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
    const p = JSON.parse(raw);
    if (!p || !INTENTS.includes(p.intent)) return false;
    const has = (v) => Array.isArray(v) && v.length > 0;
    if (p.intent === 'create' || p.intent === 'edit') return has(p.items) || has(p.edits) || has(p.done) || has(p.removed) || has(p.kb);
    if (p.intent === 'split') return has(p.items);
    if (p.intent === 'query') return Boolean(p.query && p.query.view);
    if (p.intent === 'answer') return Boolean(p.reply || has(p.about) || p.web);
    return true;
  } catch (e) {
    return false;
  }
}

// Records the reply changes (edits, done, removed, complete/delete targets) that nothing in the message or the
// last bot turns points to: no word of their title, not the replied-to message, not in the last 3 bot rows.
// A fast reply touching such a record is a guess («поки не здам звіт» → the essay) and goes to the strong model.
// A project or person name may appear in many tasks and cannot identify a task on its own.
// Does the message name this record itself: a word of its title (not just a shared project or person name) or «t12»?
function wordAnchored(ref, text, openRows, noteRows, vault = []) {
  const names = vault.flatMap((n) => [n.name, ...(n.aliases || [])]).map((x) => String(x).toLowerCase());
  const said = String(text || '').toLowerCase();
  if (new RegExp(`(?<![\\p{L}\\d])${ref}(?!\\d)`, 'u').test(said)) return true;
  const words = said.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !names.some((x) => sameWord(w, x)));
  const t = (ref[0] === 't' ? openRows : noteRows).find((x) => `${ref[0]}${x.id}` === ref);
  return Boolean(t) && stems(t.title).some((st) => words.some((w) => sameWord(w, st)));
}

// Short replies and pronouns («перенеси на сьогодні», «її на 21») lean on what the bot said last.
function shortReply(text) {
  const said = String(text || '').toLowerCase();
  return said.split(/\s+/).filter(Boolean).length <= 5 || /(?<!\p{L})(її|його|неї|нього|цю|ту|тої|той|те|це|цей|останн\p{L}*)(?!\p{L})/u.test(said);
}

// The one record the bot's latest row was about («нагадав про t6», «показав справи для «Олег»: №1 → t22»), if one.
function lastSingleRef(dialogRows) {
  const last = dialogRows.filter((d) => d.role === 'bot').sort((a, b) => b.ts - a.ts)[0];
  const ids = String((last && last.item_ids) || '').split(',').filter(Boolean);
  return ids.length === 1 ? ids[0] : null;
}

function unanchoredRefs(p, text, replyRef, openRows, noteRows, dialogRows, vault = []) {
  const refs = [...(p.edits || []).map((e) => e && e.target), ...(p.done || []), ...(p.removed || []),
    ...(['complete', 'delete'].includes(p.intent) ? p.targets || [] : [])].filter((x) => /^[tn]\d+$/.test(String(x)));
  // A short reply leans on the last 3 bot rows. A message with its own content leans only on the very last one,
  // and not on a list (a day list names half of the open tasks).
  const bots = dialogRows.filter((d) => d.role === 'bot').sort((a, b) => b.ts - a.ts);
  const recent = (shortReply(text) ? bots.slice(0, 3) : bots.slice(0, 1).filter((d) => !/№1 →/.test(d.text || '')))
    .map((d) => `,${d.item_ids || ''},`).join('');
  return [...new Set(refs)].filter((ref) => ref !== replyRef && !recent.includes(`,${ref},`) && !wordAnchored(ref, text, openRows, noteRows, vault));
}

// A chat reply to a message about a known person or project, or right after «Хто це — X?», is most likely a fact
// to file that the fast model only chatted about («Тарас і друг, і у спільноті зі мною» → «Круто!»): it is redone.
function chatOverFacts(p, text, vault, dialogRows) {
  if (p.intent !== 'chat') return false;
  const last = dialogRows.filter((d) => d.role === 'bot').sort((a, b) => b.ts - a.ts)[0];
  return vaultMentions(vault, text).length > 0 || /^(спитав, хто це|записав людину)/.test(String((last && last.text) || ''));
}

// «запиши його і туди і туди», «допиши це туди»: a note whose content is only pointed at («це», «його», «туди») has to
// be assembled from the dialog — the fast model filled it from the wrong turn, so it is redone.
function referentialNote(p, text) {
  return (p.items || []).some((it) => it && it.type === 'note')
    && /(?<!\p{L})(це|цього|його|її|туди|там)(?!\p{L})/u.test(String(text || '').toLowerCase());
}

// «ідея …», «нотатка …», «думка …» is always a note; a fast reply that makes a task of it is redone.
function ideaAsTask(p, text) {
  return /^\s*(ідея|нотатка|думка)(?!\p{L})/iu.test(String(text || '')) && (p.items || []).some((it) => it && it.type !== 'note');
}

// Where an open item lands in day/week views: event start, task deadline, else next reminder.
function placement(t) {
  if (t.kind === 'event') {
    const s = parseWhen(t.starts_at);
    if (!s) return null;
    const e = parseWhen(t.ends_at);
    return { day: dayKeyOf(s), ms: s.toMillis(), label: e ? `${fmtTime(s)}–${fmtTime(e)}` : fmtTime(s), section: 'events' };
  }
  const d = parseWhen(t.deadline);
  if (d) return { day: dayKeyOf(d), ms: d.toMillis(), label: isDateOnly(d) ? '' : `до ${fmtTime(d)}`, section: 'tasks' };
  return null;
}

function isUndated(t) {
  return t.kind !== 'event' && !t.deadline;
}

// One short phrase for "when": "сьогодні о 20:00", "сьогодні до 18:00", "до чт 22.10", "без дати".
function whenShort(t, now = kyivNow()) {
  if (t.kind === 'event') {
    const s = parseWhen(t.starts_at);
    return s ? `${relDay(s, now)} о ${fmtTime(s)}` : '';
  }
  const d = parseWhen(t.deadline);
  if (!d) return 'без дати';
  const day = relDay(d, now);
  // "до завтра" reads as a goodbye, so relative days get "до кінця дня" instead.
  if (isDateOnly(d)) return day === fmtDay(d) ? `до ${day}` : `${day} до кінця дня`;
  return `${day} до ${fmtTime(d)}`;
}

// Default reminder the bot would pick itself; anything else is worth mentioning in a confirmation.
function isDefaultReminder(t) {
  if (!t.next_ts) return true;
  if (t.rule !== 'once') return false;
  const s = parseWhen(t.kind === 'event' ? t.starts_at : t.deadline);
  if (!s) return false;
  const diffMin = Math.round((s.toMillis() - t.next_ts) / 60000);
  if (t.kind === 'event') return diffMin === EVENT_REMIND_BEFORE_MIN;
  const at = DateTime.fromMillis(t.next_ts, { zone: TZ });
  if (isDateOnly(s)) return prio(t) === 5 && at.hour === 18 && at.minute === 0;
  return diffMin === 120 || at.hour === 21;
}

function numberButtons(refs) {
  return refs.slice(0, MAX_BUTTONS).map((ref, i) => ({ t: String(i + 1), d: `c:${ref}` }));
}

const navBtn = (t, d) => ({ t, d });

// ---------- rows ----------

function rowsOf(name) {
  try {
    return $(name).all().map((i) => i.json).filter((r) => r && r.id);
  } catch (e) {
    return [];
  }
}

const TASK_COLS = ['chat_id', 'title', 'description', 'kind', 'deadline', 'starts_at', 'ends_at', 'rule',
  'remind_time', 'every_minutes', 'next_ts', 'status', 'source', 'repeat', 'moves', 'nudged_ts', 'parent_id', 'context', 'priority', 'entity_id'];

// ---------- priority ----------
// 5 критично · 4 важливо · 3 звичайна (default, no mark) · 2 менш важливо · 1 колись.
const PRIORITY_MARK = { 5: '🔴', 4: '🟠', 2: '🔵', 1: '⚪' };
const PRIORITY_NAME = { 5: 'критично', 4: 'важливо', 3: 'звичайна', 2: 'менш важливо', 1: 'колись' };

function prio(t) {
  const n = Math.round(Number(t && t.priority));
  return n >= 1 && n <= 5 ? n : 3;
}

function pmark(t) {
  return PRIORITY_MARK[prio(t)] ? `${PRIORITY_MARK[prio(t)]} ` : '';
}

function priorityValue(v) {
  const n = Math.round(Number(v));
  return n >= 1 && n <= 5 && n !== 3 ? n : null;
}
const NOTE_COLS = ['chat_id', 'title', 'text', 'tags', 'status'];

function pick(row, cols) {
  return Object.fromEntries(cols.map((c) => [c, row[c] ?? null]));
}

// ---------- repeat ----------
// Stored as "daily" | "weekly:1,3" | "monthly:5", optionally "|until=YYYY-MM-DD".

const WD_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'нд'];
const WD_EVERY = ['', 'щопонеділка', 'щовівторка', 'щосереди', 'щочетверга', 'щопʼятниці', 'щосуботи', 'щонеділі'];

function parseRepeat(s) {
  if (!s) return null;
  const [main, ...opts] = String(s).split('|');
  const until = (opts.find((o) => o.startsWith('until=')) || '').slice(6) || null;
  const [freq, arg] = main.split(':');
  if (freq === 'daily') return { freq, until };
  if (freq === 'weekly') {
    const weekdays = [...new Set(String(arg || '').split(',').map(Number).filter((d) => d >= 1 && d <= 7))].sort();
    return weekdays.length ? { freq, weekdays, until } : null;
  }
  if (freq === 'monthly') {
    const md = Number(arg);
    return md >= 1 && md <= 31 ? { freq, month_day: md, until } : null;
  }
  return null;
}

// Gemini object {freq, weekdays, month_day, until} -> stored string (or null).
function repeatString(r) {
  if (!r || typeof r !== 'object') return r ? (parseRepeat(r) ? String(r) : null) : null;
  let s = null;
  if (r.freq === 'daily') s = 'daily';
  if (r.freq === 'weekly' && Array.isArray(r.weekdays) && r.weekdays.length) s = `weekly:${[...new Set(r.weekdays.map(Number))].filter((d) => d >= 1 && d <= 7).sort().join(',')}`;
  if (r.freq === 'monthly' && Number(r.month_day) >= 1) s = `monthly:${Math.min(31, Number(r.month_day))}`;
  if (s && r.until && parseWhen(r.until)) s += `|until=${dayKeyOf(parseWhen(r.until))}`;
  return s && parseRepeat(s) ? s : null;
}

function repeatText(s) {
  const r = parseRepeat(s);
  if (!r) return '';
  let t = '';
  if (r.freq === 'daily') t = 'щодня';
  if (r.freq === 'weekly') t = r.weekdays.length === 1 ? WD_EVERY[r.weekdays[0]] : `по ${r.weekdays.map((d) => WD_SHORT[d]).join(', ')}`;
  if (r.freq === 'monthly') t = `щомісяця ${r.month_day}-го`;
  return r.until ? `${t} до ${fmtDay(DateTime.fromISO(r.until, { zone: TZ }))}` : t;
}

function matchesDay(r, day) {
  if (r.until && dayKeyOf(day) > r.until) return false;
  if (r.freq === 'daily') return true;
  if (r.freq === 'weekly') return r.weekdays.includes(day.weekday);
  if (r.freq === 'monthly') return day.day === Math.min(r.month_day, day.daysInMonth);
  return false;
}

// First occurrence strictly after afterMs at the given time of day.
function nextOccurrence(r, hm, afterMs) {
  let day = DateTime.fromMillis(afterMs, { zone: TZ }).startOf('day');
  for (let i = 0; i < 800; i += 1, day = day.plus({ days: 1 })) {
    const at = day.set({ hour: hm.hour, minute: hm.minute });
    if (at.toMillis() > afterMs && matchesDay(r, day)) return at;
    if (r.until && dayKeyOf(day) > r.until) return null;
  }
  return null;
}

// Placement of an item on a given day, expanding recurring series (only from the stored next occurrence on).
function placeOn(t, key) {
  const p = placement(t);
  if (!p) return null;
  const r = parseRepeat(t.repeat);
  if (!r) return p.day === key ? p : null;
  if (key < p.day) return null;
  const day = DateTime.fromISO(key, { zone: TZ });
  if (!matchesDay(r, day)) return null;
  const base = DateTime.fromMillis(p.ms, { zone: TZ });
  const at = day.set({ hour: base.hour, minute: base.minute });
  if (t.kind === 'event') {
    const s = parseWhen(t.starts_at);
    const e = parseWhen(t.ends_at);
    const end = e ? at.plus({ milliseconds: e.diff(s).toMillis() }) : null;
    return { day: key, ms: at.toMillis(), label: end ? `${fmtTime(at)}–${fmtTime(end)}` : fmtTime(at), section: 'events' };
  }
  return { ...p, day: key, ms: at.toMillis() };
}

// "Done" on a recurring item moves it to the next occurrence; otherwise it closes.
function completeRow(row, nowMs) {
  const r = parseRepeat(row.repeat);
  const anchor = parseWhen(row.kind === 'event' ? row.starts_at : row.deadline);
  if (r && anchor) {
    const next = nextOccurrence(r, { hour: anchor.hour, minute: anchor.minute }, Math.max(anchor.toMillis(), nowMs));
    if (next) {
      const set = row.kind === 'event' ? { starts_at: toIso(next) } : { deadline: toIso(next) };
      return { row: { ...applyPatch(row, set, [], nowMs), repeat: row.repeat }, rolled: true, next };
    }
  }
  return { row: { ...pick(row, TASK_COLS), status: 'done', next_ts: null }, rolled: false, next: null };
}

function snapshot(kind, row) {
  return { t: kind, id: row.id, before: pick(row, kind === 'task' ? TASK_COLS : NOTE_COLS) };
}

// ---------- schedule ----------

// Turns a parsed item (Gemini shape) into stored schedule columns.
function buildSchedule(p, nowMs) {
  const kind = p.type === 'event' ? 'event' : 'task';
  let deadline = kind === 'task' ? parseWhen(p.deadline) : null;
  let starts = kind === 'event' ? parseWhen(p.starts_at) : null;
  let ends = kind === 'event' ? parseWhen(p.ends_at) : null;
  if (starts && ends && ends.toMillis() <= starts.toMillis()) ends = null;

  const repeat = repeatString(p.repeat);
  const rep = parseRepeat(repeat);
  if (rep) {
    // A series starts at its nearest occurrence that is still ahead (or the given one if it matches).
    const anchor = starts || deadline || kyivNow().set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    const hm = { hour: anchor.hour, minute: anchor.minute };
    const ok = anchor.toMillis() > nowMs && matchesDay(rep, anchor);
    const first = ok ? anchor : nextOccurrence(rep, hm, Math.max(nowMs, anchor.startOf('day').toMillis() - 1));
    if (first) {
      if (kind === 'event') {
        if (ends && starts) ends = first.plus({ milliseconds: ends.diff(starts).toMillis() });
        starts = first;
      } else {
        deadline = first;
      }
    }
  }

  let rule = p.reminder_type || (starts || deadline ? 'once' : 'none');
  let remind_time = null;
  let every_minutes = null;
  let next_ts = null;

  if (rule === 'once') {
    let at = parseWhen(p.remind_at);
    if (!at && starts) at = starts.minus({ minutes: EVENT_REMIND_BEFORE_MIN });
    // Date-only deadlines get no own reminder (the 9:00 plan and the 17:00 check cover them),
    // except critical ones: those get 18:00 on the day.
    if (!at && deadline && isDateOnly(deadline) && prio(p) === 5) at = deadline.set({ hour: 18, minute: 0 });
    if (!at && deadline && !isDateOnly(deadline)) {
      at = deadline.minus({ hours: 2 });
      // Quiet hours: a default reminder at night moves to 21:00 the evening before.
      if (at.hour < 7 || at.hour >= 23) at = deadline.minus({ days: 1 }).set({ hour: 21, minute: 0 });
    }
    const over = (starts && starts.toMillis() <= nowMs) || (deadline && deadline.toMillis() <= nowMs && !p.remind_at);
    next_ts = at && !over ? Math.max(at.toMillis(), nowMs + 60000) : null;
    if (next_ts === null) rule = 'none';
  } else if (rule === 'daily_until_done') {
    const hm = parseHM(p.daily_time) || { hour: 9, minute: 0 };
    remind_time = hmText(hm);
    const start = parseWhen(p.first_reminder_at);
    next_ts = nextDaily(hm, start && start.toMillis() > nowMs ? start.toMillis() - 1 : nowMs);
  } else if (rule === 'interval') {
    every_minutes = Math.max(5, Math.round(Number(p.interval_minutes) || 180));
    const start = parseWhen(p.first_reminder_at);
    next_ts = start && start.toMillis() > nowMs ? start.toMillis() : nowMs + every_minutes * 60000;
  } else {
    rule = 'none';
  }

  return {
    kind, deadline: toIso(deadline), starts_at: toIso(starts), ends_at: toIso(ends),
    rule, remind_time, every_minutes, next_ts, repeat,
  };
}

// Stored row -> parse shape, so edits can be merged and re-run through buildSchedule.
function rowToParse(t) {
  return {
    type: t.kind === 'event' ? 'event' : 'task',
    title: t.title,
    description: t.description || null,
    deadline: t.deadline || null,
    starts_at: t.starts_at || null,
    ends_at: t.ends_at || null,
    reminder_type: t.rule || 'none',
    remind_at: t.rule === 'once' && t.next_ts ? toIso(DateTime.fromMillis(t.next_ts, { zone: TZ })) : null,
    priority: t.priority ?? null,
    daily_time: t.remind_time || null,
    interval_minutes: t.every_minutes || null,
    repeat: t.repeat || null,
  };
}

const SCHEDULE_KEYS = ['type', 'deadline', 'starts_at', 'ends_at', 'reminder_type', 'remind_at', 'daily_time', 'interval_minutes', 'first_reminder_at', 'repeat', 'priority'];

// Applies a partial edit ("set" + "clear") to a stored row and returns the full new row.
function applyPatch(row, set = {}, clear = [], nowMs = Date.now()) {
  const p = rowToParse(row);
  const has = (k) => set[k] !== undefined && set[k] !== null && set[k] !== '';
  const timeMoved = ['deadline', 'starts_at', 'ends_at', 'type'].some(has);
  for (const k of SCHEDULE_KEYS) if (has(k)) p[k] = set[k];
  if (has('starts_at') && !has('ends_at') && row.starts_at && row.ends_at) {
    // Moving an event keeps its duration.
    const dur = parseWhen(row.ends_at).diff(parseWhen(row.starts_at)).toMillis();
    p.ends_at = toIso(parseWhen(set.starts_at).plus({ milliseconds: dur }));
  }
  if (timeMoved && !has('remind_at') && !has('reminder_type') && p.reminder_type === 'once') p.remind_at = null;
  // Becoming critical turns on the default reminder of a silent dated task.
  if (has('priority') && prio(set) === 5 && p.reminder_type === 'none' && (p.deadline || p.starts_at)) p.reminder_type = 'once';
  // "нагадай через пів години" on a task without a one-off reminder: a recurring rule keeps its rule
  // and only the next ping moves; a silent task gets a one-off reminder.
  const snooze = has('remind_at') && !has('reminder_type') && p.reminder_type !== 'once' ? parseWhen(set.remind_at) : null;
  if (snooze && !['daily_until_done', 'interval'].includes(p.reminder_type)) p.reminder_type = 'once';
  if (p.type === 'event' && !p.starts_at && p.deadline) { p.starts_at = p.deadline; p.deadline = null; }
  for (const c of clear) {
    if (c === 'deadline') p.deadline = null;
    if (c === 'reminder') { p.reminder_type = 'none'; p.remind_at = null; }
    if (c === 'description') p.description = null;
    if (c === 'ends_at') p.ends_at = null;
    if (c === 'repeat') p.repeat = null;
  }
  const title = has('title') ? String(set.title).trim().slice(0, 200) : row.title;
  let description = row.description || null;
  if (has('description')) description = String(set.description).trim();
  if (has('append_description')) description = [description, String(set.append_description).trim()].filter(Boolean).join('\n');
  if (clear.includes('description')) description = null;
  const sched = buildSchedule(p, nowMs);
  if (snooze && ['daily_until_done', 'interval'].includes(sched.rule)) sched.next_ts = Math.max(snooze.toMillis(), nowMs + 60000);
  // A change of the title, description or place keeps the planned reminder: rebuilt after the usual time had passed,
  // it fired a minute later.
  if (!SCHEDULE_KEYS.some(has) && !has('priority') && !clear.some((c) => c !== 'description')) sched.next_ts = row.next_ts ?? null;
  // Every move to a later date is counted: three moves make a task "stuck".
  const anchor = (r) => parseWhen(r.kind === 'event' ? r.starts_at : r.deadline);
  const before = anchor(row);
  const after = anchor(sched);
  const later = before && after && after.toMillis() > before.toMillis();
  return {
    chat_id: row.chat_id, source: row.source, status: 'open',
    title, description: description ? description.slice(0, 2000) : null,
    ...sched,
    moves: (Number(row.moves) || 0) + (later ? 1 : 0),
    nudged_ts: row.nudged_ts ?? null,
    parent_id: row.parent_id ?? null,
    context: has('context') ? contextString(set.context) : (row.context ?? null),
    priority: has('priority') ? priorityValue(set.priority) : (row.priority ?? null),
    // The area stays unless the edit names a new one (interpret.js): a priority or date change used to drop it.
    entity_id: row.entity_id ?? null,
  };
}

// Places and people: Gemini ["АТБ", "@Ігор"] or "АТБ, @Ігор" -> "АТБ,@Ігор" (people start with @).
function contextString(v) {
  const seen = new Set();
  const list = (Array.isArray(v) ? v : String(v || '').split(','))
    .map((x) => String(x).replace(/[#,]/g, '').trim()).filter(Boolean)
    .filter((x) => !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()));
  return list.length ? list.slice(0, 3).join(',') : null;
}

function contextTags(t) {
  return String(t.context || '').split(',').map((x) => x.trim()).filter(Boolean);
}

// "📍 АТБ · 👤 Ігор"
function contextLabel(t) {
  return contextTags(t).map((x) => (x.startsWith('@') ? `👤 ${esc(x.slice(1))}` : `📍 ${esc(x)}`)).join(' · ');
}

// Word match tolerant to Ukrainian endings: "Ігор" finds "Ігорю", "АТБ" finds "атб".
function sameWord(a, b) {
  const x = String(a).toLowerCase().replace(/^@/, '');
  const y = String(b).toLowerCase().replace(/^@/, '');
  if (x === y) return true;
  const n = Math.max(3, Math.min(x.length, y.length) - 1);
  return x.length >= 3 && y.length >= 3 && x.slice(0, n) === y.slice(0, n);
}

// Match inflected forms of a name by their endings, while keeping distinct names separate.
function sameName(a, b) {
  return sameWord(a, b) && Math.abs(String(a).length - String(b).length) <= 3;
}

// Open tasks for "я йду в місто" / "що купити в АТБ" / "що треба від Ігоря".
// "місто" means every task tied to some place; otherwise a tag or a title word must match.
function matchContext(rows, search) {
  const words = String(search || '').replace(/[«»"']/g, ' ').split(/\s+/).filter((w) => w.length >= 3);
  const city = words.some((w) => sameWord(w, 'місто') || sameWord(w, 'місті'));
  return rows.filter((t) => {
    if (t.kind === 'event') return false;
    const tags = contextTags(t);
    if (city && tags.some((x) => !x.startsWith('@'))) return true;
    if (tags.some((x) => words.some((w) => sameWord(w, x)))) return true;
    return String(t.title).split(/[\s,.]+/).some((tw) => tw.length >= 3 && words.some((w) => w.length >= 4 && sameWord(w, tw)));
  });
}

// An open event that overlaps the new one (no end = 1 hour); series are checked on that day.
function findConflict(ev, openRows, excludeId = null) {
  const s = parseWhen(ev.starts_at);
  if (ev.kind !== 'event' || !s) return null;
  const e = parseWhen(ev.ends_at) || s.plus({ hours: 1 });
  const key = dayKeyOf(s);
  for (const t of openRows) {
    if (t.kind !== 'event' || t.id === excludeId) continue;
    const p = placeOn(t, key);
    if (!p) continue;
    const os = p.ms;
    const oe = parseWhen(t.ends_at) && parseWhen(t.starts_at) ? os + parseWhen(t.ends_at).diff(parseWhen(t.starts_at)).toMillis() : os + 3600000;
    if (os < e.toMillis() && s.toMillis() < oe) return { row: t, start: DateTime.fromMillis(os, { zone: TZ }), end: parseWhen(t.ends_at) ? DateTime.fromMillis(oe, { zone: TZ }) : null };
  }
  return null;
}

function diffText(oldRow, newRow, nowMs = Date.now()) {
  const now = DateTime.fromMillis(nowMs, { zone: TZ });
  const out = [];
  if (oldRow.title !== newRow.title) out.push(`назва → «${esc(newRow.title)}»`);
  if ((oldRow.kind || 'task') !== newRow.kind) out.push(newRow.kind === 'event' ? 'тепер подія' : 'тепер задача');
  if (prio(oldRow) !== prio(newRow)) out.push(`важливість → ${pmark(newRow)}${PRIORITY_NAME[prio(newRow)]}`);
  if ((Number(oldRow.entity_id) || null) !== (Number(newRow.entity_id) || null)) out.push(newRow.entity_id ? `належить → ${esc(areaLabel(newRow).replace('🗂 ', ''))}` : 'без сфери');
  const timeChanged = (oldRow.deadline || null) !== newRow.deadline || (oldRow.starts_at || null) !== newRow.starts_at;
  if (timeChanged) out.push(newRow.kind === 'event' ? `→ ${whenShort(newRow, now)}` : `дедлайн → ${whenShort(newRow, now)}`);
  const oldD = String(oldRow.description || '');
  const newD = String(newRow.description || '');
  if (oldD !== newD) {
    if (!newD) out.push('опис прибрано');
    else if (oldD && newD.startsWith(oldD)) out.push(`додав: «${esc(clip(newD.slice(oldD.length).trim(), 80))}»`);
    else out.push(oldD ? 'оновив опис' : `додав опис: «${esc(clip(newD, 80))}»`);
  }
  // Reminders that simply follow a moved date are the default and not worth a line.
  const ruleChanged = (oldRow.rule || 'none') !== newRow.rule || (oldRow.remind_time || null) !== newRow.remind_time;
  const nextText = () => `нагадаю ${when(DateTime.fromMillis(newRow.next_ts, { zone: TZ }), now)}`;
  if (ruleChanged) {
    const hadReminder = Boolean(oldRow.next_ts) || ['daily_until_done', 'interval'].includes(oldRow.rule);
    if (!newRow.next_ts) {
      if (hadReminder && !timeChanged) out.push('без нагадувань');
    } else if (ruleText(newRow)) out.push(`нагадую ${ruleText(newRow)}`);
    else if (!(timeChanged && isDefaultReminder(newRow))) out.push(nextText());
  } else if (!timeChanged && (oldRow.next_ts || null) !== newRow.next_ts) {
    out.push(newRow.next_ts ? nextText() : 'без нагадувань');
  }
  return out;
}

// "О 18:30 — Зустріч команди" / "До 18:00 — Семінар з анімації" / "Нагадую: Заявка на стажування".
function reminderText(t, now = kyivNow()) {
  const title = pmark(t) + esc(t.title);
  const s = t.kind === 'event' ? parseWhen(t.starts_at) : null;
  const dl = t.kind !== 'event' ? parseWhen(t.deadline) : null;
  if (s) {
    const day = relDay(s, now);
    return `${day === 'сьогодні' ? 'О' : `${day[0].toUpperCase()}${day.slice(1)} о`} ${fmtTime(s)} — ${title}`;
  }
  if (dl && dl.toMillis() < now.toMillis()) return `${title} — <i>прострочено</i>`;
  if (dl && !isDateOnly(dl) && dayKeyOf(dl) === dayKeyOf(now)) return `До ${fmtTime(dl)} — ${title}`;
  return `Нагадую: ${title}${dl ? ` · ${whenShort(t, now)}` : ''}`;
}

// ---------- quiet mode ----------
// A pause is a lanora_actions row: kind "pause", text = until (ISO), status "new" until its summary is sent.

function pauseState(pauses, nowMs) {
  const open = pauses.filter((a) => a && a.id && a.kind === 'pause' && a.status === 'new');
  const active = open.find((a) => { const u = parseWhen(a.text); return u && u.toMillis() > nowMs; }) || null;
  return { active, ended: active ? [] : open, open };
}

function pauseUntilText(until, now) {
  if (dayKeyOf(until) === dayKeyOf(now)) return `до ${fmtTime(until)}`;
  return isDateOnly(until) ? `до ${relDay(until, now) === fmtDay(until) ? fmtDay(until) : `${relDay(until, now)}, ${fmtDay(until)}`} включно` : `до ${when(until, now)}`;
}

// ---------- reactions ----------

// How many items the owner closed today, from the dialog log ("✅ закрив t2 «…»").
function doneToday(dialogRows, nowMs) {
  const start = DateTime.fromMillis(nowMs, { zone: TZ }).startOf('day').toMillis();
  const ids = new Set();
  for (const d of dialogRows) {
    if (d.role === 'bot' && Number(d.ts) >= start && String(d.text || '').startsWith(DONE_LOG)) {
      for (const id of String(d.item_ids || '').split(',').filter(Boolean)) ids.add(id);
    }
  }
  return ids.size;
}
const DONE_LOG = '✅ закрив';

// A short cheer after "Готово": the whole day closed beats a count milestone.
function doneReaction(prevCount, closed, openRows, nowMs) {
  const todayKey = dayKeyOf(DateTime.fromMillis(nowMs, { zone: TZ }));
  const closedIds = new Set(closed.map((t) => t.id));
  const dueToday = (t) => t.kind !== 'event' && t.deadline && dayKeyOf(parseWhen(t.deadline)) <= todayKey;
  if (closed.some(dueToday) && !openRows.some((t) => !closedIds.has(t.id) && dueToday(t))) return '🎉 На сьогодні все!';
  const n = prevCount + closed.length;
  const marks = [[10, '🏆 десята', '🏆 уже 10'], [5, '🔥 пʼята', '🔥 уже 5'], [3, '💪 третя', '💪 уже 3']];
  for (const [m, one, many] of marks) {
    if (prevCount < m && n >= m) return `${closed.length === 1 && n === m ? one : many} за день`;
  }
  return '';
}

// ---------- list references ----------

const ORDINALS = [[1, /перш/], [2, /друг/], [3, /трет/], [4, /четверт/], [5, /п['ʼ’]?ят/], [6, /шост/], [7, /сьом/], [8, /восьм/], [9, /девʼят|девят/], [10, /десят/]];

// «другу видали», «№3 готово», «9 і 7 готово»: numbers in the bot's last numbered list ("№2 → t5 …").
// Only for short messages (so «подарунок другу» in a longer sentence is not an ordinal), and only when
// every number maps to the list — otherwise the model's own reading stands.
function ordinalRefs(text, dialogRows) {
  const t = String(text || '').toLowerCase();
  if (t.split(/\s+/).filter(Boolean).length > 5 || /\d[:.]\d/.test(t)) return [];
  // «на 21», «о 15», «до 18» are times, not list numbers.
  const TIME_WORDS = new Set(['на', 'о', 'об', 'до', 'з', 'із', 'по', 'після', 'через', 'в', 'у']);
  const tokens = t.replace(/№\s*/g, '№').split(/[\s,.!?]+/).filter(Boolean);
  const nums = [];
  tokens.forEach((w, i) => {
    const m = /^№?(\d{1,2})$/.exec(w);
    if (m && (w.startsWith('№') || !TIME_WORDS.has(tokens[i - 1]))) nums.push(Number(m[1]));
    const hit = ORDINALS.find(([, re]) => re.test(w) && w.length <= 9);
    if (hit) nums.push(hit[0]);
  });
  if (!nums.length) return [];
  const list = [...dialogRows].sort((a, b) => b.ts - a.ts).find((d) => d.role === 'bot' && /№1 → [tn]\d+/.test(d.text || ''));
  if (!list) return [];
  const refs = nums.map((n) => (new RegExp(`№${n} → ([tn]\\d+)`).exec(list.text) || [])[1]);
  return refs.every(Boolean) ? [...new Set(refs)] : [];
}

// What was closed today, from the dialog log — so «скільки я сьогодні зробив?» has an answer.
function closedTodayText(dialogRows, nowMs) {
  const start = DateTime.fromMillis(nowMs, { zone: TZ }).startOf('day').toMillis();
  const titles = [];
  for (const d of dialogRows) {
    if (d.role !== 'bot' || Number(d.ts) < start || !String(d.text || '').startsWith(DONE_LOG)) continue;
    for (const m of String(d.text).matchAll(/«([^»]+)»/g)) titles.push(m[1]);
  }
  // An undone close is logged as «відновив: …»; those titles are taken back out.
  for (const d of dialogRows) {
    if (d.role === 'bot' && Number(d.ts) >= start && /Скасувати/.test(d.text || '')) {
      const back = /відновив: (.+)$/.exec(d.text || '');
      if (back) for (const name of back[1].split(', ')) { const i = titles.indexOf(name); if (i >= 0) titles.splice(i, 1); }
    }
  }
  return titles.length ? `${titles.length}: ${[...new Set(titles)].join('; ')}` : '0';
}

// ---------- stuck tasks ----------

const STALE_MOVES = 3;
const STALE_DAYS = 7;

// One task worth asking about: moved 3+ times, or a week without a date; never twice in a week.
function pickStale(rows, nowMs) {
  const weekAgo = nowMs - STALE_DAYS * 86400000;
  const created = (t) => (t.createdAt ? DateTime.fromISO(t.createdAt).toMillis() : nowMs);
  const list = rows.filter((t) => t.status === 'open' && t.kind !== 'event' && !t.repeat && !(Number(t.nudged_ts) > weekAgo))
    .map((t) => ({ t, reason: Number(t.moves) >= STALE_MOVES ? 'moves' : !t.deadline && created(t) < weekAgo ? 'undated' : null }))
    .filter((x) => x.reason)
    .sort((a, b) => (Number(b.t.moves) || 0) - (Number(a.t.moves) || 0) || created(a.t) - created(b.t));
  return list[0] || null;
}

function staleText(x, nowMs) {
  const title = esc(x.t.title);
  if (x.reason === 'moves') {
    const n = Number(x.t.moves);
    const times = { 3: 'втретє', 4: 'вчетверте', 5: 'вп’яте' }[n] || `${n}-й раз`;
    return `🤔 «${title}» переносиш уже ${times}. Що робимо?`;
  }
  const days = Math.floor((nowMs - DateTime.fromISO(x.t.createdAt).toMillis()) / 86400000);
  return `🤔 «${title}» висить ${days < 14 ? 'тиждень' : `уже ${days} ${plural(days, 'день', 'дні', 'днів')}`} без дати. Що робимо?`;
}

// Steps of a task on a later day: a step past the task or left undated is spread over the days from today to the
// task's day, due by the end of its day. A task at a time (an exam, an event) gets its steps done by the day before
// Keep the assigned dates for steps of tasks due today or without a deadline.
function stepDeadlines(items, parent, now) {
  const at = parent && (parseWhen(parent.starts_at) || parseWhen(parent.deadline));
  const today = now.startOf('day');
  if (!at || at.startOf('day') <= today) return items;
  const last = parent.kind !== 'event' && isDateOnly(at) ? at.startOf('day') : at.startOf('day').minus({ days: 1 });
  const span = Math.round(last.diff(today, 'days').days);
  return items.map((it, i) => {
    const d = parseWhen(it.deadline);
    if (d && d.startOf('day') <= last) return it;
    const day = today.plus({ days: Math.floor(((i + 1) * span) / items.length) });
    return { ...it, deadline: toIso(day.set({ hour: 23, minute: 59 })), reminder_type: 'none', remind_at: null };
  });
}

// When the last open step of a split task is closed, its parent is offered for closing too.
function finishedParent(closed, openRows) {
  const ids = new Set(closed.map((t) => t.id));
  for (const t of closed) {
    if (!t.parent_id) continue;
    const parent = openRows.find((r) => r.id === Number(t.parent_id));
    if (parent && !openRows.some((r) => Number(r.parent_id) === parent.id && !ids.has(r.id))) return parent;
  }
  return null;
}

// ---------- duplicates ----------

const DUP_STOP = new Set(['податися', 'подати', 'зробити', 'треба', 'написати', 'підготуватися', 'для', 'про', 'над',
  'щоб', 'або', 'по', 'на', 'та', 'і', 'й', 'з', 'до', 'в', 'у']);

function stems(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/)
    .filter((w) => w.length >= 3 && !DUP_STOP.has(w)).map((w) => w.slice(0, 5));
}

// An open task of the same kind whose title words are a superset/subset of the new one (≥2 shared stems).
function findDuplicate(task, openRows) {
  const a = new Set(stems(task.title));
  if (!a.size) return null;
  for (const t of openRows) {
    if ((t.kind === 'event') !== (task.kind === 'event')) continue;
    const b = new Set(stems(t.title));
    const shared = [...a].filter((x) => b.has(x)).length;
    if (shared === Math.min(a.size, b.size) && (shared >= 2 || (a.size === 1 && b.size === 1))) return t;
  }
  return null;
}

// Gemini item -> patch for applyPatch (everything that can change on an existing task).
function itemToSet(it) {
  const set = {};
  for (const k of ['type', 'deadline', 'starts_at', 'ends_at', 'reminder_type', 'remind_at', 'daily_time', 'interval_minutes', 'first_reminder_at', 'repeat', 'context', 'priority']) {
    if (it[k] !== undefined && it[k] !== null && it[k] !== '' && !(Array.isArray(it[k]) && !it[k].length)) set[k] = it[k];
  }
  if (set.reminder_type === 'none') delete set.reminder_type;
  if (it.description) set.append_description = it.description;
  return set;
}

// Moves overdue and today's open one-off tasks (not events, not recurring) to tomorrow, same time of day.
function planMove(rows, nowMs, chat_id) {
  const now = DateTime.fromMillis(nowMs, { zone: TZ });
  const todayKey = dayKeyOf(now);
  const tomorrow = logicalTomorrow(now);
  const out = [];
  const moved = [];
  for (const t of rows) {
    if (t.kind === 'event' || !t.deadline || t.repeat || t.rule === 'daily_until_done' || t.rule === 'interval') continue;
    const d = parseWhen(t.deadline);
    if (dayKeyOf(d) > todayKey) continue;
    const row = applyPatch(t, { deadline: toIso(tomorrow.set({ hour: d.hour, minute: d.minute })) }, [], nowMs);
    out.push({ route: 'task_update', chat_id, id: t.id, task: row });
    moved.push(t);
  }
  const text = moved.length
    ? `📅 Переніс на ${when(tomorrow, now, false)} (${moved.length}):\n${moved.map((t) => `• ${esc(t.title)}`).join('\n')}`
    : 'Нічого переносити — на сьогодні все чисто 🎉';
  out.push({ route: 'summary', chat_id, text, single: null, ops: moved.length ? JSON.stringify(moved.map((t) => snapshot('task', t))) : '' });
  out.push({ route: 'log', chat_id, log_role: 'bot', log_text: `переніс на завтра: ${moved.map((t) => `t${t.id} «${t.title}»`).join(', ') || 'нічого'}`, log_ids: moved.map((t) => `t${t.id}`).join(',') });
  return { out, moved };
}

// Dialog-log line for a numbered list, so "другу" can be resolved later.
function listLog(what, refs, titleOf) {
  return `показав ${what}: ${refs.slice(0, 15).map((r, i) => `№${i + 1} → ${r} «${clip(titleOf(r), 40)}»`).join('; ') || 'порожньо'}`;
}

// ---------- knowledge base ----------
// The owner's spheres, projects, topics, ideas and people live in the bot's database: entities with a parent,
// dated entries, person ↔ entity links with a role (app/db.js). The scripts see active entities as «notes» —
// the shape the old Obsidian index had — so mentions, lookups and «Хто це?» work as before.

const KIND_TYPE = { sphere: 'сфера', project: 'проєкт', topic: 'тема', idea: 'ідея', person: 'людина', inbox: 'inbox' };

function knowledge() {
  try {
    const j = $('Knowledge').first().json;
    return { entities: j.entities || [], entries: j.entries || [], links: j.links || [] };
  } catch (e) {
    return { entities: [], entries: [], links: [] };
  }
}

// Active entities as notes: {id, kind, name, type, desc, aliases, parent, path, people, spheres, body}.
// `path` is the chain of names from the top («Спільнота/Майстерня»); people carry their entities and roles in `spheres`.
function vaultNotes() {
  const kb = knowledge();
  const byId = new Map(kb.entities.map((e) => [e.id, e]));
  const live = (e) => e && e.status !== 'archived';
  const chain = (e) => {
    const names = [];
    for (let x = e, i = 0; x && i < 10; x = byId.get(x.parent_id), i += 1) names.unshift(x.name);
    return names.join('/');
  };
  return kb.entities.filter(live).map((e) => {
    const mine = kb.links.filter((l) => (e.kind === 'person' ? l.person_id === e.id : l.entity_id === e.id))
      .map((l) => ({ other: byId.get(e.kind === 'person' ? l.entity_id : l.person_id), role: l.role || '' })).filter((x) => live(x.other));
    const entries = kb.entries.filter((x) => x.entity_id === e.id).sort((a, b) => b.ts - a.ts);
    return {
      id: e.id, kind: e.kind, name: e.name, type: e.type || KIND_TYPE[e.kind] || e.kind,
      desc: String(e.description || '').split('\n')[0].slice(0, 160),
      aliases: String(e.aliases || '').split(',').map((x) => x.trim()).filter(Boolean),
      parent: (byId.get(e.parent_id) || {}).name || '', path: chain(e),
      people: e.kind === 'person' ? [] : mine.map((x) => x.other.name),
      roles: mine.map((x) => `${x.other.name}${x.role ? ` (${x.role})` : ''}`),
      spheres: e.kind === 'person' ? mine.map((x) => ({ id: x.other.id, name: x.other.name, role: x.role })) : [],
      body: [e.description || '', ...entries.map((x) => `- ${DateTime.fromMillis(Number(x.ts), { zone: TZ }).toFormat('dd.LL')} ${x.text}`)].join('\n'),
    };
  });
}

// By name, alias or path («Атлас», «атлас», «Робота/Атлас», «Робота › Атлас»).
function vaultFind(notes, name) {
  const key = String(name || '').trim().toLowerCase().replace(/\s*›\s*/g, '/');
  if (!key) return null;
  return notes.find((n) => n.name.toLowerCase() === key)
    || notes.find((n) => (n.aliases || []).some((a) => String(a).toLowerCase() === key))
    || notes.find((n) => n.path.toLowerCase() === key || n.path.toLowerCase().endsWith(`/${key}`)) || null;
}

// «Спільнота › Майстерня» — how a place is shown to the owner.
function vaultPlace(n) {
  return n.path.replace(/\//g, ' › ');
}

// Entities and people the message names, by name or alias, tolerant to endings («Ігорю» → Ігор).
function vaultMentions(notes, text) {
  const t = String(text || '').toLowerCase();
  const words = t.split(/[^\p{L}\p{N}'ʼ&.]+/u).filter((w) => w.length >= 2);
  const hits = [];
  for (const n of notes) {
    if (n.kind === 'inbox') continue;
    const spellings = [n.name, ...(n.aliases || [])].map((x) => String(x).toLowerCase()).filter(Boolean);
    const found = spellings.some((sp) => (sp.includes(' ') ? t.includes(sp)
      : words.some((w) => (sp.length < 3 || w.length < 3 ? w === sp : sameName(w, sp)))));
    if (found) hits.push(n);
  }
  return hits.slice(0, 8);
}

// The map the router gets in every message instead of whole notes: the tree of spheres → projects → topics
// (name, type, one-line description, aliases, people with roles), idea names under their place, and the people.
function kbMap(notes) {
  if (!notes.length) return '';
  const kids = (name) => notes.filter((n) => n.parent === name && n.kind !== 'person');
  const lines = [];
  const walk = (n, depth) => {
    if (n.kind === 'idea') return;
    const bits = [`${'  '.repeat(depth)}${n.name} [${n.type}]`];
    if (n.desc) bits.push(`«${clip(n.desc, 90)}»`);
    if (n.aliases.length) bits.push(`інакше: ${n.aliases.slice(0, 4).join(', ')}`);
    if (n.roles.length) bits.push(`люди: ${n.roles.join(', ')}`);
    // Only how many ideas: their names, when the message mentions one, come with kbMentionsLine.
    const ideas = kids(n.name).filter((x) => x.kind === 'idea').length;
    if (ideas) bits.push(`ідей: ${ideas}`);
    lines.push(bits.join(' · '));
    for (const k of kids(n.name)) walk(k, depth + 1);
  };
  for (const top of notes.filter((n) => !n.parent && n.kind !== 'person')) walk(top, 0);
  const people = notes.filter((n) => n.kind === 'person').map((n) => `${n.name}${n.roles.length ? ` — ${n.roles.join(', ')}` : ''}${n.desc ? ` · «${clip(n.desc, 70)}»` : ''}`);
  return `КАРТА ЗНАНЬ ВЛАСНИКА (сфера → проєкти/теми, з відступом; [тип] «опис» · інакше · люди (роль) · скільки ідей):
${lines.join('\n')}
ЛЮДИ: ${people.join('; ') || '—'}`;
}

// A task's places and people plus the known people its title names, which the model may not tag («Дістати Марті
// інфу від Олега» came with only @Олег), so «що там у Марті?» and «що треба від Олега» both find it.
function withNamedPeople(notes, context, title) {
  const tags = (Array.isArray(context) ? context : String(context || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
  const tagged = (n) => tags.some((x) => x.startsWith('@') && [n.name, ...n.aliases].some((sp) => sameName(x, sp)));
  const named = vaultMentions(notes.filter((n) => n.kind === 'person'), title).filter((n) => !tagged(n));
  return contextString([...tags, ...named.map((n) => `@${n.name}`)]);
}

// «У ПОВІДОМЛЕННІ ЗГАДАНО: …» — the places and people the message names, at the end of the prompt.
function kbMentionsLine(notes, text) {
  const named = vaultMentions(notes, text).map((n) => `${n.name} → ${vaultPlace(n)}${n.desc ? ` (${clip(n.desc, 80)})` : ''}`);
  return named.length ? `У ПОВІДОМЛЕННІ ЗГАДАНО: ${named.join('; ')}` : '';
}

// «🗂 Спільнота › Майстерня» for a task bound to an entity.
function areaLabel(t) {
  const n = t && t.entity_id ? vaultNotes().find((x) => x.id === Number(t.entity_id)) : null;
  return n ? `🗂 ${vaultPlace(n)}` : '';
}

// A task's entity: the model's `area`, or the one place the text names (people and Inbox are not areas).
function areaOf(notes, area, text) {
  const isArea = (n) => n && n.kind !== 'person' && n.kind !== 'inbox';
  const named = vaultFind(notes, area);
  if (isArea(named)) return named.id;
  const hits = vaultMentions(notes, text).filter(isArea);
  return hits.length === 1 ? hits[0].id : null;
}

function safeTitle(s) {
  return String(s || '').replace(/[\\/:*?"<>|#^[\]›]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

// ---------- new people ----------
// Spheres offered when the bot asks «Хто це — Ніна?»; the order is the button order (pp:<id>:<index>).
const PERSON_SPHERES = ['Робота', 'Навчання', 'Дім', 'Хобі'];
const PERSON_PLAIN = 4;
const PERSON_SKIP = 5;

// The first name from the router's new_people that is really unknown and was never asked about.
// «Тато», «сестра» without a name are not a person to add.
const RELATIVES = new Set(['тато', 'мама', 'батько', 'мати', 'брат', 'сестра', 'бабуся', 'дідусь', 'син', 'донька', 'дочка', 'дружина', 'чоловік', 'дядько', 'тітка']);

// A name that can be a person's: capitalised, short, no digits, not «тато» / «сестра».
function personName(raw) {
  const name = safeTitle(raw);
  return name.length < 2 || name.length > 40 || /\d/.test(name) || !/^\p{Lu}/u.test(name) || RELATIVES.has(name.toLowerCase()) ? null : name;
}

function personToAsk(names, vault, asked) {
  const done = new Set(asked.map((a) => String(a.text || '').toLowerCase()));
  for (const raw of names || []) {
    const name = personName(raw);
    if (!name) continue;
    const known = vaultFind(vault, name) || vault.some((n) => n.kind === 'person' && [n.name, ...(n.aliases || [])].some((a) => sameWord(a, name)));
    if (!known && !done.has(name.toLowerCase())) return name;
  }
  return null;
}

// «Хто це?» answered: a person, linked to the chosen sphere.
function personPlan(vault, name, sphere, userText, now) {
  const title = safeTitle(name);
  if (!title || vaultFind(vault, title)) return null;
  const area = sphere ? vaultFind(vault, sphere) : null;
  const desc = area ? `Зі сфери ${area.name}` : 'Знайома людина';
  const ref = `p:${title}`;
  return {
    where: title, title, text: desc,
    ops: [{ op: 'create', ref, kind: 'person', type: 'людина', name: title, parent_id: null,
      description: `${desc}. Уперше згадано ${now.toFormat('dd.LL')}: «${String(userText || '').replace(/\n+/g, ' ').slice(0, 200)}»` },
    ...(area ? [{ op: 'link', person_ref: ref, entity_id: area.id, role: '' }] : [])],
  };
}

// Several plans of one message -> one write (ops in order) and one confirmation.
function mergePlans(plans) {
  return {
    kind: plans.some((p) => p.kind === 'create') ? 'multi' : 'append',
    where: [...new Set(plans.map((p) => p.where))].join(', '), title: plans.map((p) => p.title).join('; '),
    text: plans.map((p) => p.text).join('\n'), ops: plans.flatMap((p) => p.ops),
  };
}

// A note from Telegram -> database ops: an entry in an existing place (project, person, topic, Inbox), or a new
// idea under its place. Places come only from the knowledge base (and what the same message creates in it, `made`
// of kbOps, reached by ref), never invented by the model.
function vaultPlan(notes, item, userText, now) {
  const inbox = vaultFind(notes, 'Inbox');
  let place = vaultFind(notes, item.place) || inbox;
  const title = safeTitle(item.title) || 'Нотатка';
  const text = String(item.description || item.title || '').trim().replace(/\n+/g, ' ');
  // A «new» one that already exists («Витрати» from last week, or the project this very message creates under a
  // slightly different name) gets the entry instead of a second one.
  const close = (n) => n.ref && stems(n.name).filter((w) => stems(title).includes(w)).length >= Math.min(2, stems(n.name).length);
  const existing = item.new_note ? vaultFind(notes, title) || notes.find(close) : null;
  if (existing) place = existing;
  if (!place) return null;
  const at = (n) => (n.ref ? { entity_ref: n.ref } : { entity_id: n.id });
  const isNew = Boolean(item.new_note) && !existing && place.kind !== 'person' && place.kind !== 'inbox';
  if (!isNew) return { kind: 'append', where: vaultPlace(place), title, text, ops: [{ op: 'entry', ...at(place), text }] };
  return {
    kind: 'create', where: `${vaultPlace(place)} › ${title}`, title, text,
    ops: [{ op: 'create', ref: `e:${title}`, kind: 'idea', type: KIND_TYPE.idea, name: title, parent_id: place.id ?? null, ...(place.ref ? { parent_ref: place.ref } : {}), description: text }],
  };
}

// «📝 Записав у Спільнота › Майстерня: …» / «💡 Нова ідея «…» → Пет-проєкти» — the line under a knowledge-base write.
function kbNotesText(plans) {
  const created = (x) => `💡 Нова ідея «${esc(x.title)}» → <b>${esc(x.where.replace(/ › [^›]+$/, ''))}</b>`;
  const x = plans[0];
  if (plans.length === 1) return `${x.kind === 'create' ? created(x) : `📝 Записав у <b>${esc(x.where)}</b>`}\n<i>${esc(clip(x.text, 300))}</i>`;
  return `📝 Записав (${plans.length}):\n${plans.map((y) => `• ${y.kind === 'create' ? created(y) : `<b>${esc(y.where)}</b>`}: <i>${esc(clip(y.text, 140))}</i>`).join('\n')}`;
}

// Structure changes the router asks for (`kb`): create / rename / move / merge / archive / link / unlink / alias.
// Returns database ops and one line per change for the owner; unknown names are reported, not guessed.
const KB_KINDS = ['sphere', 'project', 'topic', 'idea', 'person'];

// The records «видали / перенеси це» is about: entries and lines of a place's text (knowledge from Obsidian lives
// there: «- [x] Доручити Олексію»), in `scope` (ids) or anywhere. Records whose words are mostly in the asked text
// (a pasted quote of several lines finds each); if none, those that mostly hold the asked text («видали квитки»).
function kbRecords(text, scope = null) {
  const q = new Set(stems(text));
  if (!q.size) return [];
  const live = knowledge().entities.filter((e) => e.status !== 'archived' && (!scope || scope.has(e.id)));
  const ids = new Set(live.map((e) => e.id));
  const cands = [
    ...knowledge().entries.filter((x) => ids.has(Number(x.entity_id))).map((x) => ({ kind: 'entry', id: x.id, entity_id: Number(x.entity_id), text: String(x.text) })),
    ...live.flatMap((e) => String(e.description || '').split('\n').map((line, i) => ({ kind: 'line', entity_id: e.id, index: i, text: line })).filter((x) => x.text.trim())),
  ];
  const scored = cands.map((c) => {
    const words = new Set(stems(c.text));
    const shared = [...words].filter((w) => q.has(w)).length;
    return { ...c, whole: words.size > 0 && shared / words.size >= 0.75 && shared >= Math.min(2, words.size), part: shared / q.size >= 0.75 };
  });
  const whole = scored.filter((c) => c.whole);
  return whole.length ? whole : scored.filter((c) => c.part);
}

// «закинь це в Активні» after the bot described a project: the model writes that description as a note there, but
// the project itself moves. The place whose
// first description line the note's text mostly holds (60%: it is the bot's own retelling), if it is not the note's
// place or above it.
function placeNamedByNote(notes, it) {
  const to = vaultFind(notes, it.place);
  if (!to) return null;
  const q = new Set(stems(`${it.title || ''} ${it.description || ''}`));
  const from = notes.find((n) => {
    if (n.id === to.id || !['project', 'topic', 'idea'].includes(n.kind) || to.path.startsWith(n.path)) return false;
    const words = new Set(stems(n.desc));
    return words.size >= 3 && [...words].filter((w) => q.has(w)).length / words.size >= 0.6;
  });
  return from ? { from, to } : null;
}

// A record as the owner sees it: «- [x] Доручити Олексію» → «Доручити Олексію».
const recordText = (s) => String(s).replace(/^\s*[-*]\s*(\[[ xX]\]\s*)?/, '').trim();

function kbOps(notes, list, newPeople = [], said = '') {
  const ops = [];
  const lines = [];
  const all = knowledge().entities;
  // What this list creates is found by its later ops («створи проєкт Редіт і додай туди Діму»): by ref, not id.
  const made = [];
  const find = (name) => vaultFind(notes, name) || vaultFind(made, name);
  const sub = (id) => {
    const out = new Set([id]);
    for (let grew = true; grew;) {
      grew = false;
      for (const e of all) if (out.has(e.parent_id) && !out.has(e.id)) { out.add(e.id); grew = true; }
    }
    return out;
  };
  const noun = { sphere: 'сфера', project: 'проєкт', topic: 'тема', idea: 'ідея', person: 'людина' };
  for (const k of list || []) {
    if (!k || !k.op) continue;
    const target = find(k.target);
    const miss = (x) => lines.push(`⚠️ Не знайшов «${esc(x || '')}» — уточни назву.`);
    if (k.op === 'forget' || k.op === 'move_entry') {
      // «оце видали» / «перенеси це в Активні»: records found by their words, in the named place or anywhere.
      const to = k.op === 'move_entry' ? find(k.parent) : null;
      if (k.op === 'move_entry' && (!to || to.ref)) { miss(k.parent); continue; }
      // The named place is where to look first, not a limit: the model often names the wrong one.
      let scope = target && !target.ref ? sub(target.id) : null;
      let found = kbRecords(k.text, scope).filter((r) => !to || r.entity_id !== to.id);
      if (!found.length && scope) { scope = null; found = kbRecords(k.text).filter((r) => !to || r.entity_id !== to.id); }
      // The model often quotes only part of a pasted quote: lines of the same place the message holds whole come too.
      const key = (r) => `${r.kind}${r.id ?? ''}:${r.entity_id}:${r.index ?? ''}`;
      if (said) found.push(...kbRecords(said, scope).filter((r) => r.whole && found.some((f) => f.entity_id === r.entity_id) && !found.some((f) => key(f) === key(r))));
      const places = new Set(found.map((r) => r.entity_id));
      // «Проєкт Олени: аналіз фронту …» — no record, but the text names one project: that project moves.
      const named = !found.length && to ? vaultMentions(notes, k.text).filter((n) => ['project', 'topic', 'idea'].includes(n.kind) && n.id !== to.id) : [];
      if (named.length === 1) {
        if (sub(named[0].id).has(to.id)) { lines.push(`⚠️ «${esc(named[0].name)}» не можна перенести всередину себе.`); continue; }
        ops.push({ op: 'update', id: named[0].id, set: { parent_id: to.id } });
        lines.push(`📦 «${esc(named[0].name)}» тепер у ${esc(vaultPlace(to))}`);
        continue;
      }
      if (!found.length) { lines.push(`⚠️ Не знайшов запис «${esc(clip(k.text || '', 60))}» — напиши його словами точніше.`); continue; }
      if (found.length > 3 || places.size > 1) {
        lines.push(`⚠️ Під «${esc(clip(k.text || '', 60))}» підходить ${found.length}: ${found.slice(0, 4).map((r) => `«${esc(clip(recordText(r.text), 50))}»`).join(', ')} — уточни, який саме.`);
        continue;
      }
      const place = all.find((e) => e.id === found[0].entity_id);
      // Moving the line that defines a project or idea (its first one) moves the project itself.
      if (to && ['project', 'topic', 'idea'].includes(place.kind) && found.some((r) => r.kind === 'line' && r.index === 0)) {
        if (sub(place.id).has(to.id)) { lines.push(`⚠️ «${esc(place.name)}» не можна перенести всередину себе.`); continue; }
        ops.push({ op: 'update', id: place.id, set: { parent_id: to.id } });
        lines.push(`📦 «${esc(place.name)}» тепер у ${esc(vaultPlace(to))}`);
        continue;
      }
      const drop = found.filter((r) => r.kind === 'line').map((r) => r.index);
      if (drop.length) ops.push({ op: 'update', id: place.id, set: { description: String(place.description).split('\n').filter((_, i) => !drop.includes(i)).join('\n') } });
      for (const r of found) {
        if (r.kind === 'entry') ops.push(to ? { op: 'entry_move', id: r.id, entity_id: to.id } : { op: 'drop_entry', id: r.id });
        else if (to) ops.push({ op: 'entry', entity_id: to.id, text: recordText(r.text) });
      }
      const names = found.map((r) => `«${esc(clip(recordText(r.text), 80))}»`).join(', ');
      const from = vaultPlace(notes.find((n) => n.id === place.id) || { path: place.name });
      lines.push(to ? `📦 ${names}: ${esc(from)} → ${esc(vaultPlace(to))}` : `🗑 Прибрав з ${esc(from)}: ${names}`);
    } else if (k.op === 'create') {
      const name = safeTitle(k.name);
      const kind = KB_KINDS.includes(k.kind) ? k.kind : 'project';
      if (!name) continue;
      if (find(name)) { lines.push(`«${esc(name)}» вже є — ${esc(vaultPlace(find(name)))}.`); continue; }
      const parent = kind === 'person' ? null : find(k.parent);
      if (k.parent && !parent && kind !== 'person') { miss(k.parent); continue; }
      ops.push({ op: 'create', ref: `e:${name}`, kind, type: noun[kind], name, parent_id: parent ? parent.id ?? null : null, ...(parent && parent.ref ? { parent_ref: parent.ref } : {}), description: '' });
      made.push({ ref: `e:${name}`, kind, name, aliases: [], path: parent ? `${parent.path}/${name}` : name });
      lines.push(`${{ person: '👤', idea: '💡' }[kind] || '🗂'} Нов${kind === 'project' ? 'ий' : 'а'} ${noun[kind]} «${esc(name)}»${parent ? ` → ${esc(vaultPlace(parent))}` : ''}`);
    } else if (!target) {
      miss(k.target);
    } else if (target.ref && k.op !== 'link') {
      continue;
    } else if (k.op === 'rename' && safeTitle(k.name)) {
      ops.push({ op: 'update', id: target.id, set: { name: safeTitle(k.name) } });
      lines.push(`✏️ «${esc(target.name)}» → «${esc(safeTitle(k.name))}»`);
    } else if (k.op === 'move') {
      const parent = find(k.parent);
      if (!parent) { miss(k.parent); continue; }
      if (sub(target.id).has(parent.id)) { lines.push(`⚠️ «${esc(target.name)}» не можна перенести всередину себе.`); continue; }
      ops.push({ op: 'update', id: target.id, set: { parent_id: parent.id } });
      lines.push(`📦 «${esc(target.name)}» тепер у ${esc(vaultPlace(parent))}`);
    } else if (k.op === 'merge') {
      const into = find(k.into);
      if (!into || into.id === target.id) { miss(k.into); continue; }
      ops.push({ op: 'merge', id: target.id, into: into.id });
      lines.push(`🔀 «${esc(target.name)}» обʼєднано з «${esc(into.name)}»`);
    } else if (k.op === 'archive') {
      ops.push({ op: 'update', id: target.id, set: { status: 'archived' } });
      lines.push(`📦 «${esc(target.name)}» закрито (в архіві)`);
    } else if (k.op === 'alias' && safeTitle(k.name)) {
      ops.push({ op: 'update', id: target.id, set: { aliases: [...target.aliases, safeTitle(k.name)].join(', ') } });
      lines.push(`🏷 «${esc(target.name)}» — також «${esc(safeTitle(k.name))}»`);
    } else if (k.op === 'link' || k.op === 'unlink') {
      let person = find(k.person);
      // «Марта теж там працює» about someone not in the base yet: the person is added along with the link.
      // Only someone the model calls a new person or the bot already asked about: «до активних додай lanora» made
      // a person «Lanora».
      const known = [...(newPeople || []), ...rowsOf('Get person asks').map((a) => a.text)].map((x) => String(x || '').toLowerCase());
      if (!person && k.op === 'link' && personName(k.person) && known.includes(personName(k.person).toLowerCase())) {
        const name = personName(k.person);
        ops.push({ op: 'create', ref: `p:${name}`, kind: 'person', type: noun.person, name, parent_id: null, description: '' });
        person = { ref: `p:${name}`, kind: 'person', name, aliases: [], path: name };
        made.push(person);
        lines.push(`👤 Нова людина «${esc(name)}»`);
      }
      if (!person || person.kind !== 'person') { miss(k.person); continue; }
      ops.push({ op: k.op, person_id: person.id ?? null, ...(person.ref ? { person_ref: person.ref } : {}), entity_id: target.id ?? null, ...(target.ref ? { entity_ref: target.ref } : {}), role: k.role || '' });
      lines.push(k.op === 'link' ? `👤 ${esc(person.name)} ↔ ${esc(vaultPlace(target))}${k.role ? ` (${esc(k.role)})` : ''}` : `👤 ${esc(person.name)} більше не в «${esc(target.name)}»`);
    }
  }
  return { ops, lines, made };
}

// ---------- what a question is answered from ----------
// A place's subtree: the ids of it and of everything under it that is not archived.
function subtreeOf(ids) {
  const want = new Set(ids.map(Number));
  for (let grew = true; grew;) {
    grew = false;
    for (const e of knowledge().entities) if (want.has(e.parent_id) && !want.has(e.id) && e.status !== 'archived') { want.add(e.id); grew = true; }
  }
  return want;
}

// What the base knows about places, without tasks (those change every day): the places with their people, what is
// inside, and each one's text. Small ones go to the model as they are; big ones are summarised (summary_request.js).
// `perBody` — how much of each text: clipped for the model, in full for a summary and for measuring.
function knowledgeText(ids, notes = vaultNotes(), perBody = 900) {
  const top = ids.map(Number);
  const want = subtreeOf(top);
  const inSub = notes.filter((n) => want.has(n.id));
  const out = [];
  for (const n of inSub.filter((x) => top.includes(x.id))) {
    out.push(`## ${vaultPlace(n)} [${n.type}]${n.kind !== 'person' && n.roles.length ? ` · люди: ${n.roles.join(', ')}` : ''}`);
    if (n.kind === 'person' && n.spheres.length) out.push(`Де: ${n.spheres.map((x) => `${x.name}${x.role ? ` (${x.role})` : ''}`).join(', ')}`);
  }
  const children = inSub.filter((n) => !top.includes(n.id));
  if (children.length) out.push(`Усередині: ${children.map((n) => `${n.name} [${n.type}]${n.roles.length ? ` (люди: ${n.roles.join(', ')})` : ''}${n.desc ? ` — ${clip(n.desc, 80)}` : ''}`).join('; ')}`);
  for (const n of inSub) {
    const body = String(n.body || '').trim();
    if (body) out.push(`### ${n.name}\n${clip(body, Math.min(perBody, n.kind === 'idea' ? 300 : perBody))}`);
  }
  // A person asked about: the records of their places that name them («Марта досліджує …» filed in Атлас).
  for (const n of inSub.filter((x) => top.includes(x.id) && x.kind === 'person')) {
    const where = new Set(n.spheres.map((x) => x.id));
    const named = knowledge().entries.filter((e) => where.has(Number(e.entity_id)) && vaultMentions([n], e.text).length)
      .sort((a, b) => b.ts - a.ts).map((e) => `- ${DateTime.fromMillis(Number(e.ts), { zone: TZ }).toFormat('dd.LL')} ${clip(String(e.text).replace(/\s+/g, ' '), 200)}`);
    if (named.length) out.push(`### Про ${n.name} у записах місць\n${clip(named.join('\n'), Math.min(perBody, 900))}`);
  }
  // The people of these places: what is written about them is about the places too («Марта досліджує … в Атлас»).
  const names = new Set(inSub.flatMap((n) => n.people));
  for (const n of notes.filter((x) => x.kind === 'person' && names.has(x.name) && !want.has(x.id))) {
    const body = String(n.body || '').trim();
    if (body) out.push(`### 👤 ${n.name}\n${clip(body, Math.min(perBody, 600))}`);
  }
  return out.join('\n');
}

// A place whose knowledge is longer than this gets a summary; shorter ones are sent as they are.
const SUMMARY_MIN = 2500;

// A short stable hash (djb2): a summary is redone only when the text it was made from changed.
function hashText(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// The owner's profile (kv «profile», made from the top places' summaries), when the caller passed it.
function profile() {
  try {
    return $('Profile').first().json || {};
  } catch (e) {
    return {};
  }
}

// One place for a question: as it is when small or not summarised yet; otherwise its summary, the 10 newest entries
// of its subtree and the names inside.
function placeBrief(id, notes, rows, limit) {
  const row = rows.get(id) || {};
  if (knowledgeText([id], notes, Infinity).length <= SUMMARY_MIN || !row.summary) return clip(knowledgeText([id], notes), limit);
  const want = subtreeOf([id]);
  const n = notes.find((x) => x.id === id);
  const names = new Map(notes.map((x) => [x.id, x.name]));
  const recent = knowledge().entries.filter((e) => want.has(Number(e.entity_id))).sort((a, b) => b.ts - a.ts).slice(0, 10)
    .map((e) => `- ${DateTime.fromMillis(Number(e.ts), { zone: TZ }).toFormat('dd.LL')} ${names.get(Number(e.entity_id)) || ''}: ${clip(String(e.text).replace(/\s+/g, ' '), 150)}`);
  const inside = notes.filter((x) => want.has(x.id) && x.id !== id).map((x) => x.name);
  return [`## ${vaultPlace(n)} [${n.type}]${n.roles.length ? ` · люди: ${n.roles.join(', ')}` : ''}`, row.summary,
    ...(inside.length ? [`Усередині: ${clip(inside.join(', '), 600)}`] : []), ...(recent.length ? ['Свіжі записи:', ...recent] : [])].join('\n');
}

// What a question «що там про спільноту?» is answered from: each asked place (as it is, or its summary with fresh entries),
// then the open tasks of those places (by area or @person) and tasks closed in the last 14 days. `whole` — the
// whole base («що ти про мене знаєш?»): the profile first, every top place, every open task.
function dossier(ids, openRows, doneRows, nowMs, whole = false) {
  const notes = vaultNotes();
  const rows = new Map(knowledge().entities.map((e) => [e.id, e]));
  const want = subtreeOf(ids);
  const people = new Set();
  for (const n of notes.filter((x) => want.has(x.id))) {
    if (n.kind === 'person') people.add(n.name.toLowerCase());
    for (const p of n.people) people.add(p.toLowerCase());
  }
  // A task is about these people when tagged @them or named in its title. For a named person, also check the originating message.
  const known = notes.filter((n) => n.kind === 'person' && people.has(n.name.toLowerCase()));
  const asked = known.filter((n) => want.has(n.id));
  const names = (t) => vaultMentions(known, `${t.title} ${t.description || ''}`).length > 0;
  const fromMessage = (t) => !whole && !names(t) && vaultMentions(asked, t.source).length > 0;
  const byArea = (t) => whole || want.has(Number(t.entity_id)) || contextTags(t).some((c) => c.startsWith('@') && people.has(c.slice(1).toLowerCase()))
    || names(t) || fromMessage(t);
  const out = [];
  if (whole && profile().text) out.push(`ПРОФІЛЬ ВЛАСНИКА:\n${profile().text}`);
  // The whole base is an overview: short top places, and the people on one line.
  for (const id of ids.map(Number)) if (rows.has(id) && !(whole && rows.get(id).kind === 'person')) out.push(placeBrief(id, notes, rows, whole ? 800 : 7000));
  const persons = whole ? notes.filter((n) => n.kind === 'person') : [];
  if (persons.length) out.push(`ЛЮДИ: ${persons.map((n) => `${n.name}${n.roles.length ? ` — ${n.roles.join(', ')}` : ''}${n.desc ? ` («${clip(n.desc, 80)}»)` : ''}`).join('; ')}`);
  const knowledgePart = clip(out.join('\n\n'), whole ? 12000 : 7000);
  const open = openRows.filter(byArea);
  const line = (t) => `t${t.id} «${t.title}»${whenLine(t, nowMs) ? ` (${whenLine(t, nowMs)})` : ''}${fromMessage(t) ? ` (з повідомлення «${clip(t.source, 200)}»)` : ''}`;
  const tasks = [`Відкриті справи (${open.length}): ${open.map(line).join('; ') || '—'}`];
  const done = doneRows.filter((t) => byArea(t) && Date.parse(t.updatedAt || 0) > nowMs - 14 * 86400000);
  if (done.length) tasks.push(`Закрито за 14 днів: ${done.map((t) => `«${t.title}»`).join('; ')}`);
  return `${knowledgePart}\n\n${clip(tasks.join('\n'), 3000)}`;
}

// What needs a (new) summary: places with long knowledge whose text changed since; then the profile, when the
// top places' summaries changed. One batch per call, the rest goes in the next run.
function summaryWork(prof) {
  const notes = vaultNotes();
  const live = knowledge().entities.filter((e) => e.status !== 'archived');
  const changed = [];
  for (const e of live.filter((x) => x.kind !== 'idea' && x.kind !== 'person')) {
    const text = knowledgeText([e.id], notes, Infinity);
    if (text.length <= SUMMARY_MIN) continue;
    const hash = hashText(text);
    if (hash !== e.summary_hash) changed.push({ id: e.id, path: vaultPlace(notes.find((n) => n.id === e.id)), text: clip(text, 12000), hash });
  }
  if (changed.length) {
    const batch = [];
    let size = 0;
    for (const c of changed) {
      if (batch.length && size + c.text.length > 20000) break;
      batch.push(c);
      size += c.text.length;
    }
    return { kind: 'summaries', batch };
  }
  // The profile: every top place (its summary, or its short text) and the people with their roles.
  const tops = live.filter((e) => !e.parent_id && e.kind !== 'person');
  const people = notes.filter((n) => n.kind === 'person').map((n) => `${n.name}${n.roles.length ? ` — ${n.roles.join(', ')}` : ''}${n.desc ? ` («${clip(n.desc, 80)}»)` : ''}`);
  const material = [...tops.map((e) => (e.summary ? `## ${e.name}\n${e.summary}` : clip(knowledgeText([e.id], notes), 1500))), `ЛЮДИ: ${people.join('; ')}`].join('\n\n');
  const hash = hashText(material);
  return hash === (prof || {}).hash ? null : { kind: 'profile', material, hash };
}

const SUMMARY_SCHEMA = {
  type: 'array',
  items: { type: 'object', properties: { id: { type: 'integer' }, summary: { type: 'string' } }, required: ['id', 'summary'] },
};

// The answer to a question: the reply, buttons to the tasks and notes it is about, the places it came from.
function answerView(p, openRows, noteRows, vault) {
  const findT = (ref) => openRows.find((t) => `t${t.id}` === ref);
  const findN = (ref) => noteRows.find((n) => `n${n.id}` === ref);
  let refs = (p.targets || []).filter((ref) => findT(ref) || findN(ref));
  if (!refs.length) {
    // Gemini sometimes forgets targets; attach the items whose titles the answer mentions.
    const said = String(p.reply || '').toLowerCase();
    refs = [...openRows.map((t) => [`t${t.id}`, t.title]), ...noteRows.map((n) => [`n${n.id}`, n.title])]
      .filter(([, title]) => title && said.includes(String(title).toLowerCase())).map(([ref]) => ref);
  }
  refs = refs.slice(0, MAX_BUTTONS);
  const sources = [...new Set((p.sources || []).map((x) => vaultFind(vault, x)).filter(Boolean).map(vaultPlace))].slice(0, 5);
  // Internal refs (t6, n7) are not for the owner's eyes.
  const reply = esc(clip(String(p.reply || 'Не знайшов про це даних.').replace(/\s?\(\b[tn]\d+\)|\b[tn]\d+\s?/g, '').trim(), 2500))
    + (sources.length ? `\n\n🗂 ${sources.map(esc).join(' · ')}` : '');
  const name = (ref) => (findT(ref) ? esc(findT(ref).title) : `📝 ${esc(findN(ref).title)}`);
  return {
    refs, text: refs.length ? `${reply}\n\n${refs.map((ref, i) => `${i + 1}. ${name(ref)}`).join('\n')}` : reply,
    log: `відповів: ${clip(p.reply || '', 200)}${refs.length ? ` і ${listLog('записи', refs, (ref) => (findT(ref) || findN(ref)).title)}` : ''}`,
  };
}

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    targets: { type: 'array', items: { type: 'string' }, nullable: true },
    sources: { type: 'array', items: { type: 'string' }, nullable: true },
  },
  required: ['reply', 'targets', 'sources'],
  propertyOrdering: ['reply', 'targets', 'sources'],
};

// ---------- Gemini router prompt ----------

const ITEM_PROPS = {
  type: { type: 'string', enum: ['task', 'event', 'note'] },
  title: { type: 'string' },
  description: { type: 'string', nullable: true },
  tags: { type: 'array', items: { type: 'string' }, nullable: true },
  deadline: { type: 'string', nullable: true },
  starts_at: { type: 'string', nullable: true },
  ends_at: { type: 'string', nullable: true },
  reminder_type: { type: 'string', enum: ['once', 'daily_until_done', 'interval', 'none'], nullable: true },
  remind_at: { type: 'string', nullable: true },
  daily_time: { type: 'string', nullable: true },
  interval_minutes: { type: 'integer', nullable: true },
  first_reminder_at: { type: 'string', nullable: true },
  context: { type: 'array', items: { type: 'string' }, nullable: true },
  priority: { type: 'integer', nullable: true },
  area: { type: 'string', nullable: true },
  place: { type: 'string', nullable: true },
  new_note: { type: 'boolean', nullable: true },
  repeat: {
    type: 'object', nullable: true,
    properties: {
      freq: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
      weekdays: { type: 'array', items: { type: 'integer' }, nullable: true },
      month_day: { type: 'integer', nullable: true },
      until: { type: 'string', nullable: true },
    },
    required: ['freq', 'weekdays', 'month_day', 'until'],
  },
};

// Gemini drops optional fields it is not forced to emit, so item fields are required-but-nullable.
const ITEM_ORDER = ['type', 'title', 'description', 'deadline', 'starts_at', 'ends_at', 'reminder_type', 'remind_at',
  'daily_time', 'interval_minutes', 'first_reminder_at', 'repeat', 'tags', 'context', 'priority', 'area', 'place', 'new_note'];

const ROUTER_SCHEMA = {
  type: 'object',
  properties: {
    heard: { type: 'string', nullable: true },
    intent: { type: 'string', enum: INTENTS },
    items: { type: 'array', nullable: true, items: { type: 'object', properties: ITEM_PROPS, required: ITEM_ORDER, propertyOrdering: ITEM_ORDER } },
    edits: {
      type: 'array', nullable: true,
      items: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          set: { type: 'object', properties: { ...ITEM_PROPS, append_description: { type: 'string', nullable: true } } },
          clear: { type: 'array', items: { type: 'string', enum: ['deadline', 'reminder', 'description', 'ends_at', 'repeat'] }, nullable: true },
        },
        required: ['target'],
      },
    },
    done: { type: 'array', items: { type: 'string' }, nullable: true },
    removed: { type: 'array', items: { type: 'string' }, nullable: true },
    targets: { type: 'array', items: { type: 'string' }, nullable: true },
    query: {
      type: 'object', nullable: true,
      properties: {
        view: { type: 'string', enum: ['day', 'week', 'tasks', 'notes', 'context'] },
        date: { type: 'string', nullable: true },
        search: { type: 'string', nullable: true },
      },
      required: ['view', 'date', 'search'],
      propertyOrdering: ['view', 'date', 'search'],
    },
    reply: { type: 'string', nullable: true },
    sources: { type: 'array', items: { type: 'string' }, nullable: true },
    about: { type: 'array', items: { type: 'string' }, nullable: true },
    web: { type: 'string', nullable: true },
    kb: {
      type: 'array', nullable: true,
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['create', 'rename', 'move', 'merge', 'archive', 'link', 'unlink', 'alias', 'forget', 'move_entry'] },
          text: { type: 'string', nullable: true },
          name: { type: 'string', nullable: true },
          kind: { type: 'string', enum: ['sphere', 'project', 'topic', 'idea', 'person'], nullable: true },
          target: { type: 'string', nullable: true },
          parent: { type: 'string', nullable: true },
          into: { type: 'string', nullable: true },
          person: { type: 'string', nullable: true },
          role: { type: 'string', nullable: true },
        },
        required: ['op', 'name', 'kind', 'target', 'parent', 'into', 'person', 'role', 'text'],
        propertyOrdering: ['op', 'name', 'kind', 'target', 'parent', 'into', 'person', 'role', 'text'],
      },
    },
    new_people: { type: 'array', items: { type: 'string' }, nullable: true },
    until: { type: 'string', nullable: true },
  },
  required: ['heard', 'intent', 'items', 'edits', 'done', 'removed', 'kb', 'targets', 'query', 'reply', 'about', 'web', 'sources', 'new_people', 'until'],
  propertyOrdering: ['heard', 'intent', 'items', 'edits', 'done', 'removed', 'kb', 'targets', 'query', 'reply', 'about', 'web', 'sources', 'new_people', 'until'],
};

// Gemini is unreliable at weekday/relative-date arithmetic, so it gets a ready lookup table.
function dateRules(now) {
  const today = now.startOf('day');
  const late = now.hour < LATE_NIGHT_HOUR;
  const iso = (d) => d.toFormat('yyyy-LL-dd');
  const words = [
    `сьогодні → ${iso(today)}`,
    `завтра → ${iso(logicalTomorrow(now))}${late ? ' (зараз ніч, користувач ще не спав)' : ''}`,
    `післязавтра → ${iso(today.plus({ days: late ? 1 : 2 }))}`,
  ];
  const days = [];
  for (let i = 0; i < 14; i += 1) {
    const d = today.plus({ days: i });
    days.push(`${iso(d)} — ${WEEKDAY_UK[d.weekday]}${i === 0 ? ' (сьогодні)' : ''}`);
  }
  // Day-level only: the exact time is at the very end of the prompt, so this part — and everything before it —
  // stays the same all day and Gemini serves it from its cache.
  return `Сьогодні: ${iso(today)}, ${WEEKDAY_UK[today.weekday]} (Europe/Kyiv, UTC${today.set({ hour: 12 }).toFormat('ZZ')}).
Дати повертай в ISO 8601 зі зсувом Києва, напр. ${toIso(today.set({ hour: 18 }))}.
БЕРИ ДАТИ ЛИШЕ З ЦИХ ТАБЛИЦЬ, нічого не рахуй сам:
Слова: ${words.join('; ')}.
Календар:
${days.join('\n')}
День тижня («у пʼятницю», «до четверга», «кінець середи») — найближча дата з цим днем у календарі
(сьогоднішня, якщо збігається і час ще не минув; «наступного тижня» — на 7 днів пізніше).
Час без хвилин («до 18», «о 9», «на 20») — рівно о годині. «18 30» = 18:30. «до кінця дня» = 23:59.`;
}

const TEXT_RULES = `Тексти:
- title — 2–6 слів, словами користувача («Заявка на стажування», «Семінар з анімації»); дієслово — лише якщо без нього
  незрозуміло. Виправ одруківки й великі літери в іменах, але НЕ сленг, скорочення й назви (спринт, Ретро, Атлас, Атлас).
  Без дат і слів про нагадування.
- description — лише якщо є контекст понад назву: його ж текст, вичитаний (одруківки, пунктуація, «• » для пунктів),
  нічого не вигадуй і не скорочуй, без дат. Коротке повідомлення → null. Для note — повний вичитаний текст, зрозумілий
  сам по собі: хто й що («Марта перевіряє кольори афіші …», а не «Перевіряє кольори …»); tags — 1–3 слова малими.
- note: place — назва з КАРТИ (проєкт, людина, тема ідей, сфера; з урахуванням «інакше:»), не впевнений — "Inbox";
  new_note true — нова самостійна ідея (title — її назва), false — доповнення до наявного (деталь, крок, факт).
  Новий розділ для записів («заведи нотатку витрати в Атлас») створює kb create, а сам запис — note з place = нова
  назва, new_note false; не дублюй його note-ом з new_note true.
- task/event: place і new_note = null; area — назва з КАРТИ, до чого справа належить за змістом і людьми («написати
  Денису про замовлення паперу» → Майстерня, «пара з Денисом» → Навчання); незрозуміло — null; людей сюди не пиши.`;

const ITEM_RULES = `Типи:
- "task" — треба ЗРОБИТИ; deadline або null (лише дата → 23:59).
- "event" — відбувається в певний час (зустріч, пара, баня, дзвінок), навіть якщо кажуть «таск»: starts_at, ends_at
  або null («з 18 30 по 19 20», «на півтори години»), deadline = null.
- "note" — ЗАПАМʼЯТАТИ (ідея, думка, факт, посилання). Почалось з «ідея / нотатка / думка / запиши / запамʼятай» —
  ЗАВЖДИ create note, навіть із «зробити», «як» усередині. Переслане без прохання нагадати — note.
- Вставлений чужий лист до кількох («прошу вас…») — task власнику, ти не адресат.
reminder_type: "once" (remind_at) | "daily_until_done" (daily_time HH:MM) | "interval" (interval_minutes) | "none".
- Подія без вказівки → once за ${EVENT_REMIND_BEFORE_MIN} хв до початку; «нагадай за 15 хв / за день» — від starts_at.
- Задача з дедлайном → once без remind_at (час вибере система); без дати й прохання → none.
- daily_until_done / interval — ЛИШЕ на пряме прохання («нагадуй щодня / кожні 2 год»). «о 15:00» без дати — сьогодні,
  а якщо минуло — завтра; «щодня» без часу — 09:00; «періодично» — 180 хв.
repeat — коли САМА справа повторюється: weekly {weekdays: 1=пн … 7=нд} («щопонеділка», «по вт і чт»), monthly
  {month_day}, daily; until — «до кінця семестру / до 31.12». starts_at/deadline — найближче повторення з календаря.
  Пара, тренування → event; оплата щомісяця → task. «нагадуй щодня, поки не зроблю» — daily_until_done, repeat = null.
context (лише task): місце («в АТБ» → ["АТБ"], «на пошті» → ["Нова пошта"], «в аптеці / універі / місті»; покупки без
  місця → ["магазин"]) і людина з @ у називному відмінку («віддати Ігорю» → ["@Ігор"]); нічого — null.
priority (task, event): 5 «терміново / горить / !!!» · 4 «важливо / не забути б» · 2 «якщо встигну» · 1 «колись /
  не важливо». Сам — лише 4 для серйозного (співбесіда, іспит, захист, подача документів, оплата, лікар); 5 — лише
  зі слів; інакше null. «зроби есе терміновим» → edit set {priority}.`;

function itemRef(t) {
  return `t${t.id}`;
}

function contextBlock(openRows, noteRows, dialogRows, nowMs) {
  const now = DateTime.fromMillis(nowMs, { zone: TZ });
  const tasks = openRows.slice(0, 60).map((t) => {
    const parts = [`t${t.id}`, t.kind === 'event' ? 'подія' : 'задача', `«${t.title}»`];
    const human = whenLine(t, nowMs);
    if (human) parts.push(`(${human})`);
    if (t.kind === 'event' && t.starts_at) parts.push(`початок ${t.starts_at}${t.ends_at ? ` кінець ${t.ends_at}` : ''}`);
    if (t.deadline) parts.push(`дедлайн ${t.deadline}`);
    if (t.rule && t.rule !== 'none') parts.push(`нагадування ${t.rule}${t.next_ts ? ` наступне ${toIso(DateTime.fromMillis(t.next_ts, { zone: TZ }))}` : ''}${t.remind_time ? ` о ${t.remind_time}` : ''}`);
    if (t.context) parts.push(`мітки: ${t.context}`);
    if (areaLabel(t)) parts.push(`належить: ${areaLabel(t).replace('🗂 ', '')}`);
    if (prio(t) !== 3) parts.push(`важливість ${prio(t)} (${PRIORITY_NAME[prio(t)]})`);
    if (t.description) parts.push(`опис: ${clip(t.description.replace(/\n/g, ' '), 120)}`);
    return parts.join(' · ');
  });
  const notes = noteRows.slice(-30).reverse().map((n) => `n${n.id} · «${n.title}»${n.tags ? ` #${n.tags.replace(/,/g, ' #')}` : ''}${n.text && n.text !== n.title ? ` — ${clip(n.text.replace(/\n+/g, ' '), 300)}` : ''}`);
  const dialog = dialogRows.slice(-12).map((d) => `${d.role === 'user' ? 'користувач' : 'бот'}: ${clip(d.text, 220)}${d.item_ids ? ` [${d.item_ids}]` : ''}`);
  return `ВІДКРИТІ ЗАДАЧІ Й ПОДІЇ (${tasks.length}):
${tasks.join('\n') || '—'}

${notes.length ? `ОСТАННІ НОТАТКИ (стара таблиця):\n${notes.join('\n')}\n\n` : ''}ЗАКРИТО СЬОГОДНІ: ${closedTodayText(dialogRows, nowMs)}

ОСТАННІЙ ДІАЛОГ (від старіших до новіших, у [ ] — про які записи йшлося):
${dialog.join('\n') || '—'}
Зараз ${toIso(now)}.`;
}

const ROUTER_RULES = `intent — одне повідомлення може робити КІЛЬКА дій; виконай усі, нічого не пропускай:
- items — нові записи; edits [{target:"t12", set, clear}] — зміни наявних (set — лише змінені поля; append_description
  — дописати в опис; clear — прибрати дедлайн / нагадування / опис / кінець; нотатку на задачу: target "n7", set
  {type:"task", …}); done — закрити («зробив», «здав»); removed — видалити («не треба», «скасуй»; «видали» — це
  видалити, не закрити). intent: "create", якщо є items, інакше "edit"; одна дія — "complete" / "delete" з targets.
- Кожну частину повідомлення спершу шукай серед ВІДКРИТИХ ЗАДАЧ, навіть іншими словами («макет буклета» = «Зайти на
  макет буклета і перевірити текст»): про наявну справу — edits / done / removed, а не новий запис і не дубль («нагадай о 8:45
  про …» → set {remind_at}). Але лише ТА САМА справа (той самий предмет, людина, проєкт): «звіт» ≠ «есе». Такої
  немає — items, а чужу справу не чіпай. «зміни / перенеси / постав дедлайн» про наявну — завжди edit.
- Розклад як пояснення часу («о 8:30 я на парі», «потім ще пара», «після роботи») — НЕ запис, а лише КОЛИ нагадати
  («через годину ще пара» → 9:30). Подію пиши, лише коли її просять додати («завтра о 10 пара з дизайну»).
- "move_pending" — «перенеси все незроблене / прострочене на завтра» (усе разом, без назв).
- "query" — показати список: view day | week | tasks | notes, date — з календаря, search — слово для notes ДОСЛІВНО
  або null. «що купити в АТБ», «що треба від Ігоря», «я йду в місто» → view "context", search — місце чи імʼя в
  називному відмінку. «оновлений список / покажи ще раз» → знову той вид, що в останньому списку бота (показав день X → day X; відповів
  списком справ на сьогодні → day сьогодні; тиждень → week).
  «<справа> <коли>» без питання («гру на 21») — це edit, а не пошук.
- "answer" — питання. Визнач тип:
  1) про справи, дати, дії бота → reply коротко (≤ 250 символів, можна «• ») лише за даними нижче, дати по-людськи
     («сьогодні до 23:59», «у чт 22.10»); targets — усі записи, про які мова (≤ 8). «перевір, чи є …» — що вже є
     серед відкритих, а чого немає; нічого не змінюй. Сумнів («ти помилився?», «я ж скасував») — конкретно за ОСТАННІМ
     ДІАЛОГОМ і ЗАКРИТО СЬОГОДНІ («скасувати» = та дія бота була помилкою). Про свої дії — лише те, що є в діалозі.
  2) про знання власника — нотатки, ідеї, сфери, проєкти, люди («що там про спільноту?», «що Ігор робить?», «що я записував
     про книги?») → about — 1–3 назви з КАРТИ, reply = null; про всю базу чи про самого власника («проаналізуй мої
     нотатки», «що ти про мене знаєш?») → about ["ВСЕ"]. Зміст бот дочитає сам: не кажи, що даних немає.
  3) загальне — знання, порада, пояснення, ідея, текст → reply — повна відповідь розумного асистента (≤ 1200 символів).
  4) потрібен інтернет (події, афіші, розклади, ціни, новини, погода, «погугли») чи факт, у якому не впевнений → web —
     короткий пошуковий запит (з містом чи назвою з КАРТИ, якщо ясно), reply = null.
  Позначки t12 / n7 у reply не пиши. about, web, sources — лише для answer, інакше null.
- "split" — «розбий … на кроки», «з чого почати …» → targets [справа] (або []), items — 3–5 кроків із дієсловом у
  порядку виконання; є дедлайн — розклади дедлайни кроків рівномірно до нього, інакше null.
- "pause" — «не турбуй до 14», «тиша до вечора» (19:00), «відпустка до неділі» → until ISO (лише день → 23:59, без
  кінця → null). "resume" — «можна», «я повернувся», «знову нагадуй».
- "chat" — лише привітання, подяка, питання про самого бота (1–2 речення). Не описуй дій, яких не було («ось список»,
  «оновив»), і не відповідай порожнім «зрозумів»: або дія через свій intent, або відповідь, або clarify.
- "clarify" — кілька записів однаково підходять, і діалог не уточнює → targets — кандидати, reply «Яку саме?».
КАРТА ЗНАНЬ нижче — сфери, проєкти, теми й люди з ролями: за нею зрозумій, хто такий «Ігор», що таке «Атлас», «Атлас».
- kb — зміни структури (бот робить одразу, з ↩️): create {kind sphere|project|topic|idea|person, name, parent};
  rename {target, name}; move {target, parent}; merge {target, into}; archive {target} («X закрито»); link / unlink
  {person, target, role} («Денис — партнер у спільнотіСнеку»); alias {target, name} («X ще називаю Y»). Назви — з КАРТИ.
  link — лише люди (бот Lanora, проєкт, ідея — move або create project). Текст із бази, не справа: «(оце) видали …»
  → forget {text, target|null}; «перенеси це в Y» → move_entry {text, parent}.
  Лише kb — intent "edit"; без змін — null.
- Факт про людину («Ігор тепер веде SEO», «Марта в Атлас перевіряє кольори афіші», «Тарас — друг, теж у спільноті») →
  note з place = ця людина, new_note false, description — факт з її іменем; де вона й у якій ролі — ще й kb link, якщо
  такого звʼязку ще немає. Факт про проєкт без людини → place = проєкт. Одразу після «спитав, хто це — X» / «записав
  людину X» повідомлення про X — це опис X, а не chat. Продовження «так, допиши, що вона …» — про ту саму людину. «запиши це / його / туди і туди» — збери щойно сказане; кілька місць —
  кілька items. «перенеси це у Витрати» після запису бота — move_entry з тим текстом.
- new_people — імена людей з повідомлення в називному відмінку («сестрі Ніна» → "Ніна"), яких немає серед ЛЮДЕЙ
  КАРТИ (з «інакше:»); без власника, публічних осіб і організацій. Немає — null.
Посилання на записи:
- «та / ця / її / останню» → найсвіжіший запис із діалогу. Назва підходить кільком → той, що бот показував чи змінював
  останнім; не ясно — clarify. Уточнення одразу після створення чи «що змінити?» («на 21:00», «додай, що взяти ноут»)
  — edit того запису.
- «першу / другу / №3» і голі числа в короткій відповіді («9 і 7 готово») — номери з ОСТАННЬОГО списку бота («№2 → t5»).
- «була / сходив на …» — минула сьогодні подія, а не задача зі схожим словом.
- Після «нагадав про tN»: «зробив / є / вже» → complete tN; «через пів години / о 16 / ввечері (19:00) / пізніше
  (+1 год)» → edit tN set {remind_at} (лише remind_at!); «завтра» → remind_at завтра 09:00; «перенеси на завтра» →
  новий deadline (події — starts_at).
heard — для голосового: дослівна розшифровка; для тексту — null.`;
