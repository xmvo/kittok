# Contributing to Kittok

Thanks for helping. Kittok is a self-hosted backend for the original TikTok desktop web client, so most work is one of two things: making a screen of the client work against local data, or improving the instance around it (moderation, the admin console, hosting).

## Getting set up

You need Node.js 22+, PostgreSQL 18, and ffmpeg/ffprobe with libx264.

```sh
npm run setup          # writes .env with a database password
npm run migrate
npm run user:create -- yourname --admin
npm start              # http://127.0.0.1:3210
```

The first start downloads the client into `client/`. Nothing from the client is committed.

## Running the tests

```sh
npm test
```

Tests create a throwaway `kittok_test_*` database, start a real server against it, and drop it afterwards, so they never touch your instance's data. All tests should pass before you open a pull request.

## How the code is laid out

- `src/routes/compatibility.mjs`: the API the original client calls (`/api/...`, `/aweme/...`, `/tiktok/...`).
- `src/routes/im.mjs`: direct messages over the client's protobuf IM protocol and `/ws/v2`.
- `src/routes/admin.mjs` + `public/admin.js`: the Trust & Safety console at `/admin`.
- `src/store.mjs`, `src/privacy.mjs`, `src/moderation.mjs`: shared queries and rules.
- `src/client/`: the shell and bridge injected into the cached client.
- `public/`: Kittok's own pages, scripts and styles.
- `migrations/`: plain numbered SQL files, applied in order and never edited after release.

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for more.

## Adding client compatibility

1. Open the screen in the client and note which requests fail (unknown APIs return 501 and are counted at `/_debug/unknown` for admins).
2. Read the cached client bundle in `client/assets` to find the exact parameters and response fields it uses. Don't guess shapes.
3. Implement the route, add an integration test for it, and check the screen in a real browser.
4. Update [COMPATIBILITY.md](docs/COMPATIBILITY.md). Say what you verified in the browser and what is only covered by tests; they aren't the same thing.

Features Kittok adds on top of the client should get a switch on the admin **Misc** page (`MiscFeatures` in `src/settings.mjs`).

## Style

- Tabs, ES modules, PascalCase names (including locals and parameters).
- Short comments, only where the code can't explain itself (usually a client quirk).
- No new dependencies without a good reason; there is one (`pg`) today.
- Error identifiers are short PascalCase strings, like `VideoNotFound`.
- When routes change, update [API.md](docs/API.md) and [COMPATIBILITY.md](docs/COMPATIBILITY.md), and add a line to [CHANGELOG.md](CHANGELOG.md).

## Pull requests

- Keep each PR to one change, with a commit message that says what changed and why.
- Include a test for anything behavioral.
- Database changes go in a new migration file.
- Don't commit `.env`, `client/`, `media/` or `data/`.

## Security

Please don't open public issues for vulnerabilities. Contact the maintainer privately through GitHub instead.

## License

By contributing you agree your work is licensed under the [AGPL-3.0-or-later](LICENSE).
