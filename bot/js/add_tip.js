// Puts "💡 …" under the morning greeting; without a usable answer the plan goes out as it was.
const v = $('Render view').first().json;
const res = $input.first().json || {};
// A key out of credits: the tip is skipped today, and the next call (any message) starts from the next key.
if (keyFailure(res)) setGeminiKey($('Tip request').first().json.key + 1);
let tip = (res.candidates?.[0]?.content?.parts || []).map((x) => x.text || '').join(' ').replace(/\s+/g, ' ').trim();
tip = tip.replace(/^["«»'💡\s]+|["«»'\s]+$/g, '');
if (!tip || tip.length > 220 || res.error) return [{ json: v }];
const [first, ...rest] = String(v.text).split('\n');
return [{ json: { ...v, text: [first, `💡 <i>${esc(tip)}</i>`, ...rest].join('\n') } }];
