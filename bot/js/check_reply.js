// Decides what to do with a Gemini reply: use it, ask the other model, or — when the key itself failed — ask again
// with the next key (which then stays the working one).
// Usable = valid and complete (replyOk); for the fast model also every record it changes must be pointed to by
// the message or the last bot turns (unanchoredRefs), «ідея …» must stay a note (ideaAsTask), and a fact about
// a person or project must not be answered with small talk (chatOverFacts), and a note pointed at with «це / його /
// туди» is assembled by the strong model (referentialNote). Photos are only checked for validity; list numbers
// («6 і 2 готово») are resolved by code in Interpret, so they need no second opinion.
const res = $input.first().json;
const r = $('Context').first().json;
const req = $('Router request').first().json;
// Each run of this node in one execution is the next key in turn, starting from the remembered one.
const used = (req.key + $runIndex) % GEMINI_KEYS;
if (keyFailure(res)) {
  // next: 2 — the same request with the next key; after the last key the error goes on to Interpret.
  if ($runIndex + 1 < GEMINI_KEYS) {
    setGeminiKey(used + 1);
    return [{ json: { key: (used + 1) % GEMINI_KEYS, next: 2 } }];
  }
  return [{ json: { ...res, ok: false, next: 0 } }];
}
if (used !== geminiKey()) setGeminiKey(used);
let ok = replyOk(res);
if (ok && !r.media && req.model === GEMINI_FAST) {
  const p = JSON.parse((res.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(''));
  const text = p.heard || r.text;
  const dialog = rowsOf('Get dialog');
  ok = !ideaAsTask(p, text) && !chatOverFacts(p, text, vaultNotes(), dialog) && !referentialNote(p, text) && (ordinalRefs(text, dialog).length > 0
    || !unanchoredRefs(p, text, r.reply && r.reply.ref, rowsOf('Get open tasks'), rowsOf('Get notes ctx'), dialog, vaultNotes()).length);
}
// next: 0 — use it, 1 — ask the other model with the key that answered. `valid`: a complete reply that only the
// guards doubted — still usable if the other model fails.
return [{ json: { ...res, ok, valid: replyOk(res), key: used, next: ok ? 0 : 1 } }];
