// Shows what was found on a photo, or the steps of a split task; nothing is created until the owner confirms.
const a = $input.first().json;
let items = [];
try { items = JSON.parse(a.ops || '[]'); } catch (e) { items = []; }
const now = kyivNow();
const lines = items.slice(0, 25).map((b, i) => {
  if (b.kind === 'update') return `${i + 1}. ✏️ ${esc(b.title)} — додати в опис: <i>${esc(clip(b.add, 120))}</i>`;
  if (b.kind === 'note') return `${i + 1}. 📝 ${esc(b.note.title)}${b.vault ? ` → <i>${esc(b.vault.where)}</i>` : ''}`;
  const t = b.task;
  const at = isUndated(t) ? '' : whenShort(t, now);
  return `${i + 1}. ${t.kind === 'event' ? '🗓' : '✅'} ${esc(t.title)}${at ? ` — ${at}` : ''}${t.repeat ? ` · 🔁 ${repeatText(t.repeat)}` : ''}`;
});
const more = items.length > 25 ? `\n…і ще ${items.length - 25}` : '';
const split = String(a.text || '').startsWith('🪜');
const adds = items.length && items.every((b) => b.kind === 'update');
return [{
  json: {
    id: a.id, chat_id: a.chat_id,
    text: `${split || adds ? a.text : `📷 Знайшов ${items.length}:`}\n${lines.join('\n')}${more}\n\n<i>${adds ? 'Якщо не туди — натисни «Ні» і напиши, куди.' : `${split ? 'Створити?' : 'Створити все це?'} Якщо щось не так — натисни «Ні» і напиши, що змінити.`}</i>`,
    button: adds ? '✅ Додати' : '✅ Створити все',
    log_role: 'bot', log_text: `показав ${split ? 'кроки' : 'чернетку з фото'}: ${items.map((b, i) => `№${i + 1} «${b.title || (b.task || b.note).title}»`).join('; ')}`, log_ids: '',
  },
}];
