// Every 10 minutes: short summaries of the big places whose knowledge changed, then the owner's profile from them.
// Nothing changed — no request (an empty list), so Gemini is not called.
const work = summaryWork(profile());
if (!work) return [];
const ask = work.kind === 'summaries'
  ? {
    system: `Стисни знання власника про кожне місце нижче до 3–6 рядків (до 500 символів): що це, що там зараз відбувається,
ключові факти й записи, які є ідеї (назвами), люди з ролями. Українською, по суті, лише з матеріалу, нічого не вигадуй.
Поверни масив {id, summary} — по одному на кожне місце (id — число з заголовка [id]).`,
    text: work.batch.map((c) => `### [${c.id}] ${c.path}\n${c.text}`).join('\n\n'),
    schema: SUMMARY_SCHEMA,
  }
  : {
    system: `Склади профіль власника за підсумками його сфер і людей нижче: 5–8 рядків (до 900 символів) — чим він живе
(навчання, робота, бізнес, хобі), що зараз у фокусі, ключові люди й ролі. Українською, на «ти», лише з матеріалу.
Поверни один елемент масиву з id = 0 і текстом у summary.`,
    text: work.material,
    schema: SUMMARY_SCHEMA,
  };
return [{
  json: {
    ...work,
    model: GEMINI_FAST,
    fallback: GEMINI_STRONG,
    key: geminiKey(),
    body: {
      systemInstruction: { parts: [{ text: ask.system }] },
      contents: [{ role: 'user', parts: [{ text: ask.text }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: ask.schema, temperature: 0.2, maxOutputTokens: 4096 },
    },
  },
}];
