# Kittok

Kitty tok. Your domain, your community, your videos.

Kittok is a self-hosted backend for the original TikTok desktop web client, inspired by [Xitter](https://github.com/Xittered/xitter). Anyone can download the source and host an independent instance on their own website. Each installation owns its PostgreSQL database, accounts, media, settings, and client cache.

**Status: early development, version 0.1.0.** The hosting foundation, original TikTok username/password login page, local accounts, uploads, and persistent API are implemented. Compatibility with the original client is being added screen by screen. See [current coverage](docs/COMPATIBILITY.md).

## Host an instance

Requirements: Docker with Compose, a domain pointed at your server, and an HTTPS reverse proxy. Linux hosting is the documented path.

Extract the source archive, then generate `.env`:

```sh
tar -xzf kittok-0.1.0.tar.gz
cd kittok
# With Node.js 22+ installed:
npm run setup
# Or use Node in Docker instead:
# docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:22-bookworm-slim node scripts/setup.mjs
```

Edit `.env`. Set `PUBLIC_ORIGIN=https://your-domain.example` and choose your `INSTANCE_NAME`. The setup command already generated a database password. Leave registration closed until your owner account is ready.

```sh
docker compose up -d --build
docker compose exec app node scripts/create-user.mjs yourname --admin
```

Point your reverse proxy at `127.0.0.1:3210`; [a Caddy example](deploy/Caddyfile.example) is included. Open your domain and use **Log in** to open the original TikTok login page, backed by this instance’s accounts. Choose **Use phone / email / username**, then **Log in with email or username** and enter your local username. Uploads are available at `/account` after login.

The first startup downloads the public signed-out feed and login clients into the instance's persistent cache and applies database migrations. The source archive and image contain Kittok's server source; each installation obtains its own client assets.

[Full hosting instructions](docs/HOSTING.md) · [API](docs/API.md) · [Architecture](docs/ARCHITECTURE.md) · [Compatibility](docs/COMPATIBILITY.md)

## Run from source

Requires Node.js 22+, PostgreSQL 18, and ffmpeg/ffprobe with libx264. PostgreSQL 18 is the deployment target tested by this version. There is one npm runtime dependency, `pg`, pinned in the lockfile.

```sh
npm ci
npm run setup
# Create a PostgreSQL database and set DATABASE_URL in .env.
npm run capture
npm run migrate
npm run user:create -- yourname --admin
npm start
```

For a local instance, keep `PUBLIC_ORIGIN=http://127.0.0.1:3210`. An empty instance has no videos. Upload at `/account`, import with `npm run video:import -- yourname /path/to/video.mp4 "Caption"`, or run `npm run demo` to generate a synthetic test video and persist a fictional creator. No real TikTok accounts or videos are imported.

## Project layout

```text
src/
  server.mjs          HTTP routing, lifecycle, and security boundaries
  config.mjs          Instance configuration
  db.mjs              PostgreSQL pool and migration runner
  auth.mjs            Passwords, sessions, registration, invites, CSRF
  store.mjs           Queries and TikTok response adapters
  media.mjs           Bounded uploads, transcoding, media streaming
  client/             Captured-client adaptation and browser bridge
  routes/             Kittok API, compatibility API, account pages
migrations/           Ordered, checksummed SQL migrations
public/               Kittok account UI and kitty mark
scripts/              Setup, owner tools, capture, tests, source archive
deploy/               Container startup, health check, reverse proxy example
docs/                 Hosting, API, architecture, compatibility
```

Runtime files (`.env`, `client/`, `media/`, `node_modules/`) stay out of the downloadable source. Videos live on disk; relational data lives in PostgreSQL. Each instance has its own origin and host-only session cookies. Cross-instance federation is outside this version's scope.

## Validation and source packages

```sh
npm test
npm run source
```

Tests create a temporary PostgreSQL database, exercise the real HTTP server and ffmpeg, then remove only that temporary database. The configured PostgreSQL user needs permission to create test databases; use `KITTOK_TEST_ADMIN_URL` for a separate development server if necessary. Tests require a captured client and ffmpeg. Browser checks are tracked separately from API checks.

`npm run source` writes `dist/kittok-0.1.0.tar.gz` using an explicit source-file allowlist. It excludes instance secrets, database data, uploads, cached TikTok assets, and installed dependencies. `/source` serves that archive when available; container builds generate it automatically. Regenerate the archive when you modify a source installation.

Kittok's original server source is licensed under [AGPL-3.0-or-later](LICENSE). Downloaded third-party client assets have their own ownership and are excluded from this source distribution.
