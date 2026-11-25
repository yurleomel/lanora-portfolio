// Runs the Code-node scripts in a fake n8n context: JS_DIR=... LUXON=... node --test logic.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const jsDir = process.env.JS_DIR;
const { DateTime, Settings } = require(process.env.LUXON);
const OWNER = 111;
const common = fs.readFileSync(path.join(jsDir, 'common.js'), 'utf8');

function at(iso) {
  const ms = DateTime.fromISO(iso, { zone: 'Europe/Kyiv' }).toMillis();
  Settings.now = () => ms;
  Date.now = () => ms;
  return ms;
}

function items(v) {
  return (Array.isArray(v) ? v : [v]).map((json) => ({ json }));
}

// Workflow static data (the working Gemini key) lives across runs, as in n8n; tests that rely on it reset it.
const STATIC = {};
function run(file, input, nodes = {}, runIndex = 0) {
  const src = (common + '\n' + fs.readFileSync(path.join(jsDir, file), 'utf8')).replace('__OWNER_ID__', OWNER);
  const inp = items(input);
  const $input = { first: () => inp[0], all: () => inp };
  const $ = (name) => {
    if (!(name in nodes)) throw new Error(`unexecuted ${name}`);
    const arr = items(nodes[name]);
    return { first: () => arr[0], all: () => arr };
  };
  return new Function('DateTime', '$input', '$', '$getWorkflowStaticData', '$runIndex', src)(DateTime, $input, $, () => STATIC, runIndex).map((i) => i.json);
}

function H() {
  return new Function('DateTime', '$', `${common.replace('__OWNER_ID__', OWNER)}; return { buildSchedule, applyPatch, diffText, parseDayArg, when, snoozeTo, whenLine };`)(DateTime, () => { throw new Error('no'); });
}

const kyiv = (ms) => DateTime.fromMillis(ms, { zone: 'Europe/Kyiv' }).toFormat('yyyy-LL-dd HH:mm');
const gem = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
const ESSAY = { id: 2, chat_id: 5, title: 'Есе про музику', kind: 'task', deadline: '2026-10-20T08:00:00+03:00', rule: 'once', next_ts: null, status: 'open' };
const APPLICATION = { id: 6, chat_id: 5, title: 'Заявка на стажування', kind: 'task', deadline: '2026-10-20T23:59:00+03:00', rule: 'once', status: 'open' };
const MILK = { id: 11, chat_id: 5, title: 'Купити молоко', kind: 'task', rule: 'none', status: 'open' };
const MEETING = { id: 5, chat_id: 5, title: 'Зустріч команди', kind: 'event', starts_at: '2026-10-20T18:30:00+03:00', ends_at: '2026-10-20T19:20:00+03:00', rule: 'once', status: 'open' };
const CLASS = { id: 20, chat_id: 5, title: 'Пара з дизайну', kind: 'event', starts_at: '2026-10-22T10:00:00+03:00', ends_at: '2026-10-22T11:30:00+03:00', rule: 'once', next_ts: 0, status: 'open', repeat: 'weekly:2,4' };
const INTERNET = { id: 21, chat_id: 5, title: 'Оплатити інтернет', kind: 'task', deadline: '2026-11-05T23:59:00+02:00', rule: 'once', status: 'open', repeat: 'monthly:5' };
const CTX = { 'Get open tasks': [ESSAY, APPLICATION], 'Get notes ctx': [], 'Get dialog': [] };

test('buildSchedule: date-only deadlines get no own reminder (digests cover them); timed 2h, events 1h before', () => {
  const { buildSchedule } = H();
  const now = at('2026-10-20T10:13');
  for (const d of ['2026-10-20T23:59:00+03:00', '2026-10-21T23:59:00+03:00']) {
    const s = buildSchedule({ type: 'task', deadline: d, reminder_type: 'once' }, now);
    assert.deepEqual([s.rule, s.next_ts, s.deadline], ['none', null, d]);
  }
  assert.equal(kyiv(buildSchedule({ type: 'task', deadline: '2026-10-21T23:59:00+03:00', reminder_type: 'once', remind_at: '2026-10-21T12:00:00+03:00' }, now).next_ts), '2026-10-21 12:00');
  assert.equal(kyiv(buildSchedule({ type: 'task', deadline: '2026-10-20T15:00:00+03:00' }, now).next_ts), '2026-10-20 13:00');
  const ev = buildSchedule({ type: 'event', starts_at: '2026-10-20T20:00:00+03:00' }, now);
  assert.deepEqual([ev.kind, ev.rule, kyiv(ev.next_ts)], ['event', 'once', '2026-10-20 19:00']);
  assert.equal(buildSchedule({ type: 'event', starts_at: '2026-10-20T09:00:00+03:00' }, now).next_ts, null);
  assert.equal(buildSchedule({ type: 'task', title: 'x' }, now).rule, 'none');
});

test('recurring: week view shows every occurrence; roll_series moves past events', () => {
  at('2026-10-20T08:00');
  const w = run('render_view.js', { chat_id: 5, view: 'week', date: '2026-10-20', mode: 'send' }, { ...CTX, 'Get open tasks': [{ ...CLASS, starts_at: '2026-10-20T10:00:00+03:00', ends_at: '2026-10-20T11:30:00+03:00' }] })[0].text;
  assert.equal((w.match(/Пара з дизайну 🔁/g) || []).length, 2);
  assert.match(w, /вт 20\.10[\s\S]*\d\. 10:00 Пара з дизайну 🔁[\s\S]*чт 22\.10[\s\S]*\d\. 10:00 Пара з дизайну 🔁/);
  at('2026-10-22T12:00');
  const rolled = run('roll_series.js', [CLASS, { ...CLASS, id: 22, starts_at: '2026-10-29T10:00:00+02:00', ends_at: '2026-10-29T11:30:00+02:00' }, INTERNET]);
  assert.deepEqual(rolled.map((o) => [o.id, o.row.starts_at, kyiv(o.row.next_ts)]), [[20, '2026-10-27T10:00:00+02:00', '2026-10-27 09:00']]);
  // Mark yesterday's one-off event as past and keep today's open.
  const once = (id, s) => ({ ...MEETING, id, starts_at: s, ends_at: null });
  const past = run('roll_series.js', [once(28, '2026-10-21T08:30:00+03:00'), once(29, '2026-10-22T08:30:00+03:00')]);
  assert.deepEqual(past.map((o) => [o.id, o.row.status, o.row.next_ts, o.row.title]), [[28, 'past', null, 'Зустріч команди']]);
  const btn = run('apply_action.js', { ...past[0].row, id: 28 }, { Context: { query_id: 'q', chat_id: 5, message_id: 9, action: 'done' } })[0];
  assert.equal(btn.toast, '🕓 Вже минуло');
});

test('applyPatch counts moves to a later date; a lone remind_at only moves the next ping', () => {
  const { applyPatch, diffText } = H();
  const now = at('2026-10-20T16:00');
  assert.equal(applyPatch(ESSAY, { deadline: '2026-10-21T08:00:00+03:00' }, [], now).moves, 1);
  assert.equal(applyPatch({ ...ESSAY, moves: 2 }, { deadline: '2026-10-22T08:00:00+03:00' }, [], now).moves, 3);
  assert.equal(applyPatch({ ...ESSAY, moves: 2 }, { deadline: '2026-10-20T07:00:00+03:00' }, [], now).moves, 2);
  assert.equal(applyPatch({ ...ESSAY, moves: 2 }, { title: 'Есе' }, [], now).moves, 2);
  const kept = applyPatch({ ...ESSAY, parent_id: 4, context: 'універ', nudged_ts: 5 }, { title: 'Есе' }, [], now);
  assert.deepEqual([kept.parent_id, kept.context, kept.nudged_ts], [4, 'універ', 5]);
  const snz = applyPatch(APPLICATION, { remind_at: '2026-10-20T16:30:00+03:00' }, [], now);
  assert.deepEqual([snz.deadline, snz.rule, kyiv(snz.next_ts), snz.moves], [APPLICATION.deadline, 'once', '2026-10-20 16:30', 0]);
  assert.deepEqual(diffText(APPLICATION, snz, now), ['нагадаю сьогодні 16:30']);
  const daily = { ...MILK, rule: 'daily_until_done', remind_time: '09:00', next_ts: at('2026-10-21T09:00') };
  at('2026-10-20T16:00');
  const dsnz = applyPatch(daily, { remind_at: '2026-10-20T17:00:00+03:00' }, [], now);
  assert.deepEqual([dsnz.rule, dsnz.remind_time, kyiv(dsnz.next_ts)], ['daily_until_done', '09:00', '2026-10-20 17:00']);
  assert.deepEqual(diffText(daily, dsnz, now), ['нагадаю сьогодні 17:00']);
  const mv = run('plan_move.js', {}, { ...CTX, Context: { chat_id: 5, query_id: 'q' } }).filter((o) => o.route === 'task_update');
  assert.deepEqual(mv.map((o) => o.task.moves), [1, 1]);
});

test('a short reply refers to the record the bot just showed', () => {
  at('2026-10-22T00:42');
  const brochure = { id: 22, chat_id: 5, title: 'Перевірити макет буклета', kind: 'task', deadline: '2026-10-21T23:59:00+03:00', rule: 'none', status: 'open' };
  const dialog = [
    { id: 1, role: 'bot', text: 'змінив t6 «Заявка на стажування»: дедлайн → пт 23.10 до 12:00', item_ids: 't6', ts: 1 },
    { id: 2, role: 'bot', text: 'показав справи для «Атлас»: №1 → t22 «Перевірити макет буклета»', item_ids: 't22', ts: 2 },
  ];
  const ctx = (text) => ({ ...CTX, 'Get open tasks': [APPLICATION, brochure, MILK], 'Get dialog': dialog, Context: { chat_id: 5, text } });
  const set = { deadline: '2026-10-22T23:59:00+03:00' };
  const ids = (text, p) => run('interpret.js', gem(p), ctx(text)).filter((o) => o.route === 'task_update').map((o) => o.id);
  assert.deepEqual(ids('перенеси на сьогодні', { intent: 'edit', edits: [{ target: 't6', set }] }), [22]);
  assert.deepEqual(ids('готово', { intent: 'complete', targets: ['t6'] }), [22]);
  // A short message that names its own task, or a longer one, keeps the model's target.
  assert.deepEqual(ids('стажування на сьогодні', { intent: 'edit', edits: [{ target: 't6', set }] }), [6]);
  assert.deepEqual(ids('ще потрібно купити молоко до вечірньої прогулянки', { intent: 'edit', edits: [{ target: 't11', set }] }), [11]);
});
