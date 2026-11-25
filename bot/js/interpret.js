// Turns the router's JSON into routed actions: create_task, create_note, task_update, note_update,
// summary, view, notes, say, clarify, log. A Switch downstream sends each item to its node.
const r = $('Context').first().json;
const res = $input.first().json;
const nowMs = Date.now();
const now = kyivNow();
const open = rowsOf('Get open tasks');
const notes = rowsOf('Get notes ctx');
const chat_id = r.chat_id;
const out = [];
let heardPrefix = '';
const push = (route, data) => out.push({ json: { route, chat_id, heard_prefix: heardPrefix, ...data } });
const log = (role, text, ids = []) => push('log', { log_role: role, log_text: clip(text, 500), log_ids: ids.join(',') });

let p;
try {
  const raw = (res.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('');
  p = JSON.parse(raw);
} catch (e) {
  log('user', r.voice ? '🎙 (голосове)' : r.media ? '📷 (фото/документ)' : r.text);
  push('say', {
    // 402 = the AI Studio project's prepaid credits are used up: waiting a minute will not help.
    text: res.error && /402|prepayment|credits/i.test(JSON.stringify(res.error))
      ? '⚠️ У Gemini закінчились кредити на всіх ключах — поповни в AI Studio (Billing) або додай новий ключ, тоді я знову працюю.'
      : res.error ? '⚠️ Gemini зараз недоступний — спробуй за хвилину.'
      : r.voice ? '🎙 Не розібрав голосове — спробуй ще раз або напиши текстом.' : '🤔 Не зрозумів. Спробуй сказати інакше.',
  });
  return out;
}

const heard = r.voice ? String(p.heard || '').trim() : '';
heardPrefix = heard ? `🎙 <i>${esc(clip(heard, 300))}</i>\n\n` : '';
const userText = heard || r.text;
log('user', r.voice ? `🎙 ${heard}` : r.media ? `📷 надіслав фото/документ${r.text ? `: ${r.text}` : ''}` : r.text);

// The owner's rule: at night (before LATE_NIGHT_HOUR) "завтра" is still the current date. Gemini ignores it
// in long prompts, so dates that landed on the calendar tomorrow are pulled back deterministically.
const nightTomorrow = now.hour < LATE_NIGHT_HOUR && /завтр/i.test(userText) && !/післязавтр/i.test(userText)
  ? dayKeyOf(now.plus({ days: 1 })) : null;
function nightFix(obj) {
  if (!nightTomorrow || !obj) return obj;
  for (const k of ['deadline', 'starts_at', 'ends_at', 'remind_at', 'first_reminder_at']) {
    const d = parseWhen(obj[k]);
    if (d && dayKeyOf(d) === nightTomorrow) obj[k] = toIso(d.minus({ days: 1 }));
  }
  return obj;
}
// Gemini sometimes lands an explicitly named weekday on the wrong date ("до кінця середи" -> Thursday).
// When exactly one weekday is named, shift the item's dates so the primary one falls on that weekday.
const WD_RE = [[1, /понеділ/i], [2, /вівтор/i], [3, /серед/i], [4, /четв/i], [5, /п['ʼ’]?ятниц/i], [6, /субот/i], [7, /неділ/i]];
const namedWd = WD_RE.filter(([, re]) => re.test(userText)).map(([wd]) => wd);
function weekdayFix(obj) {
  if (namedWd.length !== 1 || !obj) return obj;
  const key = ['starts_at', 'deadline'].find((k) => parseWhen(obj[k]));
  if (!key) return obj;
  const d = parseWhen(obj[key]);
  if (d.weekday === namedWd[0]) return obj;
  const next = /наступн/i.test(userText) ? 7 : 0;
  let target = now.startOf('day').plus({ days: (namedWd[0] - now.weekday + 7) % 7 + next });
  target = target.set({ hour: d.hour, minute: d.minute });
  if (target.toMillis() < now.toMillis()) target = target.plus({ days: 7 });
  const shift = Math.round(target.startOf('day').diff(d.startOf('day'), 'days').days);
  for (const k of ['deadline', 'starts_at', 'ends_at', 'remind_at', 'first_reminder_at']) {
    const v = parseWhen(obj[k]);
    if (v) obj[k] = toIso(v.plus({ days: shift }));
  }
  return obj;
}
// Internal refs from the dialog log ("змінив t6 «…»") are not for the owner's eyes.
if (p.reply) p.reply = String(p.reply).replace(/\s?\(\b[tn]\d+\)|\b[tn]\d+\s?/g, '').trim();
// «другу видали»: an ordinal points into the bot's last numbered list — no guessing by the model.
const ords = ['complete', 'delete', 'edit'].includes(p.intent) ? ordinalRefs(userText, rowsOf('Get dialog')) : [];
if (ords.length === 1 && p.intent === 'edit' && (p.edits || []).length === 1) p.edits[0].target = ords[0];
// The list numbers replace the model's whole reading, including its own done/removed lists.
if (ords.length && p.intent !== 'edit') { p.targets = ords; p.done = null; p.removed = null; }
// «перенеси на сьогодні» right after the bot showed or touched exactly one record is about that record, whatever the
// model picked from older turns — unless the message names its own task.
const lastOne = ords.length ? null : lastSingleRef(rowsOf('Get dialog'));
const lastOpen = lastOne && [...open.map((t) => `t${t.id}`), ...notes.map((n) => `n${n.id}`)].includes(lastOne);
if (lastOpen && shortReply(userText)) {
  const loose = (ref) => ref !== lastOne && !wordAnchored(ref, userText, open, notes, vaultNotes());
  if ((p.edits || []).length === 1 && loose(p.edits[0].target)) p.edits[0].target = lastOne;
  if (['complete', 'delete'].includes(p.intent) && (p.targets || []).length === 1 && loose(p.targets[0])) p.targets = [lastOne];
}
for (const it of p.items || []) weekdayFix(nightFix(it));
for (const e of p.edits || []) weekdayFix(nightFix(e.set));
if (p.query && p.query.date && String(p.query.date).startsWith(nightTomorrow || '-')) p.query.date = dayKeyOf(now);

const findTask = (ref) => open.find((t) => `t${t.id}` === ref);
const findNote = (ref) => notes.find((n) => `n${n.id}` === ref);
// Two open tasks with one title (legacy twins): the owner means the one the bot showed or changed last,
// and one change lands once, not on both. Edits of one task are merged into one.
const seen = rowsOf('Get dialog').sort((a, b) => a.ts - b.ts).map((d) => `,${d.item_ids || ''},`);
const lastSeen = (id) => seen.map((s) => s.includes(`,t${id},`)).lastIndexOf(true);
function preferSeen(ref) {
  const t = findTask(ref);
  if (!t || t.kind === 'event') return ref;
  const key = String(t.title).trim().toLowerCase();
  const twins = open.filter((x) => x.kind !== 'event' && String(x.title).trim().toLowerCase() === key);
  return `t${twins.reduce((a, b) => (lastSeen(b.id) > lastSeen(a.id) ? b : a), t).id}`;
}
if (Array.isArray(p.edits)) {
  const byTask = new Map();
  p.edits = p.edits.filter(Boolean).map((e) => ({ ...e, target: preferSeen(e.target) })).filter((e) => {
    if (!findTask(e.target)) return true;
    const first = byTask.get(e.target);
    if (!first) { byTask.set(e.target, e); return true; }
    first.set = { ...(e.set || {}), ...(first.set || {}) };
    first.clear = [...new Set([...(first.clear || []), ...(e.clear || [])])];
    return false;
  });
}
const tagsOf = (tags) => (Array.isArray(tags) ? tags : []).map((t) => String(t).toLowerCase().replace(/[#\s,]+/g, '')).filter(Boolean).slice(0, 3).join(',');
const say = (text) => push('say', { text: heardPrefix + text });
// One unknown person per message gets «Хто це — …?», never twice for the same name.
function askAboutPerson(made = []) {
  const vault = [...vaultNotes(), ...made];
  if (!vault.length) return;
  const name = personToAsk(p.new_people, vault, rowsOf('Get person asks'));
  if (!name) return;
  push('person_ask', { text: `🤔 Хто це — ${esc(name)}? Запишу, щоб далі розуміти, про кого мова.`, name, ops: JSON.stringify({ name, user_text: clip(userText, 200) }), user_text: clip(userText, 300) });
  log('bot', `спитав, хто це — ${name}`);
}
function conflictText(c, t) {
  const day = relDay(c.start, now);
  const at = `${day === 'сьогодні' ? 'О' : `${day[0].toUpperCase()}${day.slice(1)} о`} ${fmtTime(c.start)}`;
  return `⚠️ ${at} у тебе вже «${esc(c.row.title)}»${c.end ? ` (до ${fmtTime(c.end)})` : ''}. Все одно ставити «${esc(t.title)}» на ${fmtTime(parseWhen(t.starts_at))}?`;
}

// Notes, ideas and facts go straight into the knowledge base. One message — one write and one ↩️: its structure
// changes (kb) first, then its notes, which may land in what those changes just created.
const notePlans = [];
function pushNotes(plans) {
  notePlans.push(...plans);
}
function writeKnowledge(kb) {
  if (!kb.ops.length && !notePlans.length) {
    if (kb.lines.length) say(kb.lines.join('\n'));
    return;
  }
  const lines = [...kb.lines, ...(notePlans.length ? [kbNotesText(notePlans)] : [])];
  const logs = [...(kb.lines.length ? [`змінив структуру: ${kb.lines.join('; ').replace(/<[^>]+>/g, '')}`] : []),
    ...(notePlans.length ? [`записав у базу знань: ${notePlans.map((x) => `${x.where} — ${clip(x.text, 80)}`).join('; ')}`] : [])];
  push('kb_write', { text: heardPrefix + lines.join('\n'), ops: [...kb.ops, ...(notePlans.length ? mergePlans(notePlans).ops : [])], user_text: clip(userText, 300), log_text: logs.join('; ') });
}

// New records of a message (a plain create, or the new part of a «create + edit» plan). `editing` holds the
// targets the same message edits, so an item that only restates one of them is not offered as a duplicate.
function createItems(items, editing, made = []) {
  const vault = [...vaultNotes(), ...made];
  const built = items.map((it) => {
    const title = String(it.title).trim().slice(0, 200);
    const description = it.description ? String(it.description).trim().slice(0, 2000) : null;
    return it.type === 'note'
      ? { kind: 'note', it, note: { chat_id, title: title.slice(0, 120), text: description || userText || title, tags: tagsOf(it.tags), status: 'active' } }
      : { kind: 'task', it, task: { chat_id, title, description, ...buildSchedule(it, nowMs), status: 'open', source: (userText || `📷 ${title}`).slice(0, 1000), moves: 0, context: it.type === 'event' ? null : withNamedPeople(vault, it.context, title), priority: priorityValue(it.priority),
        entity_id: areaOf(vault, it.area, items.length === 1 ? `${title} ${userText}` : `${title} ${description || ''}`) } };
  });
  if (r.media) {
    // Photos and documents are shown as a draft first; nothing is created until "✅ Створити".
    // Notes from a photo carry their knowledge-base plan, written on "✅ Створити все".
    const ops = built.map(({ it, ...b }) => (b.kind === 'note' && vault.length ? { ...b, vault: vaultPlan(vault, it, userText || `📷 ${b.note.title}`, now) } : b));
    push('draft', { ops: JSON.stringify(ops), user_text: clip(userText || '📷 фото', 300) });
    return;
  }
  // Notes go into the knowledge base (all notes of one message — one write); without it, into the old notes table.
  const plans = [];
  for (const b of built) {
    if (b.kind === 'note') {
      const plan = vault.length ? vaultPlan(vault, b.it, userText, now) : null;
      if (plan) plans.push(plan);
      else push('create_note', { note: b.note });
      continue;
    }
    // A task that already exists is not duplicated: the owner chooses between updating it and a separate one.
    const dup = findDuplicate(b.task, open);
    if (dup && editing.has(`t${dup.id}`)) continue;
    if (dup) {
      const set = itemToSet(b.it);
      const changes = diffText(dup, applyPatch(dup, set, [], nowMs), nowMs).filter((c) => !c.startsWith('назва'))
        .map((c) => c.replace(/^додав опис:/, 'додати опис:').replace(/^додав:/, 'дописати:').replace(/^оновив опис/, 'оновити опис'));
      const text = `У тебе вже є «${esc(dup.title)}» (${whenShort(dup, now)}).${changes.length ? ` Оновити її — ${changes.join(', ')}?` : ' Оновити її чи створити окрему?'}`;
      push('dupe', { text: heardPrefix + text, ops: JSON.stringify({ target: dup.id, set, task: b.task }), user_text: clip(userText, 300) });
      log('bot', `знайшов схожу t${dup.id} «${dup.title}» і спитав, оновити чи створити окрему`, [`t${dup.id}`]);
      continue;
    }
    // An event on top of another one: ask before creating.
    const clash = findConflict(b.task, open);
    if (clash) {
      push('conflict', { text: heardPrefix + conflictText(clash, b.task), ops: JSON.stringify({ task: b.task }), user_text: clip(userText, 300) });
      log('bot', `попередив, що «${b.task.title}» накладається на t${clash.row.id} «${clash.row.title}», і спитав, чи ставити`, [`t${clash.row.id}`]);
      continue;
    }
    push('create_task', { task: b.task });
  }
  pushNotes(plans);
}

// What a photo without a caption adds to existing tasks, as a draft: only the description, never the dates.
function offerPhotoEdits(edits) {
  const ops = edits.map((e) => [findTask(e.target), (e.set || {}).append_description || (e.set || {}).description]).filter(([t, add]) => t && add)
    .map(([t, add]) => ({ kind: 'update', id: t.id, title: t.title, add: clip(String(add).trim(), 300), before: snapshot('task', t),
      task: applyPatch(t, { append_description: String(add).trim() }, [], nowMs) }));
  if (!ops.length) return;
  push('draft', { text: `📷 Додати з фото?`, ops: JSON.stringify(ops), user_text: '📷 фото' });
  log('bot', `запропонував додати фото в опис ${ops.map((o) => `t${o.id} «${o.title}»`).join(', ')}`, ops.map((o) => `t${o.id}`));
}

function applyEdits(edits) {
  const lines = [];
  const vaultEdits = [];
  const ids = [];
  const ops = [];
  const logs = [];
  let single = null;
  for (const e of edits) {
    const task = findTask(e.target);
    const note = findNote(e.target);
    const set = e.set || {};
    if (task) {
      const row = applyPatch(task, set, e.clear || [], nowMs);
      // «це про спільноту»: the task moves to another area of the knowledge base.
      if (set.area) row.entity_id = areaOf(vaultNotes(), set.area, '') || row.entity_id;
      const changes = diffText(task, row, nowMs);
      if ((task.repeat || null) !== row.repeat) changes.push(row.repeat ? `🔁 ${repeatText(row.repeat)}` : 'більше не повторюється');
      push('task_update', { id: task.id, task: row });
      ops.push(snapshot('task', task));
      const clash = row.starts_at !== (task.starts_at || null) ? findConflict(row, open, task.id) : null;
      if (clash) changes.push(`⚠️ тоді ж «${esc(clash.row.title)}» (${fmtTime(clash.start)}${clash.end ? `–${fmtTime(clash.end)}` : ''})`);
      lines.push([row.title, changes.length ? changes.join(', ') : 'нічого не змінилось — уточни, що саме?']);
      logs.push(`t${task.id} «${row.title}»: ${changes.join(', ') || 'без змін'}`);
      ids.push(e.target);
      single = single === null ? task.id : -1;
    } else if (note && (set.type === 'task' || set.type === 'event')) {
      const parse = { ...set, title: set.title || note.title };
      push('create_task', { task: { chat_id, title: String(parse.title).slice(0, 200), description: set.description || note.text, ...buildSchedule(parse, nowMs), status: 'open', source: note.text } });
      push('note_update', { id: note.id, note: { ...pick(note, NOTE_COLS), status: 'converted' } });
      ops.push(snapshot('note', note));
      logs.push(`нотатку n${note.id} «${note.title}» перетворив на задачу`);
      ids.push(e.target);
    } else if (note) {
      let text = note.text;
      const what = [];
      if (set.description) { text = String(set.description).trim(); what.push('оновив текст'); }
      if (set.append_description) { text = `${text}\n${String(set.append_description).trim()}`; what.push(`додав: «${esc(clip(set.append_description, 80))}»`); }
      const upd = { ...pick(note, NOTE_COLS), title: set.title ? String(set.title).slice(0, 120) : note.title, text, tags: set.tags ? tagsOf(set.tags) : note.tags, status: 'active' };
      if (upd.title !== note.title) what.push(`назва → «${esc(upd.title)}»`);
      push('note_update', { id: note.id, note: upd });
      ops.push(snapshot('note', note));
      lines.push([`📝 ${upd.title}`, what.join(', ') || 'оновив']);
      logs.push(`нотатку n${note.id} «${upd.title}»: ${what.join(', ') || 'оновив'}`);
      ids.push(e.target);
    } else if (vaultFind(vaultNotes(), e.target)) {
      // «Ігор тепер ще й веде SEO» as an edit of a place in the knowledge base: an entry written to it.
      const extra = set.append_description || set.description || userText;
      vaultEdits.push({ type: 'note', title: String(extra).slice(0, 80), description: String(extra), place: e.target, new_note: false });
    } else {
      lines.push([null, `⚠️ Не знайшов запис ${esc(e.target || '')}. Напиши, яку саме задачу змінити.`]);
    }
  }
  const real = lines.filter(([t]) => t);
  let text = '';
  // Only the next reminder moved ("через пів години" after a reminder): ⏰ instead of ✏️.
  const onlyReminders = real.every(([, c]) => /^нагадаю [^,]*$/.test(c));
  if (real.length === 1) text = `${onlyReminders ? '⏰' : '✏️'} ${esc(real[0][0])}: ${real[0][1]}`;
  else if (real.length > 1 && onlyReminders) text = `⏰ Нагадаю:\n${real.map(([t, c]) => `• ${esc(t)} — ${c.replace(/^нагадаю /, '')}`).join('\n')}`;
  else if (real.length > 1) text = `✏️ Оновив ${real.length}:\n${real.map(([t, c]) => `• ${esc(t)} — ${c}`).join('\n')}`;
  const misses = lines.filter(([t]) => !t).map(([, c]) => c);
  if (text || misses.length) push('summary', { text: heardPrefix + [text, ...misses].filter(Boolean).join('\n'), single: single > 0 ? single : null, ops: ops.length ? JSON.stringify(ops) : '', user_text: clip(userText, 300) });
  if (vaultEdits.length) pushNotes(vaultEdits.map((it) => vaultPlan(vaultNotes(), it, userText, now)).filter(Boolean));
  if (logs.length) log('bot', `змінив ${logs.join('; ')}`, ids);
}

// Closing or deleting records (alone or as a part of a mixed message). False when none of refs is open.
function closeItems(refs, done) {
  const names = [];
  const rolledLines = [];
  const ids = [];
  const ops = [];
  for (const ref of refs) {
    const task = findTask(ref);
    const note = findNote(ref);
    if (task) {
      ops.push(snapshot('task', task));
      if (done) {
        const c = completeRow(task, nowMs);
        push('task_update', { id: task.id, task: c.row });
        if (c.rolled) rolledLines.push(`✅ ${esc(task.title)} — наступного разу ${when(c.next, now)}`);
        else names.push(esc(task.title));
      } else {
        push('task_update', { id: task.id, task: { ...pick(task, TASK_COLS), status: 'deleted', next_ts: null } });
        names.push(`${esc(task.title)}${task.repeat ? ' (усю серію)' : ''}`);
      }
      ids.push(ref);
    } else if (note) {
      ops.push(snapshot('note', note));
      push('note_update', { id: note.id, note: { ...pick(note, NOTE_COLS), status: 'deleted' } });
      names.push(`📝 ${esc(note.title)}`);
      ids.push(ref);
    }
  }
  if (!ids.length) return false;
  const head = names.length ? `${done ? '✅ Готово' : '🗑 Видалив'}${names.length > 1 ? ` (${names.length})` : ''}: ${names.join(', ')}` : '';
  const closed = done ? ids.map(findTask).filter(Boolean) : [];
  const cheer = closed.length ? doneReaction(doneToday(rowsOf('Get dialog'), nowMs), closed, open, nowMs) : '';
  const lines = [head, ...rolledLines].filter(Boolean);
  if (cheer) lines[lines.length - 1] += ` · ${cheer}`;
  // The last step of a split task: offer to close the task itself (the card buttons act on it).
  const parent = finishedParent(closed, open);
  if (parent) lines.push(`Усі кроки «${esc(parent.title)}» готові — закрити й саму справу?`);
  push('summary', { text: heardPrefix + lines.join('\n'), single: parent ? parent.id : null, close: Boolean(parent), ops: JSON.stringify(ops), user_text: clip(userText, 300) });
  log('bot', `${done ? DONE_LOG : 'видалив'} ${ids.map((ref) => `${ref} «${(findTask(ref) || findNote(ref)).title}»`).join(', ')}`, ids);
  return true;
}

// One message can do several things at once: add records (items), change existing ones (edits), close (done)
// and delete (removed) others — «о 8:45 нагадай про макет буклета, есе здав, а молоко вже не треба».
// A photo's create stays a draft of new records only.
if (['create', 'edit', 'complete', 'delete'].includes(p.intent)) {
  const refsOf = (v) => (Array.isArray(v) ? v.filter(Boolean).map(String) : []);
  // A photo without a caption can only propose changes as a draft.
  const quietPhoto = r.media && !String(r.text || '').trim();
  if (quietPhoto) { p.done = null; p.removed = null; if (p.intent === 'complete' || p.intent === 'delete') p.targets = null; }
  // Keep a task open when the user says they are starting it.
  const starting = /(?<!\p{L})(почина\p{L}*|почну|сідаю|сів за|сіла за|беруся|берусь|візьмусь|займусь|йду робити)(?!\p{L})/iu.test(userText)
    && !/(?<!\p{L})(зробив|зробила|готово|виконав|виконала|закрив|закрила|здав|здала|закінчив|закінчила)(?!\p{L})/iu.test(userText);
  if (starting && p.intent === 'complete' && !(p.items || []).length && !(p.edits || []).length) return say('💪 Вперед! Напиши «готово», коли закінчиш.'), out;
  if (starting) p.done = null;
  // A knowledge-base deletion only affects tasks if the message explicitly mentions tasks.
  if ((p.kb || []).some((k) => k && k.op === 'forget') && !/задач|справ|таск/i.test(userText)) {
    p.removed = null;
    if (p.intent === 'delete') p.targets = null;
  }
  const done = [...new Set([...(p.intent === 'complete' ? refsOf(p.targets) : []), ...refsOf(p.done)])];
  const removed = [...new Set([...(p.intent === 'delete' ? refsOf(p.targets) : []), ...refsOf(p.removed)])].filter((ref) => !done.includes(ref));
  const settled = new Set([...done, ...removed]);
  const items = Array.isArray(p.items) ? p.items.filter((it) => String(it.title || '').trim()) : [];
  let edits = r.media && p.intent === 'create' ? [] : (p.edits || []).filter((e) => e && e.target && !settled.has(e.target));
  // A «rename» to an unrelated title is a new task the model pinned onto another one (стажування → есе):
  // it is created instead, unless the owner really asked to rename.
  const pinned = (e) => {
    const t = findTask(e.target);
    return t && e.set && e.set.title && !/назв|перейменуй/i.test(userText) && !stems(e.set.title).some((w) => stems(t.title).some((x) => sameWord(w, x)));
  };
  items.push(...edits.filter(pinned).map((e) => ({ ...e.set, type: e.set.type || findTask(e.target).kind || 'task' })));
  edits = edits.filter((e) => !pinned(e));
  // Structure changes («заведи проєкт Витрати в Атлас», «обʼєднай X з Y») — done at once, with ↩️.
  // A note that only restates a known project in another place is that project moved there.
  for (const it of items.filter((x) => x.type === 'note' && x.place)) {
    const m = placeNamedByNote(vaultNotes(), it);
    if (!m) continue;
    items.splice(items.indexOf(it), 1);
    p.kb = [...(p.kb || []), { op: 'move', target: m.from.path, parent: m.to.path }];
  }
  const kb = kbOps(vaultNotes(), p.kb, p.new_people, userText);
  if (!items.length && !edits.length && !settled.size && !kb.lines.length) {
    return say(p.intent === 'edit' ? '🤔 Не зрозумів, що змінити. Спробуй сказати інакше.'
      : p.intent === 'complete' || p.intent === 'delete' ? '🤔 Не знайшов, про яку задачу йдеться. Напиши назву.'
        : r.media ? '📷 Не знайшов на фото справ чи нотаток.' : '🤔 Не зрозумів, що записати. Спробуй інакше.'), out;
  }
  if (edits.length && quietPhoto) offerPhotoEdits(edits);
  else if (edits.length) applyEdits(edits);
  const closedDone = done.length ? closeItems(done, true) : false;
  const closedRemoved = removed.length ? closeItems(removed, false) : false;
  if (items.length) createItems(items, new Set(edits.map((e) => e.target)), kb.made);
  writeKnowledge(kb);
  if (!items.length && !edits.length && !closedDone && !closedRemoved && !kb.lines.length) say('🤔 Не знайшов, про яку задачу йдеться. Напиши назву.');
  if (!(r.media && items.length)) askAboutPerson(kb.made);
  return out;
}

if (p.intent === 'split') {
  // Steps are shown as a draft (like photos) and created only after "✅ Створити все".
  const parent = (p.targets || []).map(findTask).find(Boolean) || null;
  const items = (p.items || []).filter((it) => String(it.title || '').trim()).slice(0, 8);
  if (!items.length) return say('🤔 Не вийшло розбити. Напиши кроки сам — створю їх.'), out;
  const steps = stepDeadlines(items, parent, now).map((it) => ({
    kind: 'task',
    task: {
      chat_id, title: String(it.title).trim().slice(0, 200), description: it.description ? String(it.description).trim() : null,
      ...buildSchedule({ ...it, type: 'task' }, nowMs), status: 'open', source: clip(userText, 1000), moves: 0,
      parent_id: parent ? parent.id : null, context: contextString(it.context) || (parent ? parent.context : null) || null,
      entity_id: parent ? parent.entity_id || null : null,
    },
  }));
  const name = parent ? parent.title : 'Справа';
  push('draft', { text: `🪜 «${esc(name)}» — ${steps.length} ${plural(steps.length, 'крок', 'кроки', 'кроків')}:`, ops: JSON.stringify(steps), user_text: clip(userText, 300) });
  log('bot', `запропонував розбити ${parent ? `t${parent.id} «${parent.title}»` : 'справу'} на кроки: ${steps.map((b) => b.task.title).join('; ')}`, parent ? [`t${parent.id}`] : []);
  return out;
}

if (p.intent === 'pause' || p.intent === 'resume') {
  // Quiet mode: a new pause row replaces any open one; "resume" is a pause that already ended,
  // so the reminders workflow sends the summary of what was held back on its next run.
  const pauses = pauseState(rowsOf('Get pause'), nowMs);
  for (const a of pauses.open) push('action_used', { id: a.id, status: 'used' });
  if (p.intent === 'resume') {
    if (!pauses.active) return say('🔔 Тиші й так немає — нагадую як завжди.'), out;
    push('pause', { until: toIso(now), text: toIso(now) });
    say('🔔 Тишу вимкнено. Якщо щось пропустив — зараз надішлю.');
    log('bot', 'вимкнув тишу');
    return out;
  }
  let until = parseWhen(p.until) || now.plus({ hours: 2 }).startOf('minute');
  if (until.toMillis() <= nowMs) return say('🤔 Цей час уже минув. Напиши, до коли тиша.'), out;
  push('pause', { until: toIso(until), text: toIso(until) });
  const same = dayKeyOf(until) === dayKeyOf(now);
  say(`🔕 Тиша ${pauseUntilText(until, now)}${same ? '' : ': без нагадувань і підсумків'}. Напиши ${same ? '«можна»' : '«я повернувся»'}, щоб повернути раніше.`);
  log('bot', `увімкнув тишу ${pauseUntilText(until, now)}`);
  return out;
}

if (p.intent === 'move_pending') {
  const { out: moves } = planMove(open, nowMs, chat_id);
  for (const m of moves) out.push({ json: { heard_prefix: heardPrefix, ...m, ...(m.route === 'summary' ? { text: heardPrefix + m.text, user_text: clip(userText, 300) } : {}) } });
  return out;
}

if (p.intent === 'answer') {
  // Something to look up on the internet: a second call with Google Search.
  if (p.web) {
    push('web', { query: clip(String(p.web), 200), question: userText, prefix: heardPrefix });
    return out;
  }
  // «що там про спільноту?» / «що ти про мене знаєш?»: written in a second step from a dossier of that part of the
  // knowledge base, or of all of it.
  const vault = vaultNotes();
  const all = (p.about || []).some((x) => /^(все|усе|всё|all|\*)$/i.test(String(x).trim()));
  const about = [...new Set((p.about || []).map((x) => vaultFind(vault, x)).filter(Boolean).map((n) => n.id))].slice(0, 3);
  // A place the base doesn't have («що я записував про гроші?»): the question goes to the whole base.
  const unknown = !about.length && (p.about || []).length > 0 && vault.length > 0;
  if (all || about.length || unknown) {
    push('research', { about: all || unknown ? [] : about, all: all || unknown, question: userText, prefix: heardPrefix });
    return out;
  }
  const a = answerView(p, open, notes, vault);
  if (a.refs.length) push('clarify', { text: heardPrefix + a.text, btns: numberButtons(a.refs) });
  else push('say', { text: heardPrefix + a.text });
  log('bot', a.log, a.refs);
  return out;
}

if (p.intent === 'query') {
  const q = p.query || {};
  if (q.view === 'notes') {
    push('notes', { query: q.search || '', raw: userText, prefix: heardPrefix });
  } else if (q.view === 'context') {
    push('view', { view: 'context', search: q.search || userText, date: dayKeyOf(now), mode: 'send', prefix: heardPrefix });
  } else {
    const d = parseDayArg(q.date, now) || now;
    push('view', { view: ['day', 'week', 'tasks'].includes(q.view) ? q.view : 'day', date: dayKeyOf(d), mode: 'send', prefix: heardPrefix });
  }
  return out;
}

if (p.intent === 'clarify') {
  const refs = (p.targets || []).filter((ref) => findTask(ref) || findNote(ref)).slice(0, MAX_BUTTONS);
  if (refs.length) {
    const lines = refs.map((ref, i) => {
      const t = findTask(ref);
      return `${i + 1}. ${t ? esc(t.title) : `📝 ${esc(findNote(ref).title)}`}`;
    });
    push('clarify', { text: `${heardPrefix}${esc(p.reply || 'Яку саме?')}\n\n${lines.join('\n')}`, btns: numberButtons(refs) });
    log('bot', `спитав «яку саме?» і ${listLog('варіанти', refs, (ref) => (findTask(ref) || findNote(ref)).title)}`, refs);
    return out;
  }
}

say(esc(p.reply || 'Я записую задачі, події й нотатки. Напиши, що треба зробити або запамʼятати 🙂'));
log('bot', p.reply || 'привітався');
return out;
