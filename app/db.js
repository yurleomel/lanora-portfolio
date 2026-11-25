// SQLite: the bot's tables (tasks, notes, dialog, actions — the columns the n8n data tables had, plus the system
// columns id, createdAt, updatedAt the scripts read), the knowledge base (entities with a parent, dated entries,
// person ↔ entity links with a role) and a key-value table for static data and state.
const { DatabaseSync } = require('node:sqlite');

const TABLES = {
  tasks: ['chat_id', 'title', 'description', 'kind', 'deadline', 'starts_at', 'ends_at', 'rule', 'remind_time',
    'every_minutes', 'next_ts', 'status', 'source', 'repeat', 'moves', 'nudged_ts', 'parent_id', 'context', 'priority', 'entity_id'],
  notes: ['chat_id', 'title', 'text', 'tags', 'status'],
  dialog: ['chat_id', 'role', 'text', 'item_ids', 'ts'],
  actions: ['chat_id', 'kind', 'text', 'single', 'ops', 'user_text', 'status', 'ts'],
  entities: ['kind', 'type', 'name', 'aliases', 'parent_id', 'description', 'status', 'summary', 'summary_hash'],
  entries: ['entity_id', 'text', 'ts', 'source'],
  links: ['person_id', 'entity_id', 'role'],
};
const NUMBER = new Set(['chat_id', 'every_minutes', 'next_ts', 'ts', 'single', 'moves', 'nudged_ts', 'parent_id', 'priority', 'entity_id', 'person_id']);
const OPS = { eq: '= ?', lt: '< ?', lte: '<= ?' };

// Values are cast like n8n's typed columns: numbers or null, strings or null.
function cast(col, v) {
  if (v === undefined || v === null) return null;
  if (NUMBER.has(col)) {
    if (v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return typeof v === 'string' ? v : String(v);
}

function open(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  for (const [t, cols] of Object.entries(TABLES)) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${t} (id INTEGER PRIMARY KEY AUTOINCREMENT, ${cols.map((c) => `"${c}" ${NUMBER.has(c) ? 'REAL' : 'TEXT'}`).join(', ')}, createdAt TEXT, updatedAt TEXT)`);
    // A column added later (tasks.entity_id) goes into the existing table without touching its rows.
    const have = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
    for (const c of cols) if (!have.has(c)) db.exec(`ALTER TABLE ${t} ADD COLUMN "${c}" ${NUMBER.has(c) ? 'REAL' : 'TEXT'}`);
  }
  db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');
  const plain = (r) => (r ? { ...r } : r);

  // where: [[column, 'eq'|'lt'|'lte'|'notEmpty', value], …]
  function rows(table, where = []) {
    const sql = where.map(([c, op]) => (op === 'notEmpty' ? `"${c}" IS NOT NULL AND "${c}" != ''` : `"${c}" ${OPS[op]}`));
    const args = where.filter(([, op]) => op !== 'notEmpty').map(([c, , v]) => cast(c, v));
    return db.prepare(`SELECT * FROM ${table}${sql.length ? ` WHERE ${sql.join(' AND ')}` : ''} ORDER BY id`).all(...args).map(plain);
  }
  const byId = (table, id) => plain(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(id) || 0));

  function insert(table, row, extra = {}) {
    const now = new Date().toISOString();
    const cols = TABLES[table].filter((c) => c in row);
    const all = [...cols, ...Object.keys(extra), 'createdAt', 'updatedAt'];
    const vals = [...cols.map((c) => cast(c, row[c])), ...Object.values(extra), extra.createdAt || now, extra.updatedAt || now];
    const names = all.filter((c, i) => all.indexOf(c) === i);
    const values = names.map((c) => vals[all.indexOf(c)]);
    const r = db.prepare(`INSERT INTO ${table} (${names.map((c) => `"${c}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`).run(...values);
    return byId(table, Number(r.lastInsertRowid));
  }

  // Overwrites the given columns (n8n's update by id); a missing id changes nothing.
  function update(table, id, row) {
    const cols = TABLES[table].filter((c) => c in row);
    if (!cols.length || !(Number(id) > 0)) return byId(table, id);
    db.prepare(`UPDATE ${table} SET ${cols.map((c) => `"${c}" = ?`).join(', ')}, updatedAt = ? WHERE id = ?`)
      .run(...cols.map((c) => cast(c, row[c])), new Date().toISOString(), Number(id));
    return byId(table, id);
  }

  const removeById = (table, id) => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(id));
  const remove = (table, where) => {
    const sql = where.map(([c, op]) => `"${c}" ${OPS[op]}`).join(' AND ');
    db.prepare(`DELETE FROM ${table} WHERE ${sql}`).run(...where.map(([c, , v]) => cast(c, v)));
  };
  const kvGet = (key, dflt = null) => {
    const r = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return r ? JSON.parse(r.value) : dflt;
  };
  const kvSet = (key, value) => db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));

  return { db, rows, byId, insert, update, remove, removeById, kvGet, kvSet, close: () => db.close() };
}

module.exports = { open, TABLES };
