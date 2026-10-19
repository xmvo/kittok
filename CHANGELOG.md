# Changelog

## 0.1.0

- Hydrate the original client's signed-in user state from local sessions, render its native avatar menu and own profile, and connect native logout confirmation to session revocation.
- Remove the account button text workaround and prevent stale bridge caching.
- Capture and serve the original standalone TikTok login application, preserve its fonts/layout, and authenticate its username/password form against local accounts.
- Keep native success redirects local and expose unavailable external/QR providers with an accessible disabled state.

- Name the project Kittok and organize the server, compatibility layer, routes, owner tools, migrations, and documentation.
- Add PostgreSQL persistence for accounts, sessions, invites, videos, and social data.
- Add local account/login/upload screens and bounded ffmpeg transcoding.
- Add a Kittok API and database-backed original-client feed adapters.
- Add configurable origins and instance identity, Docker Compose, persistent volumes, and health checks.
- Add owner commands, self-hosting and backup documentation, an AGPL license, and source archives that exclude instance data and cached third-party assets.
- Add isolated PostgreSQL and HTTP integration tests, including restart persistence.
