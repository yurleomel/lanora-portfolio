// «коли концерт в опері?» — the question goes to Gemini with Google Search: the strong model first, the fast one
// (also with search) when it fails. Search can't be combined with a JSON schema, so the reply is plain text.
// `plain_body` — the same question without search, for when search is not available on the keys (429).
const req = $input.first().json;
// A little of who the owner is (the profile, or the top places with their descriptions), so «в опері» is searched
// in the right city.
const about = clip(String(profile().text || '').replace(/\s+/g, ' '), 400)
  || vaultNotes().filter((n) => !n.parent && n.kind !== 'person' && n.kind !== 'inbox' && n.desc).map((n) => `${n.name} — ${n.desc}`).join('; ');
const system = `Ти — Lanora, особистий помічник власника. Знайди в інтернеті відповідь на його питання.
Українською, на «ти», коротко й по суті (до 900 символів): дати, час, ціни, адреси, якщо є; кілька варіантів — списком «• ».
Не знайшов або дані суперечливі — так і скажи. Не вигадуй.
Зараз ${toIso(kyivNow())}.${about ? `\nПро власника: ${about}.` : ''}`;
return [{
  json: {
    ...req,
    model: GEMINI_STRONG,
    fallback: GEMINI_FAST,
    key: geminiKey(),
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: `${req.question}\n\n(пошуковий запит: ${req.query})` }] }],
      tools: [{ google_search: {} }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 4096 },
    },
    plain_body: {
      systemInstruction: { parts: [{ text: `Ти — Lanora, особистий помічник власника. Пошук в інтернеті зараз недоступний: відповідай з того,
що знаєш, українською, коротко (до 700 символів). Чесно скажи, що дані можуть бути застарілими, і де це перевірити
(офіційний сайт, каса, застосунок). Не вигадуй дат, цін і розкладів, яких не знаєш напевно.
Зараз ${toIso(kyivNow())}.${about ? `\nПро власника: ${about}.` : ''}` }] },
      contents: [{ role: 'user', parts: [{ text: req.question }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    },
  },
}];
