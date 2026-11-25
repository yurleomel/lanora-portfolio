// The summaries Gemini wrote: {id, summary, hash} rows for the places of the batch, or {profile, text, hash}.
// A place the reply left out gets an empty summary with the new hash (its text is then sent as it is) instead of
// being asked about again every 10 minutes. A failed call writes nothing; the next run tries again.
const res = $input.first().json;
const req = $('Summary request').first().json;
let list = null;
try { list = JSON.parse((res.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join('')); } catch (e) { list = null; }
if (!Array.isArray(list)) return [];
const text = (x) => clip(String((x && x.summary) || '').trim(), 900);
if (req.kind === 'profile') return list[0] && text(list[0]) ? [{ json: { profile: true, text: text(list[0]), hash: req.hash } }] : [];
const by = new Map(list.map((x) => [Number(x.id), text(x)]));
return req.batch.map((c) => ({ json: { id: c.id, summary: by.get(c.id) || '', hash: c.hash } }));
