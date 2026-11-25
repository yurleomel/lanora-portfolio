// The reply to «що там про спільноту?» from its dossier: buttons to the tasks it names and the places it came from.
const res = $input.first().json;
const req = $('Research request').first().json;
const out = [];
const push = (route, data) => out.push({ json: { route, chat_id: req.chat_id, ...data } });
let p = null;
try { p = JSON.parse((res.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('')); } catch (e) { p = null; }
if (!p || !p.reply) {
  push('say', { text: `${req.prefix || ''}${keyFailure(res) ? '⚠️ У Gemini закінчились кредити на всіх ключах — поповни в AI Studio (Billing) або додай новий ключ.' : '🤔 Не вийшло зібрати відповідь — спробуй ще раз.'}` });
  return out;
}
const a = answerView(p, rowsOf('Get open tasks'), rowsOf('Get notes ctx'), vaultNotes());
if (a.refs.length) push('clarify', { text: (req.prefix || '') + a.text, btns: numberButtons(a.refs) });
else push('say', { text: (req.prefix || '') + a.text });
push('log', { log_role: 'bot', log_text: clip(a.log, 500), log_ids: a.refs.join(',') });
return out;
