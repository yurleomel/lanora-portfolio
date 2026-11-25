// One line of advice for the morning plan ("з чого почати"), from the plan itself — nothing invented.
const v = $input.first().json;
const plan = String(v.text || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const system = `Ти — Lanora, особистий помічник. Нижче ранковий план користувача на сьогодні (час київський, зараз ${kyivNow().toFormat('HH:mm')}).
Дай ОДНУ коротку пораду українською на «ти» (до 140 символів): з чого почати і як розкласти день навколо подій із часом.
🔴 — критична справа, 🟠 — важлива: якщо такі є, почни з них, навіть коли в іншої справи ранший дедлайн.
Називай КОНКРЕТНУ справу з плану («Почни з есе про музику»), а не «прострочені завдання» чи «справи».
Лише на основі плану: не вигадуй справ, часу чи деталей. Без привітання, без емодзі, без лапок, без списків — одне-два речення.`;
return [{
  json: {
    key: geminiKey(),
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: plan }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 300 },
    },
  },
}];
