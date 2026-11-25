const r = $('Context').first().json;
const t = $input.first().json;
const base = { query_id: r.query_id, chat_id: r.chat_id, message_id: r.message_id, action: r.action, log_role: 'bot', kind: 'undo', status_a: 'new' };
const nowMs = Date.now();
const ref = t && t.id ? `t${t.id}` : '';

if (!t || !t.id) {
  return [{ json: { ...base, action: 'noop', id: -1, row: {}, ops: '', toast: 'Задачу не знайдено', text: '⚠️ Цієї задачі вже немає.', log_text: 'задачу не знайдено', log_ids: '' } }];
}
const title = esc(t.title);
const keep = pick(t, TASK_COLS);
const ops = JSON.stringify([snapshot('task', t)]);
const out = (data) => [{ json: { ...base, id: t.id, ops, user_text: `кнопка ${r.action} для «${t.title}»`, ...data } }];

if (r.action === 'edit') {
  return out({
    row: keep, toast: 'Напиши, що змінити',
    text: `✏️ Що змінити в «${title}»?\nПросто напиши: <i>перенеси на четвер 15:00</i>, <i>до кінця дня</i>, <i>нагадуй щодня о 9</i>, <i>додай в опис …</i>${hiddenRef(ref)}`,
    log_text: `спитав, що змінити в ${ref} «${t.title}»`, log_ids: ref,
  });
}
if (r.action === 'later') {
  return out({ row: keep, toast: 'Коли нагадати?', text: `⏰ Коли нагадати про «${title}»?${hiddenRef(ref)}`, log_text: `спитав, коли ще раз нагадати про ${ref}`, log_ids: ref });
}
if (t.status !== 'open') {
  const was = t.status === 'done' ? '✅ Вже виконано' : t.status === 'past' ? '🕓 Вже минуло' : '🗑 Вже видалено';
  return out({ action: 'noop', row: keep, toast: was, text: `${was}: <s>${title}</s>${hiddenRef(ref)}`, log_text: `${ref} вже закрита`, log_ids: ref });
}
if (r.action === 'done') {
  const c = completeRow(t, nowMs);
  const cheer = doneReaction(doneToday(rowsOf('Get dialog'), nowMs), [t], rowsOf('Get open tasks'), nowMs);
  const parent = finishedParent([t], rowsOf('Get open tasks'));
  const text = (c.rolled ? `✅ <b>${title}</b>\nНаступного разу: ${when(c.next)}` : `✅ <s>${title}</s>`) + (cheer ? `\n${cheer}` : '')
    + (parent ? `\nУсі кроки «${esc(parent.title)}» готові. Закрити й саму справу? /t${parent.id}` : '');
  return out({ row: c.row, toast: cheer || (c.rolled ? 'Готово, до наступного разу' : 'Готово ✅'), text: text + hiddenRef(ref), log_text: `${DONE_LOG} ${ref} «${t.title}» кнопкою`, log_ids: ref });
}
if (r.action === 'del') {
  return out({ row: { ...keep, status: 'deleted', next_ts: null }, toast: 'Видалено', text: `🗑 <s>${title}</s>${t.repeat ? ' (усю серію)' : ''}${hiddenRef(ref)}`, log_text: `користувач видалив ${ref} «${t.title}»`, log_ids: ref });
}
if (r.action === 'snz') {
  const next = snoozeTo(r.arg, nowMs);
  const w = when(DateTime.fromMillis(next, { zone: TZ }));
  return out({ row: { ...keep, next_ts: next }, toast: `Нагадаю ${w}`, text: `⏰ <b>${title}</b>\nНагадаю ${w}${hiddenRef(ref)}`, log_text: `відклав ${ref} «${t.title}» до ${w}`, log_ids: ref });
}
return out({ action: 'noop', row: keep, toast: 'Невідома дія', text: `<b>${title}</b>${hiddenRef(ref)}`, log_text: 'невідома дія', log_ids: ref });
