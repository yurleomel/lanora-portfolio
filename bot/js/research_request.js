// «що там про спільноту?» — the second step: the question with a dossier of just the asked part of the knowledge base
// (its subtree: descriptions, entries, ideas, people, open and recently closed tasks), or of all of it for
// «що ти про мене знаєш?». Small and to the point.
const req = $input.first().json;
// The whole base: every top-level place and every person.
const roots = knowledge().entities.filter((e) => e.status !== 'archived' && (!e.parent_id || e.kind === 'person')).map((e) => e.id);
const material = dossier(req.all ? roots : req.about, rowsOf('Get open tasks'), rowsOf('Get done tasks'), Date.now(), Boolean(req.all));
const system = `Ти — Lanora, особистий помічник власника. Відповідай на його питання за матеріалами нижче (його база
знань і справи). Українською, на «ти», по суті: що зараз відбувається, що відкрито й за ким, які ідеї, що нещодавно
зроблено. Можна робити висновки й узагальнення (інтереси, пріоритети, на що йде час, що висить), але факти — лише
з матеріалів, нічого не вигадуй. Говори як помічник, який це знає, без «у матеріалах / за даними». До ${req.all ? 1500 : 900} символів, можна списком «• ». Позначки t12 у reply не пиши.
targets — до 8 справ (t…), про які відповідь; sources — назви з матеріалів, з яких узяв (заголовки ##/###).
Зараз ${toIso(kyivNow())}.

МАТЕРІАЛИ:
${material}`;
return [{
  json: {
    ...req,
    // The whole base or several spheres at once is a broad question: the strong model; one place — the fast one.
    // `fallback` — the other model when the first one fails.
    model: req.all || req.about.length > 1 ? GEMINI_STRONG : GEMINI_FAST,
    fallback: req.all || req.about.length > 1 ? GEMINI_FAST : GEMINI_STRONG,
    key: geminiKey(),
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: req.question }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: RESEARCH_SCHEMA, temperature: 0.2, maxOutputTokens: 4096 },
    },
  },
}];
