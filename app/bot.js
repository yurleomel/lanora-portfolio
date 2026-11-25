// The bot's wiring — what the n8n workflows did between the scripts in bot/js: context lookups, the branch for
// each kind of input, the handler for each route, the digests, the reminders and the recurring series.
const { runScript } = require('./runtime');
const { TABLES } = require('./db');
const { numbered, KB } = require('./telegram');

const GEMINI_FAST = 'gemini-3.5-flash-lite';
const DIALOG_KEEP_MS = 48 * 3600 * 1000;
const MODEL_REST_MS = 15 * 60 * 1000;
// The second model is often overloaded (503) on the free keys: when it fails or rests, its call goes to this one.
const BACKUP = { 'gemini-3.5-flash': 'gemini-3.1-flash-lite' };
// Routes are handled in this order. The owner's own log row goes first; the rest follow the order n8n ran the
// branches in (top to bottom on its canvas): Obsidian writes before views, «Хто це?» late, lists last.
const ORDER = ['log', 'create_task', 'create_note', 'task_update', 'note_update', 'task_status', 'note_status', 'action_used',
  'kb_write', 'kb_restore', 'summary', 'draft', 'dupe', 'conflict', 'pause', 'say', 'answer', 'view', 'research', 'web', 'person_ask', 'notes', 'clarify'];

const full = (table, row) => Object.fromEntries(TABLES[table].map((c) => [c, row && row[c] !== undefined ? row[c] : null]));

// onKnowledge — called after every write to the knowledge base (the service refreshes the summaries a bit later).
function createBot({ db, tg, generate, keys, ownerId, onKnowledge = () => {} }) {
  const own = Number(ownerId);
  // geminiKey() in common.js goes round this many keys.
  globalThis.GEMINI_KEY_COUNT = keys.length || 3;
  const staticData = db.kvGet('static', {});
  const state = { step: '' };
  const run = (file, input, nodes, runIndex = 0) => {
    state.step = file;
    return runScript(file, input, nodes, staticData, runIndex);
  };
  const saveStatic = () => db.kvSet('static', staticData);

  const lookups = () => ({
    'Get open tasks': db.rows('tasks', [['status', 'eq', 'open'], ['chat_id', 'eq', own]]),
    'Get notes ctx': db.rows('notes', [['status', 'eq', 'active'], ['chat_id', 'eq', own]]),
    'Get dialog': db.rows('dialog', [['chat_id', 'eq', own]]),
    'Get pause': db.rows('actions', [['kind', 'eq', 'pause'], ['status', 'eq', 'new']]),
    'Get person asks': db.rows('actions', [['kind', 'eq', 'person']]),
    Knowledge: { entities: db.rows('entities'), entries: db.rows('entries'), links: db.rows('links') },
  });

  function logTurn(items) {
    for (const i of [].concat(items || [])) {
      if (!i || !i.log_text) continue;
      db.insert('dialog', { chat_id: i.chat_id, role: i.log_role || 'bot', text: i.log_text, item_ids: i.log_ids || '', ts: Date.now() });
    }
  }
  const action = (i, over = {}) => db.insert('actions', {
    chat_id: i.chat_id, kind: 'undo', text: i.text || '', single: i.single ?? null, ops: i.ops || '[]',
    user_text: i.user_text || '', status: 'new', ts: Date.now(), ...over,
  });
  const send = (chatId, text, markup) => {
    state.step = 'Telegram sendMessage';
    return tg.send(chatId, text, markup);
  };

  // A model that timed out or was overloaded (5xx) rests for a while: its turn goes straight to the other model
  // (the callers' fallback) instead of another 20–30 s of waiting. When every model used is resting, all are tried.
  const resting = {};
  const seen = new Set();
  const isResting = (m) => resting[m] > Date.now();
  async function gemini(model, body, key) {
    state.step = `Gemini ${model}`;
    if (isResting(model) && BACKUP[model]) return gemini(BACKUP[model], body, key);
    if (isResting(model) && [...seen].some((m) => m !== model && !isResting(m))) {
      return { error: { message: `skipped: ${model} rests after a timeout or an overload` } };
    }
    seen.add(model);
    const res = await generate(model, body, keys[key]);
    if (res.error && /aborted|timeout|^5\d\d\b/i.test(String(res.error.message || ''))) {
      resting[model] = Date.now() + MODEL_REST_MS;
      console.log(`gemini ${model} rests for ${MODEL_REST_MS / 60000} min`);
      if (BACKUP[model]) return gemini(BACKUP[model], body, key);
    } else if (!res.error) delete resting[model];
    return res;
  }

  // ---- views and digests ----
  async function renderView(input, nodes) {
    // Done steps count in «🪜 … · 2 з 6».
    let v = run('render_view.js', input, { 'Get done tasks': db.rows('tasks', [['status', 'eq', 'done'], ['chat_id', 'eq', own], ['parent_id', 'notEmpty']]), ...nodes })[0];
    if (!v) return;
    logTurn(v);
    if (v.tip) {
      const tr = run('tip_request.js', v, nodes)[0];
      const res = await gemini(GEMINI_FAST, tr.body, tr.key);
      v = run('add_tip.js', res, { ...nodes, 'Render view': v, 'Tip request': tr })[0];
    }
    if (v.mode === 'edit') {
      await tg.edit(v.chat_id, v.message_id, v.text, numbered(v.btns, v.nav));
      await tg.answer(v.query_id, '');
    } else {
      await send(v.chat_id, v.text, numbered(v.btns, v.nav));
    }
    // After the plan is out: one question about a stuck task, or an overdue critical one at 17:00.
    for (const s of run('stale_check.js', null, nodes)) {
      logTurn(s);
      await send(s.chat_id, s.text, s.kb === 'hot' ? KB.hot(s.id) : KB.stale(s.id));
      db.update('tasks', s.id, { nudged_ts: s.nudged_ts });
    }
  }

  async function formatNotes(input, nodes) {
    const f = run('format_notes.js', input, nodes)[0];
    logTurn(f);
    await send(f.chat_id, f.text, numbered(f.btns, []));
  }

  // ---- knowledge base writes: ops from vaultPlan / kbOps / personPlan, each with a snapshot for ↩️ ----
  // A snapshot is {kb, t: table, id, before} — before null: the row was created (undo deletes it); `deleted`: the row
  // was removed (undo puts it back); otherwise the changed fields' old values.
  function kbWrite(ops) {
    const snaps = [];
    const refs = {};
    const id = (direct, ref) => direct ?? refs[ref] ?? null;
    const change = (table, rowId, set, title) => {
      const before = db.byId(table, rowId);
      if (!before) return;
      snaps.push({ kb: true, t: table, id: rowId, before: Object.fromEntries(Object.keys(set).map((k) => [k, before[k] ?? null])), title: title || before.name || before.title || before.text });
      db.update(table, rowId, set);
    };
    for (const op of ops || []) {
      if (op.op === 'create') {
        const row = db.insert('entities', { kind: op.kind, type: op.type, name: op.name, aliases: op.aliases || '', parent_id: id(op.parent_id, op.parent_ref), description: op.description || '', status: 'active' });
        refs[op.ref] = row.id;
        snaps.push({ kb: true, t: 'entities', id: row.id, before: null, title: row.name });
      } else if (op.op === 'entry') {
        const row = db.insert('entries', { entity_id: id(op.entity_id, op.entity_ref), text: op.text, ts: Date.now(), source: 'telegram' });
        snaps.push({ kb: true, t: 'entries', id: row.id, before: null, title: String(op.text).slice(0, 60) });
      } else if (op.op === 'update') {
        change('entities', op.id, op.set);
      } else if (op.op === 'entry_move') {
        change('entries', op.id, { entity_id: op.entity_id });
      } else if (op.op === 'drop_entry') {
        const row = db.byId('entries', op.id);
        if (row) snaps.push({ kb: true, t: 'entries', id: row.id, before: row, deleted: true, title: String(row.text).slice(0, 60) });
        db.removeById('entries', op.id);
      } else if (op.op === 'merge') {
        // Everything of A moves to B; A is archived.
        for (const e of db.rows('entities', [['parent_id', 'eq', op.id]])) change('entities', e.id, { parent_id: op.into });
        for (const x of db.rows('entries', [['entity_id', 'eq', op.id]])) change('entries', x.id, { entity_id: op.into }, x.text);
        for (const t of db.rows('tasks', [['entity_id', 'eq', op.id]])) change('tasks', t.id, { entity_id: op.into });
        for (const l of db.rows('links', [['entity_id', 'eq', op.id]])) change('links', l.id, { entity_id: op.into }, '');
        change('entities', op.id, { status: 'archived' });
      } else if (op.op === 'link') {
        const person = id(op.person_id, op.person_ref);
        const entity = id(op.entity_id, op.entity_ref);
        const has = db.rows('links', [['person_id', 'eq', person], ['entity_id', 'eq', entity]])[0];
        if (has) change('links', has.id, { role: op.role || has.role || '' }, '');
        else snaps.push({ kb: true, t: 'links', id: db.insert('links', { person_id: person, entity_id: entity, role: op.role || '' }).id, before: null, title: '' });
      } else if (op.op === 'unlink') {
        for (const l of db.rows('links', [['person_id', 'eq', op.person_id], ['entity_id', 'eq', op.entity_id]])) {
          snaps.push({ kb: true, t: 'links', id: l.id, before: l, deleted: true, title: '' });
          db.removeById('links', l.id);
        }
      }
    }
    return snaps;
  }

  function kbRestore(snap) {
    if (snap.before === null) db.removeById(snap.t, snap.id);
    else if (snap.deleted) {
      const { id, createdAt, updatedAt, ...cols } = snap.before;
      db.insert(snap.t, cols, { id, createdAt, updatedAt });
    } else db.update(snap.t, snap.id, snap.before);
  }

  // A second-step call (a question's dossier, an internet search): a key out of credits hands over to the next keys
  // in turn (the same rule as the router's); a model that fails (a timeout) hands over to `req.fallback`.
  async function ask(req) {
    const tryModel = async (model, key) => {
      let res = await gemini(model, req.body, key);
      for (let i = 1; i < keys.length && res.error && /\b(401|402|403|429)\b|RESOURCE_EXHAUSTED|PERMISSION_DENIED|API key/i.test(JSON.stringify(res.error)); i += 1) {
        const k = (key + i) % keys.length;
        res = await gemini(model, req.body, k);
        if (!res.error) staticData.geminiKey = k;
      }
      return res;
    };
    const res = await tryModel(req.model, req.key);
    return res.error && req.fallback ? tryModel(req.fallback, staticData.geminiKey ?? req.key) : res;
  }

  // «що там про спільноту?»: the dossier of that part of the knowledge base, then a short answer from it.
  async function research(item, nodes) {
    const n = { ...nodes, 'Get done tasks': db.rows('tasks', [['status', 'eq', 'done'], ['chat_id', 'eq', own]]), Profile: db.kvGet('profile', {}) };
    const req = run('research_request.js', item, n)[0];
    n['Research request'] = req;
    await act(run('research_answer.js', await ask(req), n), n);
  }

  // «коли концерт в опері?»: Gemini with Google Search; without search quota on the keys — the same question
  // without it, on the fast model, and the answer says so.
  async function web(item, nodes) {
    const req = run('web_request.js', item, { ...nodes, Profile: db.kvGet('profile', {}) })[0];
    let res = await ask(req);
    const offline = Boolean(res.error);
    if (offline) res = await ask({ ...req, model: req.fallback, fallback: null, body: req.plain_body });
    const n = { ...nodes, 'Web request': { ...req, offline } };
    await act(run('web_answer.js', res, n), n);
  }

  // ---- routes produced by the router and the button handlers ----
  async function act(items, nodes) {
    const by = {};
    for (const i of items || []) (by[i.route] = by[i.route] || []).push(i);
    for (const route of Object.keys(by)) if (!ORDER.includes(route)) console.warn(`unknown route ${route}`);
    for (const route of ORDER) {
      const list = by[route];
      if (!list) continue;
      state.step = `route ${route}`;
      if (route === 'log') logTurn(list);
      else if (route === 'create_task') {
        const inserted = list.map((i) => db.insert('tasks', full('tasks', i.task)));
        for (const c of run('format_confirmation.js', inserted, { ...nodes, 'Insert task': inserted })) {
          if (!c.batch) {
            await send(c.chat_id, c.text, KB.task(c.id));
            logTurn(c);
            continue;
          }
          const undo = action(c, { text: c.text });
          const b = run('format_batch.js', undo, { ...nodes, 'Insert task': inserted })[0];
          await send(b.chat_id, b.text, numbered(b.btns, b.nav));
          logTurn(b);
        }
      } else if (route === 'create_note') {
        const inserted = list.map((i) => db.insert('notes', full('notes', i.note)));
        for (const n of run('format_note.js', inserted, nodes)) {
          await send(n.chat_id, n.text, KB.note(n.id));
          logTurn(n);
        }
      } else if (route === 'task_update') list.forEach((i) => db.update('tasks', i.id, full('tasks', i.task)));
      else if (route === 'note_update') list.forEach((i) => db.update('notes', i.id, full('notes', i.note)));
      else if (route === 'task_status') list.forEach((i) => db.update('tasks', i.id, { status: i.status }));
      else if (route === 'note_status') list.forEach((i) => db.update('notes', i.id, { status: i.status }));
      else if (route === 'action_used') list.forEach((i) => db.update('actions', i.id, { status: i.status }));
      else if (route === 'summary') {
        for (const i of list) {
          if (!i.ops || i.ops === '[]') {
            await send(i.chat_id, i.text);
            continue;
          }
          const row = action(i);
          await send(row.chat_id, row.text, row.single ? KB.summaryCard(row.id, row.single, Boolean(i.close)) : KB.undo(row.id));
        }
      } else if (route === 'draft') {
        for (const i of list) {
          const row = action(i, { kind: 'draft', text: i.text || 'чернетка з фото' });
          const d = run('format_draft.js', row, nodes)[0];
          await send(d.chat_id, d.text, KB.draft(d.id, d.button));
          logTurn(d);
        }
      } else if (route === 'dupe' || route === 'conflict') {
        for (const i of list) {
          const row = action(i, { kind: route });
          await send(row.chat_id, row.text, (route === 'dupe' ? KB.dupe : KB.conflict)(row.id));
        }
      } else if (route === 'pause') list.forEach((i) => action(i, { kind: 'pause', text: i.until, ops: '[]' }));
      else if (route === 'say') for (const i of list) await send(i.chat_id, i.text);
      else if (route === 'answer') for (const i of list) await tg.answer(i.query_id, i.toast);
      else if (route === 'kb_write') {
        onKnowledge();
        for (const i of list) {
          const snaps = kbWrite(i.ops);
          if (snaps.length) {
            const undo = action({ chat_id: i.chat_id, text: i.text, ops: JSON.stringify(snaps), user_text: i.user_text });
            await send(i.chat_id, i.text, KB.undo(undo.id));
          } else {
            await send(i.chat_id, i.text);
          }
          logTurn({ chat_id: i.chat_id, log_role: 'bot', log_text: i.log_text });
        }
      } else if (route === 'kb_restore') {
        list.forEach((i) => kbRestore(i.snap));
        onKnowledge();
      }
      else if (route === 'view') for (const i of list) await renderView(i, nodes);
      else if (route === 'research') for (const i of list) await research(i, nodes);
      else if (route === 'web') for (const i of list) await web(i, nodes);
      else if (route === 'person_ask') {
        for (const i of list) {
          const row = action(i, { kind: 'person', text: i.name });
          await send(row.chat_id, i.text, KB.person(row.id));
        }
      } else if (route === 'notes') for (const i of list) await formatNotes(i, nodes);
      else if (route === 'clarify') for (const i of list) await send(i.chat_id, i.text, numbered(i.btns, []));
    }
  }

  // ---- free text, voice and photos: the Gemini router ----
  async function routerPath(input, nodes) {
    const req = run('router_request.js', input, nodes)[0];
    nodes['Router request'] = req;
    let res = await gemini(req.model, req.body, req.key);
    let verdict = run('check_reply.js', res, nodes, 0)[0];
    // A key out of credits: the same request with the next key, which then stays the working one.
    for (let turn = 1; verdict.next === 2; turn += 1) {
      res = await gemini(req.model, req.body, verdict.key);
      verdict = run('check_reply.js', res, nodes, turn)[0];
    }
    // An unusable answer: the other model on the key that answered. When that one fails (a timeout, an error), a valid
    // reply the guards only doubted is still better than «Gemini недоступний».
    res = verdict;
    if (verdict.next === 1) {
      const second = await gemini(req.fallback, req.body, verdict.key);
      res = second.error && verdict.valid ? verdict : second;
    }
    nodes.Interpret = run('interpret.js', res, nodes);
    await act(nodes.Interpret, nodes);
  }

  // ---- task and note buttons, cards ----
  async function taskButton(ctx, nodes) {
    const a = run('apply_action.js', db.byId('tasks', ctx.task_id) || {}, nodes)[0];
    logTurn(a);
    if (a.action === 'edit') {
      await send(a.chat_id, a.text, KB.forceReply);
      await tg.answer(a.query_id, a.toast);
    } else if (a.action === 'later') {
      await tg.edit(a.chat_id, a.message_id, a.text, KB.later(a.id));
      await tg.answer(a.query_id, 'Коли нагадати?');
    } else {
      if (a.id > 0) db.update('tasks', a.id, full('tasks', a.row));
      const undo = action({ chat_id: a.chat_id, text: a.toast, ops: a.ops, user_text: a.user_text, single: null });
      await tg.answer(a.query_id, a.toast);
      await tg.edit(a.chat_id, a.message_id, a.text, KB.undo(undo.id));
    }
  }

  async function noteButton(ctx, nodes) {
    const a = run('apply_note_action.js', db.byId('notes', ctx.task_id) || {}, nodes)[0];
    logTurn(a);
    if (a.id > 0 && a.note) db.update('notes', a.id, full('notes', a.note));
    if (a.create_task) db.insert('tasks', full('tasks', a.task));
    await tg.answer(a.query_id, a.toast);
    await tg.edit(a.chat_id, a.message_id, a.text, null);
  }

  async function card(ctx, nodes) {
    const t = db.byId('tasks', ctx.task_id) || {};
    const steps = db.rows('tasks', [['parent_id', 'eq', ctx.task_id]]);
    const c = run('task_card.js', steps, { ...nodes, 'Get task for card': t })[0];
    logTurn(c);
    await send(c.chat_id, c.text, c.id ? KB.taskFull(c.id) : null);
    await tg.answer(ctx.query_id, '');
  }

  async function noteCard(ctx, nodes) {
    const c = run('note_card.js', db.byId('notes', ctx.task_id) || {}, nodes)[0];
    logTurn(c);
    await send(c.chat_id, c.text, c.id ? KB.note(c.id) : null);
    await tg.answer(ctx.query_id, '');
  }

  // ---- entry points ----
  async function handleUpdate(update) {
    const routed = run('route.js', update, {});
    if (!routed.length) return null;
    const nodes = { Route: routed[0], ...lookups() };
    const ctx = run('context.js', null, nodes)[0];
    nodes.Context = ctx;
    const byAction = (file, table) => act(run(file, db.byId(table, ctx.task_id) || {}, nodes), nodes);
    switch (ctx.kind) {
      case 'new':
        await tg.typing(ctx.chat_id);
        if (ctx.voice || ctx.media) {
          state.step = 'Telegram getFile';
          await routerPath({ ...ctx, audio_b64: await tg.download(ctx.file_id) }, nodes);
        } else {
          await routerPath(ctx, nodes);
        }
        break;
      case 'split':
        await tg.typing(ctx.chat_id);
        await tg.answer(ctx.query_id, 'Розбиваю на кроки…');
        await routerPath(ctx, nodes);
        break;
      case 'view': await renderView(ctx, nodes); break;
      case 'callback': await taskButton(ctx, nodes); break;
      case 'help': await send(ctx.chat_id, ctx.text, KB.menu); break;
      case 'notes': await formatNotes(ctx, nodes); break;
      case 'note_cb': await noteButton(ctx, nodes); break;
      case 'card': await card(ctx, nodes); break;
      case 'ncard': await noteCard(ctx, nodes); break;
      case 'move': await act(run('plan_move.js', ctx, nodes), nodes); break;
      case 'undo': await byAction('apply_undo.js', 'actions'); break;
      case 'dupe': await byAction('apply_dupe.js', 'actions'); break;
      case 'person': await byAction('apply_person.js', 'actions'); break;
      // Buttons of the old Obsidian proposals: those proposals are gone.
      case 'vault': await tg.answer(ctx.query_id, 'Вже оброблено'); break;
      case 'draft': await byAction('apply_draft.js', 'actions'); break;
      default: console.warn(`unknown kind ${ctx.kind}`);
    }
    saveStatic();
    return ctx.kind;
  }

  // 9:00 plan, 17:00 check, 21:00 evening (Sunday — the week); quiet mode skips them.
  async function digest() {
    const nodes = { 'Get pause (digest)': db.rows('actions', [['kind', 'eq', 'pause'], ['status', 'eq', 'new']]) };
    const d = run('digest_request.js', null, nodes);
    if (!d.length) return;
    db.remove('dialog', [['ts', 'lt', Date.now() - DIALOG_KEEP_MS]]);
    Object.assign(nodes, { 'Digest request': d[0], 'Get done tasks': db.rows('tasks', [['status', 'eq', 'done'], ['chat_id', 'eq', own]]), ...lookups() });
    nodes.Context = run('context.js', null, nodes)[0];
    await renderView(nodes.Context, nodes);
    saveStatic();
  }

  // Every minute: due reminders (held back during quiet mode), then the summary of what a pause held back.
  async function reminders() {
    const nodes = {
      'Get pause': db.rows('actions', [['kind', 'eq', 'pause'], ['status', 'eq', 'new']]),
      'Due tasks': db.rows('tasks', [['status', 'eq', 'open'], ['next_ts', 'notEmpty'], ['next_ts', 'lte', Date.now()]]),
    };
    const gated = run('pause_gate.js', null, nodes);
    if (gated.length) {
      for (const p of run('plan_next.js', gated, nodes)) {
        if (!p.held) await send(p.chat_id, p.text, KB.reminder(p.id));
        db.update('tasks', p.id, { next_ts: p.next_ts });
        if (!p.held) db.insert('dialog', { chat_id: p.chat_id, role: 'bot', text: p.log_text, item_ids: p.log_ids, ts: Date.now() });
      }
    }
    for (const s of run('pause_summary.js', null, nodes)) {
      if (s.kind === 'send') {
        await send(s.chat_id, s.text, numbered(s.btns, []));
        db.insert('dialog', { chat_id: s.chat_id, role: 'bot', text: s.log_text, item_ids: s.log_ids, ts: Date.now() });
      } else {
        db.update('actions', s.id, { status: s.status });
      }
    }
  }

  // After the knowledge base changed (and once at start): summaries of the big places whose knowledge changed, then
  // the profile — a few calls at most, none when nothing changed. Returns 'retry' after a failed call and 'more' when
  // work is left after 4 rounds, so the service runs it again later; nothing when all is done.
  async function summaries() {
    for (let round = 0; round < 4; round += 1) {
      const nodes = { Knowledge: lookups().Knowledge, Profile: db.kvGet('profile', {}) };
      const req = run('summary_request.js', {}, nodes)[0];
      if (!req) return undefined;
      const rows = run('summary_apply.js', await ask(req), { ...nodes, 'Summary request': req });
      if (!rows.length) return 'retry';
      for (const r of rows) {
        if (r.profile) db.kvSet('profile', { text: r.text, hash: r.hash });
        else db.update('entities', r.id, { summary: r.summary, summary_hash: r.hash });
      }
      saveStatic();
    }
    return 'more';
  }

  // Every 10 minutes: recurring events whose occurrence is over move to the next one; one-off events are closed
  // the day after.
  function rollSeries() {
    const series = db.rows('tasks', [['status', 'eq', 'open'], ['kind', 'eq', 'event']]);
    if (!series.length) return;
    for (const r of run('roll_series.js', series, {})) db.update('tasks', r.id, full('tasks', r.row));
  }

  const alert = (workflow, error) => run('format_error.js', {
    workflow: { name: workflow }, execution: { id: Date.now(), lastNodeExecuted: state.step, error: { message: String(error && error.message || error) } },
  }, {})[0];

  return { handleUpdate, digest, reminders, rollSeries, summaries, alert, state };
}

module.exports = { createBot };
