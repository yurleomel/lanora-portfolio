// Error workflow: tells the owner in Telegram that something failed, in plain words.
const e = $input.first().json;
const wf = (e.workflow && e.workflow.name) || 'бот';
const node = (e.execution && (e.execution.lastNodeExecuted || (e.execution.error && e.execution.error.node && e.execution.error.node.name))) || (e.trigger && 'тригер') || '?';
const msg = clip(((e.execution && e.execution.error) || e.trigger?.error || {}).message || 'невідома помилка', 300);
const id = e.execution && e.execution.id;
return [{
  json: {
    chat_id: OWNER_ID,
    text: `⚠️ <b>Щось пішло не так</b> у «${esc(wf)}».\nКрок: ${esc(node)}\n<i>${esc(msg)}</i>\n\nСпробуй ще раз. Якщо повториться — скажи Claude${id ? ` (запуск №${id})` : ''}.`,
  },
}];
