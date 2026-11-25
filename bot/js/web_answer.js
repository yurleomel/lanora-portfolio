// The reply found with Google Search: the text (its **bold** and «* » lists made Telegram-friendly) and up to 4
// sources as links.
const res = $input.first().json;
const req = $('Web request').first().json;
const out = [];
const push = (route, data) => out.push({ json: { route, chat_id: req.chat_id, ...data } });
const cand = res.candidates?.[0] || {};
const raw = String((cand.content?.parts || []).map((x) => x.text || '').join('')).trim();
if (!raw) {
  push('say', { text: `${req.prefix || ''}${keyFailure(res) ? '⚠️ У Gemini закінчились кредити на всіх ключах — поповни в AI Studio (Billing) або додай новий ключ.' : '🤔 Не вийшло пошукати в інтернеті — спробуй ще раз.'}` });
  push('log', { log_role: 'bot', log_text: `не зміг пошукати в інтернеті «${req.query}»`, log_ids: '' });
  return out;
}
const text = esc(clip(raw, 2500)).replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/^\s*[*-]\s+/gm, '• ');
const seen = new Set();
const sources = (cand.groundingMetadata?.groundingChunks || []).map((c) => c.web).filter((w) => w && w.uri && w.title && !seen.has(w.title) && seen.add(w.title)).slice(0, 4);
const links = sources.map((w) => `<a href="${esc(w.uri)}">${esc(clip(w.title, 40))}</a>`).join(' · ');
// Search was not available (no search quota on the keys): an answer from what the model knows, said so.
const head = req.offline ? '🌐 Пошук в інтернеті зараз недоступний — відповідаю з того, що знаю:\n\n' : '';
push('say', { text: `${req.prefix || ''}${head}${text}${links ? `\n\n🔎 ${links}` : ''}` });
push('log', { log_role: 'bot', log_text: `${req.offline ? 'без інтернету відповів' : `знайшов в інтернеті за «${req.query}»`}: ${clip(raw.replace(/\s+/g, ' '), 200)}`, log_ids: '' });
return out;
