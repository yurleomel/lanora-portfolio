// Renders day / week / all-tasks views and the digests (morning 9:00, check 17:00, evening 21:00, weekly).
// One line per item: time or deadline on the left, short title on the right; numbers match the buttons.
const r = $input.first().json;
// Steps of an open task are one line: «🪜 Підготувати доповідь · 0 з 6», placed by its nearest step; the button opens
// the task's card with the steps.
const allRows = rowsOf('Get open tasks');
const openIds = new Set(allRows.map((t) => t.id));
const isStep = (t) => t.parent_id && openIds.has(Number(t.parent_id));
const nearest = (a, b) => (parseWhen(a.deadline)?.toMillis() ?? Infinity) - (parseWhen(b.deadline)?.toMillis() ?? Infinity);
const bundles = allRows.filter((t) => allRows.some((s) => isStep(s) && Number(s.parent_id) === t.id)).map((parent) => {
  const steps = allRows.filter((s) => isStep(s) && Number(s.parent_id) === parent.id).sort(nearest);
  const done = rowsOf('Get done tasks').filter((s) => Number(s.parent_id) === parent.id).length;
  return { ...steps[0], id: parent.id, bundle: true, parent_id: null, repeat: null, priority: parent.priority,
    title: `🪜 ${parent.title} · ${done} з ${done + steps.length}` };
});
const rows = [...allRows.filter((t) => !isStep(t)), ...bundles];
const now = kyivNow();
const nowMs = now.toMillis();
const today = now.startOf('day');
const todayKey = dayKeyOf(now);
const tomorrow = logicalTomorrow(now);
const tomorrowKey = dayKeyOf(tomorrow);

const items = rows.map((t) => ({ t, p: placement(t) }));
const isOverdue = (t) => t.kind !== 'event' && t.deadline && parseWhen(t.deadline).toMillis() < nowMs;
const onDay = (key) => rows.map((t) => ({ t, p: placeOn(t, key) }))
  .filter((x) => x.p && !(isOverdue(x.t) && placement(x.t) && x.p.ms === placement(x.t).ms))
  .sort((a, b) => a.p.ms - b.p.ms);
const pastEvent = (x) => x.t.kind === 'event' && x.p && x.p.ms + 30 * 60000 < nowMs;
// Tasks go by importance, then by time; events stay in time order.
const byPrio = (a, b) => prio(b.t) - prio(a.t) || (a.p ? a.p.ms : 0) - (b.p ? b.p.ms : 0);
const overdue = () => items.filter((x) => isOverdue(x.t)).sort(byPrio);
// "Колись" (priority 1) undated tasks stay out of daily views: only in «Усі справи» and the weekly review. So do
// undated tasks of a project unless 🔴/🟠: they live in the project («що там по Атлас?», «📋 Усі»), and the day
// shows one line with how many.
const inProject = (t) => Boolean(t.entity_id) && prio(t) < 4;
const undated = (all = false) => rows.filter((t) => isUndated(t) && (all || (prio(t) > 1 && !inProject(t))))
  .sort((a, b) => prio(b) - prio(a) || a.id - b.id).map((t) => ({ t, p: null }));
const places = new Map(vaultNotes().map((n) => [n.id, n]));
const placeName = (t) => (places.get(Number(t.entity_id)) || {}).name || '';
function projectsLine() {
  const count = new Map();
  for (const t of rows.filter((x) => isUndated(x) && prio(x) > 1 && inProject(x) && placeName(x))) count.set(placeName(t), (count.get(placeName(t)) || 0) + 1);
  return count.size ? `<i>Без дати в проєктах: ${[...count].map(([n, k]) => `${esc(n)} ${k}`).join(' · ')} — у «📋 Усі»</i>` : '';
}
// The next 3 days after today, each task once (a daily series shows its nearest day): what is coming «на днях».
function soon() {
  const seen = new Set();
  const list = [];
  for (let i = 1; i <= 3; i += 1) {
    for (const x of onDay(dayKeyOf(today.plus({ days: i })))) {
      const key = `${x.t.bundle ? 's' : 't'}${x.t.id}`;
      if (!seen.has(key) && seen.add(key)) list.push(x);
    }
  }
  return list;
}
const nav = (...b) => b.map(([t, d]) => navBtn(t, d));

const refs = [];
function line(x, mode = 'time') {
  const { t, p } = x;
  refs.push(`t${t.id}`);
  const n = refs.length;
  const title = `${pmark(t)}${esc(t.title)}${t.repeat ? ' 🔁' : ''}${n > MAX_BUTTONS ? ` /t${t.id}` : ''}`;
  if (mode === 'overdue') {
    const d = parseWhen(t.deadline);
    const since = dayKeyOf(d) === todayKey ? `було до ${fmtTime(d)}` : `з ${relDay(d, now)}`;
    return `${n}. ${title} · <i>${since}</i>`;
  }
  if (mode === 'day' && p) {
    const at = DateTime.fromMillis(p.ms, { zone: TZ });
    const time = p.section === 'events' ? ` о ${fmtTime(at)}` : isDateOnly(at) ? '' : ` до ${fmtTime(at)}`;
    return `${n}. ${title} · <i>${relDay(at, now)}${time}</i>`;
  }
  const label = p ? (p.section === 'events' ? p.label.split('–')[0] : p.label) : '';
  const body = `${label ? `${label} ` : ''}${title}`;
  return `${n}. ${pastEvent(x) ? `<s>${body}</s>` : body}`;
}
const section = (name, list, mode) => (list.length ? `<b>${name}</b>\n${list.map((x) => line(x, mode)).join('\n')}` : '');
const join = (...blocks) => blocks.filter(Boolean).join('\n\n');

function dayBlocks(key, isToday) {
  const list = onDay(key);
  return [
    isToday ? section('Прострочено', overdue(), 'overdue') : '',
    section('За часом', list.filter((x) => x.p.section === 'events')),
    section(isToday ? 'До кінця дня' : 'Дедлайни', list.filter((x) => x.p.section === 'tasks').sort(byPrio)),
    isToday ? section('Найближчі дні', soon(), 'day') : '',
    isToday ? section('Коли буде час', undated()) : '',
    isToday ? projectsLine() : '',
  ];
}

// "о 10:00 Пара з дизайну, далі Студія, Завдання Ігорю" — the next day in one sentence.
function dayInOneLine(key) {
  const list = onDay(key);
  if (!list.length) return '';
  const timed = list.filter((x) => x.p.section === 'events' || !isDateOnly(DateTime.fromMillis(x.p.ms, { zone: TZ })));
  const rest = list.filter((x) => !timed.includes(x));
  const parts = [];
  if (timed.length) parts.push(timed.slice(0, 3).map((x) => `${x.p.section === 'events' ? 'о' : ''} ${x.p.label.split('–')[0]} ${esc(x.t.title)}`.trim()).join(', '));
  const names = rest.slice(0, 4).map((x) => esc(x.t.title));
  if (names.length) parts.push(`${timed.length ? 'далі ' : ''}${names.join(', ')}`);
  const more = list.length - Math.min(timed.length, 3) - names.length;
  return `${parts.join(', ')}${more > 0 ? ` і ще ${more}` : ''}`;
}

let text;
let navs;
let skip = false;

if (r.view === 'morning' && now.weekday >= 6) {
  // A calm weekend morning: what has a time, what can wait, today's deadlines; leftovers only as a count.
  const list = onDay(todayKey);
  const late = overdue().length;
  const blocks = [
    section('За часом', list.filter((x) => x.p.section === 'events')),
    section('Коли буде час', undated()),
    section('До кінця дня', list.filter((x) => x.p.section === 'tasks').sort(byPrio)),
    section('Найближчі дні', soon(), 'day'),
    projectsLine(),
  ];
  text = join(`☀️ <b>Доброго ранку!</b> ${longDay(now)}`, blocks.some(Boolean) ? '' : 'Вільний день 🌿', ...blocks,
    late ? `<i>Ще висить з тижня: ${late} — у «📋 Усі»</i>` : '');
  navs = nav(['📋 Усі', 'v:t'], ['Завтра ▶', `v:d:${tomorrowKey}`]);
} else if (r.view === 'morning') {
  const blocks = dayBlocks(todayKey, true);
  const plan = blocks.slice(0, 3).filter(Boolean).length ? '' : 'Сьогодні нічого не заплановано 🎉';
  text = join(`☀️ <b>Доброго ранку!</b> ${longDay(now)}`, plan, ...blocks);
  navs = nav(['📋 Усі', 'v:t'], ['Завтра ▶', `v:d:${tomorrowKey}`]);
} else if (r.view === 'nudge') {
  const left = [...overdue(), ...onDay(todayKey).filter((x) => x.p.section === 'tasks').sort(byPrio)];
  if (!left.length) {
    skip = true;
  } else {
    text = `До кінця дня лишилось ${left.length}:\n${left.map((x) => line(x, isOverdue(x.t) ? 'overdue' : 'time')).join('\n')}`;
    navs = nav(['📅 Все на завтра', 'mv:all:tmr']);
  }
} else if (r.view === 'evening') {
  const done = rowsOf('Get done tasks').filter((t) => t.updatedAt && dayKeyOf(DateTime.fromISO(t.updatedAt).setZone(TZ)) === todayKey).length;
  const left = [...overdue(), ...onDay(todayKey).filter((x) => x.p.section === 'tasks').sort(byPrio)];
  const head = done ? `🌙 Добрий вечір! Сьогодні закрив ${done} ${plural(done, 'справу', 'справи', 'справ')} 💪` : '🌙 Добрий вечір!';
  const leftBlock = left.length
    ? `Ще не зроблено:\n${left.map((x) => line(x, isOverdue(x.t) ? 'overdue' : 'time')).join('\n')}\nПеренести на завтра?`
    : (done ? 'На сьогодні все закрито 🎉' : 'Спокійний день.');
  const tmr = dayInOneLine(tomorrowKey);
  text = join(head, leftBlock, tmr ? `Завтра: ${tmr}.` : 'Завтра поки вільно.');
  navs = left.length ? nav(['📅 Так, на завтра', 'mv:all:tmr'], ['Завтра ▶', `v:d:${tomorrowKey}`]) : nav(['Завтра ▶', `v:d:${tomorrowKey}`]);
} else if (r.view === 'weekly') {
  const weekStart = today.minus({ days: today.weekday - 1 });
  const nextMon = weekStart.plus({ days: 7 });
  const doneWeek = rowsOf('Get done tasks').filter((t) => t.updatedAt && DateTime.fromISO(t.updatedAt).toMillis() >= weekStart.toMillis());
  const late = overdue();
  const head = `🗓 <b>Добрий вечір! Підсумок тижня</b> ${fmtDay(weekStart)} – ${fmtDay(weekStart.plus({ days: 6 }))}`;
  const doneLine = doneWeek.length
    ? `Закрив ${doneWeek.length} ${plural(doneWeek.length, 'справу', 'справи', 'справ')} 💪: ${doneWeek.slice(0, 6).map((t) => esc(t.title)).join(', ')}${doneWeek.length > 6 ? ` і ще ${doneWeek.length - 6}` : ''}.`
    : 'Цього тижня нічого не позначено виконаним.';
  const lateBlock = section('Ще не зроблено', late, 'overdue'); // rendered first so numbers follow reading order
  const someday = rows.filter((t) => isUndated(t) && prio(t) === 1);
  const somedayLine = someday.length ? `<i>⚪ Колись (${someday.length}): ${someday.slice(0, 6).map((t) => esc(t.title)).join(', ')}${someday.length > 6 ? ` і ще ${someday.length - 6}` : ''}</i>` : '';
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = nextMon.plus({ days: i });
    const list = onDay(dayKeyOf(d));
    if (list.length) days.push(`<b>${fmtDay(d)}</b>\n${list.map((x) => line(x)).join('\n')}`);
  }
  text = join(head, doneLine, lateBlock, somedayLine,
    `<b>Наступний тиждень</b>\n${days.length ? days.join('\n\n') : 'Поки нічого не заплановано.'}`);
  navs = late.length
    ? nav(['📅 Прострочене на завтра', 'mv:all:tmr'], ['🗓 Наступний тиждень', `v:w:${dayKeyOf(nextMon)}`])
    : nav(['🗓 Наступний тиждень', `v:w:${dayKeyOf(nextMon)}`], ['📋 Усі', 'v:t']);
} else if (r.view === 'context') {
  // "я йду в місто" / "що купити в АТБ" / "що треба від Ігоря".
  const q = String(r.search || '').trim();
  const person = /^@/.test(q) || rows.some((t) => contextTags(t).some((x) => x.startsWith('@') && sameWord(x, q)));
  const head = `${person ? '👤' : '📍'} <b>${esc(q.replace(/^@/, '').replace(/^./, (c) => c.toUpperCase()))}</b>`;
  const found = matchContext(rows, q).sort((a, b) => (parseWhen(a.deadline)?.toMillis() ?? Infinity) - (parseWhen(b.deadline)?.toMillis() ?? Infinity));
  const lines = found.map((t) => {
    refs.push(`t${t.id}`);
    const other = contextTags(t).filter((x) => !sameWord(x, q)).map((x) => esc(x.replace(/^@/, '')));
    const hint = t.deadline ? whenShort(t, now) : other.join(', ');
    return `${refs.length}. ${esc(t.title)}${hint ? ` · <i>${hint}</i>` : ''}${refs.length > MAX_BUTTONS ? ` /t${t.id}` : ''}`;
  });
  text = found.length ? `${head} — ${found.length}:\n${lines.join('\n')}` : `${head}: нічого не знайшов.`;
  navs = nav(['📋 Усі', 'v:t']);
} else if (r.view === 'tasks') {
  const weekEnd = dayKeyOf(today.plus({ days: 7 }));
  const g = { late: [], today: [], week: [], later: [] };
  for (const x of items) {
    if (isOverdue(x.t)) g.late.push(x);
    else if (!x.p || pastEvent(x)) continue;
    else if (x.p.day === todayKey) g.today.push(x);
    else if (x.p.day <= weekEnd) g.week.push(x);
    else g.later.push(x);
  }
  for (const l of [g.today, g.week, g.later]) l.sort((a, b) => a.p.ms - b.p.ms);
  g.late.sort(byPrio);
  const blocks = [section('Прострочено', g.late, 'overdue'), section('Сьогодні', g.today), section('Цього тижня', g.week, 'day'),
    section('Пізніше', g.later, 'day'), section('Без дати', undated(true).filter((x) => !placeName(x.t))),
    ...[...new Set(undated(true).map((x) => placeName(x.t)).filter(Boolean))].map((n) => section(`Без дати · ${esc(n)}`, undated(true).filter((x) => placeName(x.t) === n)))];
  text = blocks.some(Boolean) ? join(`📋 <b>Усі справи</b> · ${rows.length}`, ...blocks) : '🎉 Відкритих справ немає. Напиши, що треба зробити.';
  navs = nav(['📅 Сьогодні', `v:d:${todayKey}`], ['🗓 Тиждень', `v:w:${todayKey}`], ['🔄 Оновити', 'v:t']);
} else if (r.view === 'week') {
  const start = DateTime.fromISO(r.date, { zone: TZ });
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const d = start.plus({ days: i });
    const key = dayKeyOf(d);
    const list = onDay(key).filter((x) => !(pastEvent(x) && key !== todayKey));
    const rel = relDay(d, now);
    if (list.length) days.push(`<b>${fmtDay(d)}${rel !== fmtDay(d) ? ` · ${rel}` : ''}</b>\n${list.map((x) => line(x)).join('\n')}`);
  }
  text = join(`🗓 <b>${fmtDay(start)} – ${fmtDay(start.plus({ days: 6 }))}</b>`, days.length ? days.join('\n\n') : 'Нічого не заплановано.');
  navs = nav(['◀ Тиждень', `v:w:${dayKeyOf(start.minus({ days: 7 }))}`], ['📅 Сьогодні', `v:d:${todayKey}`], ['Тиждень ▶', `v:w:${dayKeyOf(start.plus({ days: 7 }))}`]);
} else {
  const d = DateTime.fromISO(r.date, { zone: TZ });
  const key = dayKeyOf(d);
  const isToday = key === todayKey;
  const rel = relDay(d, now);
  const blocks = dayBlocks(key, isToday);
  text = join(`📅 <b>${longDay(d)}</b>${rel !== fmtDay(d) ? ` · ${rel}` : ''}`, blocks.some(Boolean) ? '' : 'Нічого не заплановано.', ...blocks);
  navs = nav([`◀ ${fmtDay(d.minus({ days: 1 }))}`, `v:d:${dayKeyOf(d.minus({ days: 1 }))}`], ['🗓 Тиждень', `v:w:${key}`],
    [`${fmtDay(d.plus({ days: 1 }))} ▶`, `v:d:${dayKeyOf(d.plus({ days: 1 }))}`]);
}

if (skip) return [];
const viewName = { day: `день ${r.date}`, week: `тиждень від ${r.date}`, tasks: 'усі справи', context: `справи для «${r.search || ''}»`, morning: 'ранковий план', nudge: 'що лишилось на сьогодні', evening: 'підсумок дня', weekly: 'огляд тижня' }[r.view] || r.view;
return [{
  json: {
    chat_id: r.chat_id, message_id: r.message_id || null, query_id: r.query_id || null, mode: r.mode || 'send',
    text: clip((r.prefix || '') + text, 3900),
    btns: numberButtons(refs),
    nav: navs,
    tip: r.view === 'morning' && Boolean(r.digest) && refs.length >= 2,
    log_role: 'bot', log_text: listLog(viewName, refs, (ref) => (rows.find((t) => `t${t.id}` === ref) || {}).title || ''), log_ids: refs.join(','),
  },
}];
