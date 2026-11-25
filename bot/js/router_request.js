const r = $('Context').first().json;
const audioB64 = $input.first().json.audio_b64 || '';
const nowMs = Date.now();
const now = kyivNow();
const open = rowsOf('Get open tasks');
const notes = rowsOf('Get notes ctx');
const dialog = rowsOf('Get dialog').sort((a, b) => a.ts - b.ts);
const vault = vaultNotes();

// Examples use real dates from the current calendar, so the model never copies placeholders.
const today = now.startOf('day');
const D = (dt, hm) => `${dt.toFormat('yyyy-LL-dd')}T${hm}:00${dt.set({ hour: 12 }).toFormat('ZZ')}`;
let nov30 = DateTime.fromObject({ year: now.year, month: 11, day: 30 }, { zone: TZ });
if (nov30 < today) nov30 = nov30.plus({ years: 1 });
const nextMonday = today.plus({ days: ((8 - today.weekday) % 7) || 7 });
const tmr = logicalTomorrow(now);
const day = (dt) => dt.toFormat('yyyy-LL-dd');
// Only the fields that matter: ROUTER_SCHEMA itself makes the model fill the rest.
const EXAMPLES = `Приклади (дати — з календаря вище):
«купити молоко» → {"intent":"create","items":[{"type":"task","title":"Купити молоко","reminder_type":"none"}]}
«подумати стратегію атлас, які таски будем тестити. до 30.11» → {"intent":"create","items":[{"type":"task","title":"Стратегія Атлас","description":"Подумати, які таски будемо тестувати.","deadline":"${D(nov30, '23:59')}","reminder_type":"once","area":"Атлас"}]}
«щопонеділка о 10 пара з дизайну» → {"intent":"create","items":[{"type":"event","title":"Пара з дизайну","starts_at":"${D(nextMonday, '10:00')}","reminder_type":"once","repeat":{"freq":"weekly","weekdays":[1]}}]}
«написати Денису про замовлення паперу до ${tmr.toFormat('dd.LL')}» → {"intent":"create","items":[{"type":"task","title":"Написати Денису про замовлення паперу","deadline":"${D(tmr, '23:59')}","reminder_type":"once","context":["@Денис"],"area":"Майстерня"}]}
«ідея: зробити опитування студентів, як Оля казала» → {"intent":"create","items":[{"type":"note","title":"Опитування студентів","description":"Ідея: зробити опитування студентів, як казала Оля.","tags":["ідея"],"place":"Дослідження","new_note":true}]}
«для майстерні ще можна продавати каву зранку» → {"intent":"create","items":[{"type":"note","title":"Кава зранку","description":"Продавати каву зранку.","place":"Майстерня","new_note":false}]}
«заведи в Спільнота розділ витрати: квитки на концерт 40 $, Олена віддасть половину» → {"intent":"create","items":[{"type":"note","title":"Квитки на концерт","description":"Квитки на концерт — 40 $, Олена віддасть половину.","place":"Витрати","new_note":false}],"kb":[{"op":"create","kind":"topic","name":"Витрати","parent":"Спільнота"}]}
(бот спитав, хто це — Оля, і записав людину Оля) «Оля подруга, теж зі мною в спільноті» → {"intent":"create","items":[{"type":"note","title":"Оля","description":"Подруга, теж зі мною в спільноті.","place":"Оля","new_note":false}],"kb":[{"op":"link","person":"Оля","target":"Спільнота","role":"подруга"}]}
(відкриті t31 «Подзвонити в деканат», t32 «Звіт по практиці») «${tmr.toFormat('dd.LL')} о 10 я на парі, о 10 15 нагадай подзвонити в деканат, потім через годину ще пара і там зроблю звіт, а о 13 нагадай купити каву» → {"intent":"create","items":[{"type":"task","title":"Купити каву","reminder_type":"once","remind_at":"${D(tmr, '13:00')}"}],"edits":[{"target":"t31","set":{"remind_at":"${D(tmr, '10:15')}"}},{"target":"t32","set":{"remind_at":"${D(tmr, '11:00')}"}}]}
(відкриті t2 «Есе про музику», t8 «Гра в настільні ігри», t11 «Купити молоко») «есе здав, гру перенеси на 21, а молоко вже не треба» → {"intent":"edit","edits":[{"target":"t8","set":{"starts_at":"${D(today, '21:00')}"}}],"done":["t2"],"removed":["t11"]}
«перенеси гру на 21» (21 — година, не число) → {"intent":"edit","edits":[{"target":"t8","set":{"starts_at":"${D(today, '21:00')}"}}]}
(бот щойно створив t12 «Есе про музику») «зміни дедлайн тої таски до кінця дня» → {"intent":"edit","edits":[{"target":"t12","set":{"deadline":"${D(today, '23:59')}"}}]}
(відкриті t5 «Зустріч команди», t14 «Зустріч з куратором») «перенеси зустріч на 19» → {"intent":"clarify","targets":["t5","t14"],"reply":"Яку зустріч перенести?"}
(бот показав «№1 → t2 «Есе»; №2 → t5 «Зустріч»») «другу видали» → {"intent":"delete","targets":["t5"]}
(о 16:00 бот «нагадав про t12 «Есе про музику»») «через пів години» → {"intent":"edit","edits":[{"target":"t12","set":{"remind_at":"${D(today, '16:30')}"}}]}
(бот закрив t9 «Студія», користувач натиснув «Скасувати», потім бот закрив t24 «Написати Олі») «ти помилився?» → {"intent":"answer","reply":"«Студію» я закрив помилково — ти скасував, вона знову відкрита. Закрито: «Написати Олі».","targets":["t9","t24"]}
«що на завтра?» → {"intent":"query","query":{"view":"day","date":"${day(tmr)}"}}
«перенеси все незроблене на завтра» → {"intent":"move_pending"}
«коли дедлайн по есе?» → {"intent":"answer","reply":"Есе про музику — сьогодні до 08:00, вже прострочено на 2 год.","targets":["t12"]}
«доручили Олексію - оце видали» → {"intent":"edit","kb":[{"op":"forget","text":"доручили Олексію"}]}
«що там із проєктом Атлас?» → {"intent":"answer","about":["Атлас"]}
«що ти про мене знаєш?» → {"intent":"answer","about":["ВСЕ"]}
«що таке медіана?» → {"intent":"answer","reply":"Медіана — середнє значення впорядкованого ряду: половина чисел менша, половина більша. Для 1, 3, 10 це 3."}
«яка погода у Львові завтра?» → {"intent":"answer","web":"погода Львів завтра"}
«привіт» → {"intent":"chat","reply":"Привіт! Що запишемо?"}`;

const system = `Ти — Lanora, розумний особистий помічник у Telegram. Користувач пише або надиктовує українською
(іноді з одруківками, без розділових знаків, суржиком). Зрозумій, ЩО він хоче, і поверни JSON за схемою.

${ROUTER_RULES}

${ITEM_RULES}

${TEXT_RULES}

${kbMap(vault)}

${dateRules(now)}

${EXAMPLES}

${contextBlock(open, notes, dialog, nowMs)}
${kbMentionsLine(vault, r.text || '')}`;

let intro = '';
if (r.reply) intro += `[Це відповідь на повідомлення бота${r.reply.ref ? ` про ${r.reply.ref}` : ''}: «${r.reply.text}»]\n`;
if (r.forwarded) intro += '[Переслане повідомлення]\n';

const MEDIA_HINT = `[Користувач надіслав фото або документ${r.text ? ` з підписом «${r.text}»` : ''}.
Уважно прочитай його і витягни ВСІ справи, події й нотатки (intent "create", items):
- розклад занять/графік → події з repeat (weekly, потрібні дні тижня й час; аудиторію чи викладача — в description);
- оголошення, афіша, запрошення → подія з датою й часом;
- чек, рахунок, квитанція → задача «оплатити …» з дедлайном, якщо є, або нотатка з сумою;
- скрін переписки/нотатки → задачі або нотатка за змістом.
Тексти — українською, назви короткі. Якщо на зображенні нічого корисного — intent "chat" і коротко скажи, що там.]`;

const parts = [];
if (r.voice) {
  parts.push({ text: `${intro}[Голосове повідомлення: розшифруй дослівно в heard і обробляй як текст користувача]` });
  parts.push({ inline_data: { mime_type: String(r.mime || 'audio/ogg').split(';')[0], data: audioB64 } });
} else if (r.media) {
  parts.push({ text: `${intro}${MEDIA_HINT}` });
  parts.push({ inline_data: { mime_type: String(r.mime || 'image/jpeg').split(';')[0], data: audioB64 } });
} else {
  parts.push({ text: `${intro}${r.text}` });
}

// Long messages are plans with several parts («о 8:30 я на парі, о 8:45 нагадай…»): the fast model silently drops
// some of them, so they go to the strong one straight away (~10–15 s instead of ~2 s, but nothing is lost).
const LONG_WORDS = 25;
const LONG_VOICE_SEC = 20;
const long = r.voice ? Number(r.duration) >= LONG_VOICE_SEC : String(r.text || '').split(/\s+/).filter(Boolean).length >= LONG_WORDS;
const model = r.media || long ? GEMINI_STRONG : GEMINI_FAST;

return [{
  json: {
    chat_id: r.chat_id,
    model,
    // An unusable reply is asked again from the other model (on the same, working key).
    fallback: model === GEMINI_STRONG ? GEMINI_FAST : GEMINI_STRONG,
    key: geminiKey(),
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      // The strong model (photos, and the fallback for text) "thinks", and its thinking counts against the budget:
      // with 4096 a long plan message came back as cut-off JSON.
      generationConfig: { responseMimeType: 'application/json', responseSchema: ROUTER_SCHEMA, temperature: 0, maxOutputTokens: 8192 },
    },
  },
}];
