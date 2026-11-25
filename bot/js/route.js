const HELP = [
  '👋 Я <b>Lanora</b>. Пиши або надиктовуй мені як людині:',
  '• <i>завтра о 10 пара з дизайну</i> — подія',
  '• <i>здати есе до пʼятниці</i> — задача',
  '• <i>ідея: …</i> — нотатка',
  '• <i>щопонеділка о 10 пара з дизайну</i> — повторювана подія',
  '• <i>що в мене завтра?</i> · <i>коли дедлайн по есе?</i> · <i>есе зробив</i>',
  '• фото розкладу чи оголошення — покажу, що знайшов, і створю',
  '',
  'Щодня о 9:00 — план, о 17:00 — що лишилось, о 21:00 — підсумок, у неділю — огляд тижня.',
  'Помилився — тисни ↩️ Скасувати. Кнопки внизу — швидкий доступ.',
].join('\n');

const MENU = { '📅 сьогодні': '/today', '🗓 тиждень': '/week', '📋 задачі': '/tasks', '📝 нотатки': '/notes' };
const COMMANDS = ['today', 'tomorrow', 'week', 'tasks', 'notes', 'day', 'help', 'start'];
const TASK_ACTIONS = ['done', 'del', 'snz', 'edit', 'later'];
const NOTE_ACTIONS = ['n2t', 'ndel'];

const item = $input.first();
const u = item.json;
const msg = u.message;
const cb = u.callback_query;
const from = (msg || cb || {}).from || {};
if (from.id !== OWNER_ID) return [];
const now = kyivNow();

if (cb) {
  const data = String(cb.data || '');
  const base = { chat_id: cb.message.chat.id, message_id: cb.message.message_id, query_id: cb.id };
  if (data.startsWith('v:')) {
    const [, view, date] = data.split(':');
    const kind = { d: 'day', w: 'week', t: 'tasks' }[view] || 'day';
    return [{ json: { ...base, kind: 'view', view: kind, date: date || dayKeyOf(now), mode: 'edit' } }];
  }
  const [action, ref, arg] = data.split(':');
  if (action === 'c' && /^[tn]\d+$/.test(ref)) {
    return [{ json: { ...base, kind: ref[0] === 't' ? 'card' : 'ncard', task_id: Number(ref.slice(1)), from_button: true } }];
  }
  if (action === 'mv') return [{ json: { ...base, kind: 'move', scope: ref, to: arg } }];
  if (action === 'u') return [{ json: { ...base, kind: 'undo', task_id: Number(ref) } }];
  if (action === 'dr') return [{ json: { ...base, kind: 'draft', task_id: Number(ref), arg: arg || 'no' } }];
  if (action === 'dp') return [{ json: { ...base, kind: 'dupe', task_id: Number(ref), arg: arg || 'new' } }];
  // "🪜 Розбити" under a stuck-task question goes to the router as if the owner asked for it.
  if (action === 'st') {
    return [{ json: { ...base, kind: 'split', text: `розбий на кроки t${ref}`, voice: false, forwarded: false, reply: { ref: `t${ref}`, text: '' } } }];
  }
  if (action === 'pp') return [{ json: { ...base, kind: 'person', task_id: Number(ref), arg: String(Number(arg) || 0) } }];
  if (action === 'vw') return [{ json: { ...base, kind: 'vault', task_id: Number(ref), arg: ['ok', 'inbox'].includes(arg) ? arg : 'no' } }];
  if (action === 'cf') return [{ json: { ...base, kind: 'dupe', task_id: Number(ref), arg: arg === 'new' ? 'new' : 'no' } }];
  const kind = NOTE_ACTIONS.includes(action) ? 'note_cb' : TASK_ACTIONS.includes(action) ? 'callback' : null;
  if (!kind) return [];
  return [{ json: { ...base, kind, action, task_id: Number(ref), arg: arg || '' } }];
}

const chat_id = msg.chat.id;
const voice = msg.voice || msg.audio;
let text = String(msg.text || msg.caption || '').trim();
text = MENU[text.toLowerCase()] || text;
const forwarded = Boolean(msg.forward_origin || msg.forward_from || msg.forward_from_chat);

let reply = null;
const replied = msg.reply_to_message;
if (replied && replied.from && replied.from.is_bot) {
  const entities = replied.entities || replied.caption_entities || [];
  const link = entities.map((e) => e.url || '').find((url) => /[?&]start=[tn]\d+/.test(url));
  reply = {
    ref: link ? /start=([tn]\d+)/.exec(link)[1] : null,
    text: clip(replied.text || replied.caption || '', 300),
  };
}

// Files are fetched later by a Telegram "file → get" step: the trigger's own download skips voice messages.
if (voice) {
  return [{ json: { kind: 'new', chat_id, text: '', voice: true, mime: voice.mime_type || 'audio/ogg', file_id: voice.file_id, duration: voice.duration || 0, forwarded, reply } }];
}
const doc = msg.document && /^(image\/|application\/pdf)/.test(msg.document.mime_type || '') ? msg.document : null;
const photo = Array.isArray(msg.photo) && msg.photo.length ? msg.photo[msg.photo.length - 1] : null;
if (photo || doc) {
  return [{ json: { kind: 'new', chat_id, text, voice: false, media: true, mime: doc ? doc.mime_type : 'image/jpeg', file_id: (doc || photo).file_id, forwarded, reply } }];
}

const view = (v, date) => [{ json: { kind: 'view', chat_id, view: v, date: dayKeyOf(date), mode: 'send' } }];
if (text.startsWith('/')) {
  const m = /^\/([a-zа-яіїєґ]+)(\d*)\b\s*(.*)$/is.exec(text) || [];
  let cmd = (m[1] || '').toLowerCase();
  const num = m[2];
  const arg = (m[3] || '').trim();
  if (cmd === 't' && num) return [{ json: { kind: 'card', chat_id, task_id: Number(num) } }];
  if (cmd === 'n' && num) return [{ json: { kind: 'ncard', chat_id, task_id: Number(num) } }];
  if (!COMMANDS.includes(cmd)) cmd = COMMANDS.find((c) => c.startsWith(cmd) || cmd.startsWith(c)) || 'help';
  if (cmd === 'today') return view('day', now);
  if (cmd === 'tomorrow') return view('day', logicalTomorrow(now));
  if (cmd === 'week') return view('week', now);
  if (cmd === 'tasks') return view('tasks', now);
  if (cmd === 'notes') return [{ json: { kind: 'notes', chat_id, query: arg } }];
  if (cmd === 'day') {
    const d = parseDayArg(arg, now);
    if (d) return view('day', d);
  }
  return [{ json: { kind: 'help', chat_id, text: HELP } }];
}
if (!text) return [{ json: { kind: 'help', chat_id, text: HELP } }];
return [{ json: { kind: 'new', chat_id, text, voice: false, forwarded, reply } }];
