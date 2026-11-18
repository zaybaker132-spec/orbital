# Languages

Orbital speaks English, Spanish, French, Portuguese and German.

**Where to change it:** Settings → Language (or the globe on the sign-in and waitlist pages). "Match this device"
follows the computer's language. The choice is saved to your account, so it follows you to other devices.

**What changes**

- The whole interface: menus, buttons, messages, empty states, toasts.
- Orbital's own writing: chat answers, research reports, hypothesis verdicts, project briefs, opportunities and
  extracted knowledge. The app sends the language with every request (`x-orbital-language`), and the server adds
  one instruction to the AI's system prompt. Work that finishes later (research, extraction) keeps the language of
  the person who started it.
- Voice: dictation listens in that language, and spoken answers use a system voice for it.
- Dates and times: "Today 6:00 PM", "3 h ago", and calendar dates follow the language's conventions.

**What stays as it is:** anything you write and documents you import keep their own language, and quotes from
sources are never translated. Scheduled automations write in English. A few server messages are English.

## How it works

Text is written in English in the code and wrapped: `tx("New conversation")`, `tx("{n} for review", { n })`, and
`tn(n, "{n} source", "{n} sources")` for plurals (using each language's plural rules). `src/i18n/index.ts` looks the
English text up in `src/i18n/locales/<lang>.json`; anything missing falls back to English, so nothing breaks.

## Adding or changing text

1. Wrap new interface text in `tx()` (or `tn()` for counts). Write whole sentences, not fragments joined around
   values — put the value in a `{placeholder}` so each language can order the sentence its own way.
2. `npm test` fails on any string without a translation and tells you which ones.
3. Add `id|translation` lines to `scripts/i18n/<lang>.txt` (new ids go in `scripts/i18n/ids.json`;
   `node scripts/i18n-extract.cjs` lists every string), then rebuild:
   `node scripts/i18n-build.cjs scripts/i18n/ids.json es scripts/i18n/es.txt` (and fr, pt, de).
   The build checks every translation keeps the same placeholders.

## Adding a language

Add it to `LANGUAGES` in `src/i18n/index.ts` and `LANGUAGE_NAMES` in `server/lib/language.ts`, add it to the
`language` preference in `server/routes/workspace.ts`, write `scripts/i18n/<code>.txt`, build its catalog, and add
it to the list in `server/test/i18n.test.ts`.
