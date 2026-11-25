// «📝 Нотатки» and «покажи нотатки про …»: an overview of the knowledge base, or a search in it.
const req = $input.first().json;
const notes = vaultNotes().filter((n) => n.name !== 'Я' && n.type !== 'правила');
const q = String(req.query || '').trim().replace(/^#/, '');
const STOP = ['покажи', 'нотатки', 'нотатку', 'знайди', 'про', 'що', 'там', 'мої', 'записи', 'ідеї', 'мене', 'які'];
const words = (s) => String(s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.includes(w));
const hay = (n) => [n.name, n.desc, ...(n.aliases || []), n.body].join(' ').toLowerCase();
const names = (n) => words([n.name, ...(n.aliases || [])].join(' '));
const match = (ws) => notes.filter((n) => ws.some((w) => hay(n).includes(w) || names(n).some((x) => sameName(x, w))));
let found = q ? match(words(q).length ? words(q) : [q.toLowerCase()]) : [];
// Gemini sometimes "corrects" the search word; fall back to the user's own words.
if (q && !found.length && req.raw) found = match(words(req.raw));
const prefix = req.prefix || '';

let text;
if (!q) {
  const ideas = notes.filter((n) => n.type === 'ідея');
  const by = {};
  for (const n of ideas) by[n.parent] = (by[n.parent] || 0) + 1;
  const lines = Object.entries(by).sort((a, b) => b[1] - a[1]).map(([p, c]) => `• ${esc(p)} — ${c}`);
  text = `📝 <b>База знань</b> · ідей ${ideas.length}\n${lines.join('\n')}\n\n<i>Спитай «покажи нотатки про …» або просто «що там з Атлас?»</i>`;
} else if (!found.length) {
  text = `🔎 У базі знань нічого не знайшов за «${esc(q)}».`;
} else {
  const shown = found.slice(0, 12);
  text = `🔎 <b>База знань за «${esc(q)}»</b> · ${found.length}\n\n${shown.map((n, i) => `${i + 1}. <b>${esc(n.name)}</b> — <i>${esc(vaultPlace(n))}</i>${n.desc ? `\n    ${esc(clip(n.desc, 100))}` : ''}`).join('\n')}`;
}
return [{
  json: {
    chat_id: req.chat_id, text: prefix + text, btns: [],
    log_role: 'bot', log_text: q ? `показав нотатки за «${q}»: ${found.slice(0, 8).map((n) => n.name).join(', ') || 'нічого'}` : 'показав огляд бази знань', log_ids: '',
  },
}];
