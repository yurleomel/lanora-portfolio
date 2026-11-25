// Lanora service: Telegram long polling, the minute scheduler (reminders, series, 9/17/21 digests) and failure
// alerts. Messages go one after another (each sees what the previous one did); the scheduler has its own queue,
// so a slow Gemini answer never holds back a reminder, and a digest never holds back a message.
const { DateTime } = require('luxon');
const { client } = require('./telegram');
const { generate } = require('./gemini');
const { createBot } = require('./bot');

const { TELEGRAM_BOT_TOKEN, BOT_USERNAME, OWNER_ID, DB_PATH } = process.env;
const keys = String(process.env.GEMINI_KEYS || '').split(/[\s,]+/).filter(Boolean);
if (!TELEGRAM_BOT_TOKEN || !keys.length || !/^[1-9]\d*$/.test(OWNER_ID || '') ||
    !/^[A-Za-z0-9_]{5,32}$/.test(BOT_USERNAME || '')) {
  console.error('Set TELEGRAM_BOT_TOKEN, BOT_USERNAME, OWNER_ID and GEMINI_KEYS before starting Lanora.');
  process.exit(1);
}
const db = require('./db').open(DB_PATH || './local-data/lanora.db');
const tg = client(TELEGRAM_BOT_TOKEN);
const bot = createBot({ db, tg, generate, keys, ownerId: OWNER_ID, onKnowledge: () => summariesSoon() });
const DIGEST_HOURS = [9, 17, 21];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Summaries call Gemini in the background: their own lane, so they hold back neither messages nor reminders.
const queues = { 'Lanora · Telegram': Promise.resolve(), 'Lanora · Reminders': Promise.resolve(), 'Lanora · Summaries': Promise.resolve() };
function enqueue(workflow, job, lane = workflow) {
  queues[lane] = queues[lane].then(async () => {
    const t0 = Date.now();
    try {
      const what = await job();
      if (what) console.log(`${workflow}: ${what} ${Date.now() - t0} ms`);
    } catch (e) {
      console.error(`${workflow} failed at ${bot.state.step}:`, e);
      const a = bot.alert(workflow, e);
      await tg.send(a.chat_id, a.text).catch((err) => console.error('alert failed:', err.message));
    }
  });
  return queues[lane];
}

async function poll() {
  await tg.deleteWebhook().catch((e) => console.error('deleteWebhook:', e.message));
  let offset = db.kvGet('tg_offset', 0);
  for (;;) {
    try {
      for (const u of await tg.getUpdates(offset)) {
        offset = u.update_id + 1;
        db.kvSet('tg_offset', offset);
        enqueue('Lanora · Telegram', () => bot.handleUpdate(u));
      }
    } catch (e) {
      console.error('getUpdates:', e.message);
      await sleep(5000);
    }
  }
}

// Summaries follow the knowledge base, not the clock: 2 minutes after its last change (a few notes in a row — one
// run), once at start, and 30 minutes after a failed call. No change — nothing runs.
const SETTLE_MS = 2 * 60 * 1000;
const RETRY_MS = 30 * 60 * 1000;
let summariesTimer = null;
function summariesSoon(delay = SETTLE_MS) {
  clearTimeout(summariesTimer);
  summariesTimer = setTimeout(() => enqueue('Lanora · Summaries', async () => {
    const left = await bot.summaries();
    if (left) summariesSoon(left === 'retry' ? RETRY_MS : SETTLE_MS);
    return left;
  }), delay);
}

// Once per Kyiv minute: reminders; every 10 minutes: series; at 9/17/21:00 the digest (once per slot).
let lastMinute = '';
function tick() {
  const now = DateTime.now().setZone('Europe/Kyiv');
  const minute = now.toFormat('yyyy-LL-dd HH:mm');
  if (minute === lastMinute) return;
  lastMinute = minute;
  enqueue('Lanora · Reminders', () => bot.reminders());
  if (now.minute % 10 === 0) enqueue('Lanora · Reminders', () => bot.rollSeries());
  const slot = now.toFormat('yyyy-LL-dd HH');
  if (DIGEST_HOURS.includes(now.hour) && now.minute === 0 && db.kvGet('digest_slot') !== slot) {
    db.kvSet('digest_slot', slot);
    enqueue('Lanora · Telegram', () => bot.digest(), 'Lanora · Reminders');
  }
}

console.log('Lanora is ready to receive messages.');
setInterval(tick, 5000);
tick();
summariesSoon(0);
poll();
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => Promise.all(Object.values(queues)).finally(() => { db.close(); process.exit(0); }));
