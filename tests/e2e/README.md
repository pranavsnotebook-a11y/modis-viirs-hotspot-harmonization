# End-to-end tests for the role screen

`start.spec.mjs` drives `web/start.html` in the Google Chrome already installed on the machine (`playwright-core`, `channel: 'chrome'`, headless). No browser is downloaded.

Run (the app server must be serving `web/`, by default at http://127.0.0.1:8000; override with `BASE_URL`):

    npm install
    npm run test:unit   # roles.js data and helpers, the <noscript> list
    npm run test:e2e    # about two minutes
    npm test            # both

If Chrome cannot be launched the script says so and exits with code 2 without running anything.

Screenshots of every state are written to `tests/e2e/shots/` (ignored by git). Looking at them is part of the test: the script cannot judge whether something looks cramped or cheap.

What it covers: stacked, dealing and shown states at 1440x900 and 390x844 in dark and light; titles and order; no overlap and nothing outside the viewport; animated properties limited to transform and opacity; text contrast and 44 px targets; keyboard only (Tab, Enter, Space, Escape); choosing a role, the saved role, the list; reduced motion; resizing, also mid-deal; no JavaScript; no console errors or failed requests.

`role.spec.mjs` covers `role.html`: the five roles at 1440x900 and 390x844 in dark and light, card flips by click and keyboard, the briefing (completes, survives a reload, is per role and region), a no-item day, blocked wind, missing feed or assets, region and language switches, redirects, the picker landing on the right page with `r=` carried, reduced motion, overflow, contrast and tap targets, page weight. Wind and INPE are replaced by deterministic stubs.
