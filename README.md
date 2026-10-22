# Kittok

Kitty tok. Your domain, your people, your videos.

Kittok is a self-hosted backend for TikTok's own desktop web client. The site looks and works like TikTok, but the accounts, videos and messages all live on your server. Think [Xitter](https://github.com/Xittered/xitter), but for TikTok. Every instance is its own thing, with its own database, accounts, media and settings.

It's early (0.1.0) and there are rough edges, but most of what people actually use works: the feed, uploads, likes, comments, follows, DMs and group chats, stories, private accounts, reports and moderation. [COMPATIBILITY.md](docs/COMPATIBILITY.md) has the full list.

## Hosting

You need Docker with Compose, a domain, and a reverse proxy that handles HTTPS.

```sh
tar -xzf kittok-0.1.0.tar.gz
cd kittok
npm run setup
```

No Node on the host? This does the same thing:

```sh
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:22-bookworm-slim node scripts/setup.mjs
```

Open `.env`, set `PUBLIC_ORIGIN` to your domain and pick an `INSTANCE_NAME`. The database password is already filled in. Leave registration closed until you've made your own account:

```sh
docker compose up -d --build
docker compose exec app node scripts/create-user.mjs yourname --admin
```

Point your proxy at `127.0.0.1:3210` (there's a [Caddy example](deploy/Caddyfile.example)). Log in through TikTok's normal login page: **Use phone / email / username**, then **Log in with email or username**.

On first start Kittok downloads TikTok's web client into its own cache and sets up the database. The client isn't part of this repo; each instance fetches its own copy.

A few extras you'll probably want, all covered in [HOSTING.md](docs/HOSTING.md):

- email, for sign-up codes and password resets (in `.env` or the admin panel)
- an IP security key: `npm run ip-key`
- Discord's collectibles catalog, for avatar decorations and nameplates (admin panel → Misc)

Other docs: [API](docs/API.md), [architecture](docs/ARCHITECTURE.md), [contributing](CONTRIBUTING.md).

## Running from source

You need Node 22+, PostgreSQL 18 and ffmpeg with libx264. The only npm dependency is `pg`.

```sh
npm ci
npm run setup
```

Create a database and put its URL in `.env` as `DATABASE_URL`, then:

```sh
npm run capture
npm run migrate
npm run user:create -- yourname --admin
npm start
```

For local use, keep `PUBLIC_ORIGIN=http://127.0.0.1:3210`. A new instance is empty: upload at `/account`, import a file with `npm run video:import -- yourname video.mp4 "caption"`, or run `npm run demo` for a generated test video.

## Tests

```sh
npm test
```

This makes a throwaway database, runs the real server against it with ffmpeg, and deletes the database afterwards. Your Postgres user needs permission to create databases; otherwise point `KITTOK_TEST_ADMIN_URL` at one that can. You need a captured client first (`npm run capture`).

## Source archive

`npm run source` builds `dist/kittok-0.1.0.tar.gz` from the source files only: no `.env`, database, uploads, cached TikTok files or `node_modules`. Instances serve it at `/source`, and Docker builds make it automatically. Rebuild it if you change your copy.

## License

Kittok is AGPL-3.0-or-later ([LICENSE](LICENSE)). TikTok's client belongs to TikTok and isn't included. The fonts in `public/fonts` are Discord's builds of open source fonts under the SIL Open Font License ([OFL.txt](public/fonts/OFL.txt)).
