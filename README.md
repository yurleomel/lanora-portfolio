# Lanora

Lanora is a personal Telegram assistant for Ukrainian-language tasks, reminders, and notes. It accepts text, voice messages, and photos, keeps a searchable knowledge base, and supports follow-ups such as “перенеси другу справу на завтра”.

## Try the code

Use Node.js 24 or later. The tests use an in-memory SQLite database and simulated Telegram and Gemini responses.

```sh
npm ci
npm test
```

## How it works

- **Telegram and scheduling** — `app/main.js` polls Telegram and runs reminders, recurring tasks, and digests on Kyiv time. Separate queues keep the scheduler responsive while requests are being processed.
- **Intent routing** — `bot/js/router_request.js` builds a structured Gemini request. `bot/js/check_reply.js` checks the reply, and `bot/js/interpret.js` turns it into actions. Relative dates, scheduling, and state transitions are handled in JavaScript.
- **Storage and undo** — `app/db.js` stores tasks, dialogue context, and knowledge-base records in SQLite. The bot records the prior state when it applies a change so the user can undo it.
- **Migration from n8n** — `app/runtime.js` provides a small compatibility layer for the original workflow scripts, so the service can run in Node.js while reusing the tested rules.

## Run your own instance

```sh
cp -n .env.example .env
mkdir -p local-data
node --env-file=.env app/main.js
```

Fill in `.env` before starting. Set `TELEGRAM_BOT_TOKEN` and `BOT_USERNAME` to the values for a bot you control, using the username without `@`. Set `OWNER_ID` to your numeric Telegram user ID and `GEMINI_KEYS` to one or more comma-separated Gemini API keys. Use a fresh bot for testing because Lanora uses long polling. `DB_PATH` selects the local SQLite file.

Use the bot in a private Telegram chat. To interpret a request, Lanora can send the message, media, and relevant task or knowledge-base context to the Gemini API. For a demo, use fictional tasks and notes.
