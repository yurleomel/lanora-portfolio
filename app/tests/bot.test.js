// Smoke tests of the service wiring (app/bot.js) with a fake Telegram, a fake Gemini and an in-memory database:
// the main paths must reach the scripts and come back as the right messages and rows.
process.env.OWNER_ID = '111';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DateTime, Settings } = require('luxon');
const { open } = require('../db');
const { createBot } = require('../bot');

const OWNER = 111;
function at(iso) {
  const ms = DateTime.fromISO(iso, { zone: 'Europe/Kyiv' }).toMillis();
  Settings.now = () => ms;
  Date.now = () => ms;
}
const gem = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

function setup(replies = []) {
  const db = open(':memory:');
  const calls = [];
  let msgId = 100;
  const tg = {
    send: async (chat, text, markup) => { calls.push({ m: 'send', chat, text, markup }); return { message_id: ++msgId }; },
    edit: async (chat, id, text, markup) => { calls.push({ m: 'edit', chat, id, text, markup }); },
    answer: async (q, text) => { calls.push({ m: 'answer', q, text }); },
    typing: async () => { calls.push({ m: 'typing' }); },
    download: async () => Buffer.from('voice').toString('base64'),
  };
  const asked = [];
  const generate = async (model, body, key) => { asked.push({ model, key, body }); return replies.shift() || gem({ intent: 'chat', reply: 'Привіт!' }); };
  const changes = [];
  const bot = createBot({ db, tg, generate, keys: ['k1', 'k2', 'k3'], ownerId: OWNER, onKnowledge: () => changes.push(Date.now()) });
  return { db, bot, calls, asked, changes };
}
const msg = (text) => ({ update_id: 1, message: { message_id: 5, from: { id: OWNER }, chat: { id: OWNER }, text } });
const cb = (data) => ({ update_id: 2, callback_query: { id: 'q1', data, from: { id: OWNER }, message: { message_id: 9, chat: { id: OWNER } } } });
const buttons = (call) => (call.markup?.inline_keyboard || []).flat().map((b) => b.callback_data);

test('a text message goes through Gemini (dead key → next key), creates the task, buttons close and undo it', async () => {
  at('2026-10-20T10:00');
  const { db, bot, calls, asked } = setup([
    { error: { message: '402 - {"error":{"code":402,"message":"Your prepayment credits are depleted."}}' } },
    gem({ intent: 'create', items: [{ type: 'task', title: 'Купити молоко', reminder_type: 'none' }] }),
  ]);
  assert.equal(await bot.handleUpdate(msg('купити молоко')), 'new');
  assert.deepEqual(asked.map((a) => a.key), ['k1', 'k2']);
  assert.equal(db.kvGet('static').geminiKey, 1);
  const [task] = db.rows('tasks');
  assert.deepEqual([task.title, task.status, task.chat_id], ['Купити молоко', 'open', OWNER]);
  const conf = calls.find((c) => c.m === 'send');
  assert.match(conf.text, /Купити молоко/);
  // No «✅ Готово» under a new task: it was tapped by mistake.
  assert.deepEqual(buttons(conf), [`edit:${task.id}`, `del:${task.id}`]);
  assert.deepEqual(db.rows('dialog').map((d) => d.role), ['user', 'bot']);

  calls.length = 0;
  await bot.handleUpdate(cb(`done:${task.id}`));
  assert.equal(db.byId('tasks', task.id).status, 'done');
  const undo = db.rows('actions', [['kind', 'eq', 'undo']]).at(-1);
  assert.deepEqual(calls.map((c) => c.m), ['answer', 'edit']);
  assert.deepEqual(buttons(calls[1]), [`u:${undo.id}`]);
  await bot.handleUpdate(cb(`u:${undo.id}`));
  assert.equal(db.byId('tasks', task.id).status, 'open');
  // The next message starts with the working key.
  await bot.handleUpdate(msg('привіт'));
  assert.equal(asked.at(-1).key, 'k2');
});

test('/today, a card from a number button, a reminder and the morning digest', async () => {
  at('2026-10-20T09:00');
  const { db, bot, calls } = setup([gem({ intent: 'chat', reply: 'x' })]);
  const t = db.insert('tasks', { chat_id: OWNER, title: 'Есе', kind: 'task', deadline: '2026-10-20T23:59:00+03:00', rule: 'once', status: 'open', next_ts: Date.now() - 1000 });
  db.insert('tasks', { chat_id: OWNER, title: 'Тренування', kind: 'event', starts_at: '2026-10-20T20:00:00+03:00', rule: 'once', status: 'open' });
  await bot.handleUpdate(msg('📅 Сьогодні'));
  const view = calls.at(-1);
  assert.match(view.text, /Есе/);
  assert.ok(buttons(view).includes(`c:t${t.id}`));
  await bot.handleUpdate(cb(`c:t${t.id}`));
  assert.ok(buttons(calls.find((c) => c.m === 'send' && /Есе/.test(c.text) && buttons(c).includes(`snz:${t.id}:60`))));

  calls.length = 0;
  await bot.reminders();
  assert.match(calls[0].text, /⏰/);
  assert.deepEqual(buttons(calls[0]), [`done:${t.id}`, `later:${t.id}`]);
  assert.equal(db.byId('tasks', t.id).next_ts, null);

  calls.length = 0;
  await bot.digest();
  assert.match(calls[0].text, /Доброго ранку/);
});

test('knowledge base: a note is written at once and ↩️ takes it back; a merge and its undo; a question by place', async () => {
  at('2026-10-21T18:00');
  const none = { name: null, kind: null, target: null, parent: null, into: null, person: null, role: null };
  const { db, bot, calls, asked, changes } = setup([
    gem({ intent: 'create', items: [{ type: 'note', title: 'Кава', description: 'Каву зранку.', place: 'майстерня', new_note: false }] }),
    gem({ intent: 'edit', items: null, edits: null, kb: [{ ...none, op: 'merge', target: 'Матеріали', into: 'Майстерня' }] }),
    gem({ intent: 'answer', reply: null, about: ['Гурток'] }),
    gem({ reply: 'Про спільноту: замовлення.', targets: [], sources: ['Майстерня'] }),
    gem({ intent: 'edit', items: null, edits: null, kb: [{ ...none, op: 'create', name: 'Денис', kind: 'person' }, { ...none, op: 'link', target: 'Майстерня', person: 'Денис', role: 'партнер' }] }),
  ]);
  const ucu = db.insert('entities', { kind: 'sphere', type: 'сфера', name: 'Спільнота', aliases: 'Гурток', status: 'active' });
  const snack = db.insert('entities', { kind: 'project', type: 'бізнес', name: 'Майстерня', aliases: 'майстерня', parent_id: ucu.id, status: 'active' });
  const old = db.insert('entities', { kind: 'project', type: 'проєкт', name: 'Матеріали', parent_id: ucu.id, status: 'active' });
  const task = db.insert('tasks', { chat_id: OWNER, title: 'Замовлення', kind: 'task', rule: 'none', status: 'open', entity_id: old.id });

  await bot.handleUpdate(msg('для майстерні каву зранку'));
  const [entry] = db.rows('entries');
  assert.deepEqual([entry.entity_id, entry.text, entry.source], [snack.id, 'Каву зранку.', 'telegram']);
  const undo = db.rows('actions', [['kind', 'eq', 'undo']]).at(-1);
  assert.match(calls.at(-1).text, /^📝 Записав у <b>Спільнота › Майстерня<\/b>/);
  // A write to the knowledge base tells the service (the summaries follow it), and so does its undo.
  assert.equal(changes.length, 1);
  assert.deepEqual(buttons(calls.at(-1)), [`u:${undo.id}`]);
  await bot.handleUpdate(cb(`u:${undo.id}`));
  assert.equal(db.rows('entries').length, 0);
  assert.equal(changes.length, 2);

  await bot.handleUpdate(msg('обʼєднай матеріали з майстернею'));
  assert.deepEqual([db.byId('entities', old.id).status, db.byId('tasks', task.id).entity_id], ['archived', snack.id]);
  await bot.handleUpdate(cb(`u:${db.rows('actions', [['kind', 'eq', 'undo']]).at(-1).id}`));
  assert.deepEqual([db.byId('entities', old.id).status, db.byId('tasks', task.id).entity_id], ['active', old.id]);

  await bot.handleUpdate(msg('що там про спільноту?'));
  assert.match(asked.at(-1).body.systemInstruction.parts[0].text, /## Спільнота \[сфера\][\s\S]*Відкриті справи \(1\): t\d+ «Замовлення»/);
  // The answer names the task, so it gets its button.
  assert.equal(calls.at(-1).text, 'Про спільноту: замовлення.\n\n🗂 Спільнота › Майстерня\n\n1. Замовлення');

  // A person created and linked in one message: the link points to the new row.
  await bot.handleUpdate(msg('Денис — мій партнер в майстерні'));
  const vanya = db.rows('entities', [['name', 'eq', 'Денис']])[0];
  assert.deepEqual(db.rows('links').map((l) => [l.person_id, l.entity_id, l.role]), [[vanya.id, snack.id, 'партнер']]);
});

test('a fast reply the guards doubted is used when the strong model then fails, not «Gemini недоступний»', async () => {
  at('2026-10-20T10:00');
  const { db, bot, asked, calls } = setup([
    gem({ intent: 'create', items: [{ type: 'task', title: 'Палітра', reminder_type: 'none' }] }),
    { error: { message: 'The operation was aborted due to timeout' } },
    { error: { message: 'The operation was aborted due to timeout' } },
  ]);
  await bot.handleUpdate(msg('ідея: палітра в майстерня'));
  // The second model and its backup both time out.
  assert.deepEqual(asked.map((a) => a.model), ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite']);
  assert.equal(db.rows('tasks')[0]?.title, 'Палітра');
  assert.doesNotMatch(calls.at(-1).text, /недоступний/);
});

test('a question for the internet: the strong model with Google Search, the fast one when it fails', async () => {
  at('2026-10-24T16:10');
  const found = { candidates: [{ content: { parts: [{ text: 'Концерт 15.11 о 19:00.' }] }, groundingMetadata: { groundingChunks: [{ web: { uri: 'https://x.test', title: 'example.test' } }] } }] };
  const { bot, asked, calls } = setup([
    gem({ intent: 'answer', reply: null, about: null, web: 'осінній концерт органної музики' }),
    { error: { message: 'The operation was aborted due to timeout' } },
    found,
  ]);
  await bot.handleUpdate(msg('коли буде органний концерт?'));
  // The second model timed out: its backup searches.
  assert.deepEqual(asked.map((a) => a.model), ['gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.1-flash-lite']);
  assert.deepEqual([asked[1].body.tools, asked[2].body.tools], [[{ google_search: {} }], [{ google_search: {} }]]);
  assert.equal(calls.at(-1).text, 'Концерт 15.11 о 19:00.\n\n🔎 <a href="https://x.test">example.test</a>');
});

test('no search quota on any key (429): the question is answered without the internet, and says so', async () => {
  at('2026-10-24T16:10');
  const noSearch = { error: { message: '429 - {"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}' } };
  const { bot, asked, calls } = setup([
    gem({ intent: 'answer', reply: null, about: null, web: 'осінній концерт органної музики' }),
    noSearch, noSearch, noSearch, noSearch, noSearch, noSearch,
    { candidates: [{ content: { parts: [{ text: 'Точних дат не знаю — глянь на сайті опери.' }] } }] },
  ]);
  await bot.handleUpdate(msg('коли буде органний концерт?'));
  // Search: 3 keys × 2 models, then the plain question on the fast model, without tools.
  assert.equal(asked.length, 8);
  assert.deepEqual([asked.at(-1).model, asked.at(-1).body.tools], ['gemini-3.5-flash-lite', undefined]);
  assert.equal(calls.at(-1).text, '🌐 Пошук в інтернеті зараз недоступний — відповідаю з того, що знаю:\n\nТочних дат не знаю — глянь на сайті опери.');
});

test('summaries run in the background: big places once, then the profile; nothing changed — no Gemini call', async () => {
  at('2026-10-24T12:00');
  const { db, bot, asked } = setup([
    gem([{ id: 1, summary: 'Спільнота — зустрічі та творчі заняття.' }, { id: 2, summary: 'Майстерня — заняття, матеріали закуповують щотижня.' }]),
    gem([{ id: 0, summary: 'Організовує творчі заняття для місцевої спільноти.' }]),
  ]);
  db.insert('entities', { kind: 'sphere', type: 'сфера', name: 'Спільнота', status: 'active' });
  db.insert('entities', { kind: 'project', type: 'бізнес', name: 'Майстерня', parent_id: 1, status: 'active' });
  for (let i = 0; i < 40; i += 1) db.insert('entries', { entity_id: 2, text: `Замовлення ${i}: перевірити залишки паперу й фарб та замовити матеріали для суботнього майстер-класу.`, ts: Date.now() - i * 3600000, source: 'telegram' });
  assert.equal(await bot.summaries(), undefined);
  assert.deepEqual(asked.map((a) => a.model), ['gemini-3.5-flash-lite', 'gemini-3.5-flash-lite']);
  assert.deepEqual([db.byId('entities', 2).summary, db.kvGet('profile').text], ['Майстерня — заняття, матеріали закуповують щотижня.', 'Організовує творчі заняття для місцевої спільноти.']);
  assert.equal(await bot.summaries(), undefined);
  assert.equal(asked.length, 2);
  // A new entry and a failed call: «retry», so the service tries again later.
  db.insert('entries', { entity_id: 2, text: 'Підготувати ще одне замовлення', ts: Date.now(), source: 'telegram' });
  assert.equal(await bot.summaries(), 'retry');
});

test('a failure is reported to the owner with the step it happened at', () => {
  const { bot } = setup();
  bot.state.step = 'interpret.js';
  const a = bot.alert('Lanora · Telegram', new Error('boom'));
  assert.equal(a.chat_id, OWNER);
  assert.match(a.text, /interpret\.js[\s\S]*boom/);
});

test('every 10 minutes: a one-off event of a past day is closed as past; a series moves on', () => {
  at('2026-10-25T12:00');
  const { db, bot } = setup();
  const ev = (title, starts_at, repeat = null) => db.insert('tasks', { chat_id: OWNER, title, kind: 'event', starts_at, rule: 'once', status: 'open', repeat });
  ev('Пара', '2026-10-22T08:30:00+03:00');
  ev('Майстер-клас', '2026-10-25T10:00:00+02:00');
  ev('Репетиція', '2026-10-22T10:00:00+03:00', 'weekly:4');
  bot.rollSeries();
  assert.deepEqual(db.rows('tasks').map((t) => [t.title, t.status, t.starts_at]), [
    ['Пара', 'past', '2026-10-22T08:30:00+03:00'], ['Майстер-клас', 'open', '2026-10-25T10:00:00+02:00'], ['Репетиція', 'open', '2026-10-29T10:00:00+02:00'],
  ]);
});

test('a photo without a caption changes nothing by itself: what it adds to a task is a draft; dates stay', async () => {
  at('2026-10-24T16:33');
  const fc = gem({ intent: 'edit', edits: [{ target: 't1', set: { append_description: 'Квитки: зала 2, стенд 4', remind_at: '2026-10-24T16:34:00+03:00' } }], done: ['t2'] });
  const { db, bot, calls } = setup([fc]);
  const faust = db.insert('tasks', { chat_id: OWNER, title: 'Виставка ілюстрацій', kind: 'event', starts_at: '2026-10-24T17:00:00+03:00', rule: 'once', next_ts: Date.parse('2026-10-24T13:00:00Z'), status: 'open' });
  db.insert('tasks', { chat_id: OWNER, title: 'Каталог', kind: 'task', rule: 'none', status: 'open' });
  await bot.handleUpdate({ update_id: 3, message: { message_id: 6, from: { id: OWNER }, chat: { id: OWNER }, photo: [{ file_id: 'p1' }] } });
  assert.deepEqual(db.rows('tasks').map((t) => [t.status, t.description, t.next_ts]), [['open', null, faust.next_ts], ['open', null, null]]);
  const draft = calls.find((c) => c.m === 'send' && /Додати з фото/.test(c.text));
  assert.match(draft.text, /1\. ✏️ Виставка ілюстрацій — додати в опис: <i>Квитки: зала 2, стенд 4<\/i>/);
  const [ok] = buttons(draft);
  assert.equal(draft.markup.inline_keyboard[0][0].text, '✅ Додати');
  await bot.handleUpdate(cb(ok));
  const t = db.byId('tasks', faust.id);
  assert.deepEqual([t.description, t.next_ts], ['Квитки: зала 2, стенд 4', faust.next_ts]);
  // …and ↩️ takes it back.
  const undo = db.rows('actions', [['kind', 'eq', 'undo']]).at(-1);
  await bot.handleUpdate(cb(`u:${undo.id}`));
  assert.equal(db.byId('tasks', faust.id).description, null);
});

test('a message about starting a task leaves it open', async () => {
  at('2026-10-24T14:11');
  const { db, bot, calls } = setup([gem({ intent: 'complete', targets: ['t1'] })]);
  db.insert('tasks', { chat_id: OWNER, title: 'Сісти за хакатон каталог', kind: 'task', rule: 'none', status: 'open' });
  await bot.handleUpdate(msg('окей, починаю робити каталог'));
  assert.equal(db.byId('tasks', 1).status, 'open');
  assert.match(calls.find((c) => c.m === 'send').text, /Вперед! Напиши «готово», коли закінчиш/);
});
