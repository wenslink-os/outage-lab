# Contributing

Thank you for helping. Outage Lab stays free, offline-first and dependency-free at runtime.

## Ground rules

- No paid services, API keys, trackers, external fonts or CDN scripts in `web/`. The test suite fails if the page loads anything from another origin.
- Keep `web/core/` free of DOM and Node APIs so it runs in both the page and the tests.
- Any change to features or fallbacks must keep `tests/consistency.test.js` passing: the engine's table must describe what the client code really does.
- Every UI string needs an English and an Assamese entry in `web/core/i18n.js`. Placeholders must match.
- When you change a file in `web/`, bump `VERSION` in `web/sw.js`, and add new files to its `ASSETS` list.

## Workflow

```sh
npm ci
npm run check
npm start
```

1. Open an issue describing the change, especially for new features or failure types.
2. Keep pull requests focused on one change.
3. Include tests for new behaviour and describe how you checked the UI in a real browser.

## Adding a language

Copy the `en` block in `web/core/i18n.js`, translate every value, add the code to `LANGUAGES`, and update the language button in `web/ui/app.js`.

## Adding a feature to the sample app

1. Declare it in `web/core/features.js` for both designs.
2. Implement the step in both clients in `web/core/clients.js` and add it to the journey.
3. Add labels in `web/core/i18n.js`.
4. Run `npm run check` and update the results table in `README.md`.

By contributing you agree that your contribution is licensed under the MIT license.
