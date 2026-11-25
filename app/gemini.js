// One Gemini call with one key. Failures come back as {error: {message}} — like n8n's "continue on error" — so
// keyFailure() (402/429/…) and the bot's error replies read them exactly as before.
const URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// The fast model answers in 1–2 s (5–15 s without the cache); a call that hangs longer goes to the fallback
// instead of a minute of silence.
const TIMEOUT_MS = { 'gemini-3.5-flash-lite': 20000 };
const DEFAULT_TIMEOUT_MS = 30000;

// Every call leaves one log line: time and tokens — prompt (of it from Gemini's cache), reply, thinking.
async function generate(model, body, key) {
  const t0 = Date.now();
  let note = '';
  try {
    const res = await fetch(`${URL}/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key || '' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS[model] || DEFAULT_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) {
      note = `HTTP ${res.status}`;
      return { error: { message: `${res.status} - ${text.slice(0, 500)}` } };
    }
    const j = JSON.parse(text);
    const u = j.usageMetadata || {};
    note = `in ${u.promptTokenCount || 0} (cache ${u.cachedContentTokenCount || 0}) · out ${u.candidatesTokenCount || 0}${u.thoughtsTokenCount ? ` + think ${u.thoughtsTokenCount}` : ''}`;
    return j;
  } catch (e) {
    note = String(e.message || e).slice(0, 100);
    return { error: { message: String(e.message || e) } };
  } finally {
    console.log(`gemini ${model} ${Date.now() - t0} ms · ${note}`);
  }
}

module.exports = { generate };
