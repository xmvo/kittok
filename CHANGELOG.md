# Changelog

## 0.1.0

- The Friends page, music pages, and search suggestions work; stories and playlists show their empty states; and the client's telemetry calls get quiet answers. Add a systemd user service for source installs.
- Forgot password works through the native reset screen, admins can turn off the sign-up email code, and your own videos' menu gets Pin to profile, Post settings, and Manage posts.
- Pin up to three videos to the top of your profile, and make the profile's Popular and Oldest sorting work.
- Fill the Explore category tabs: uploads pick a category or get one guessed from their hashtags.
- Native sign-up: the client's own email form with real emailed codes over SMTP, its age gate and Create username step, an Invite code field on invite-only instances, and email logins.
- Fit the admin console to phone screens and add a script that preloads every decoration image.
- Run the admin console inside the real client: its sidebar lists the admin sections, and pages use the client's own buttons, switches, tags, tabs and colors. Show the real verified check, put account actions in plain buttons instead of a three-dot menu, and hide community badges for now.
- Move pride flag editing into the native Edit profile dialog and drop the separate Profile badges button and the profile's three-dot menu.
- Add avatar decorations: all 644 of Discord's presets, picked from a searchable Edit avatar panel in Edit profile and drawn animated around avatars. Images are cached locally after the first request.
- Add an admin Misc page that switches Kittok's own features on and off. Show the verified check in the DM chat header, tell requesters when a private account approves them, replace the stuck You may like placeholders with "No suggestions yet", and hide chats with deleted accounts.
- Show follow requests in the native inbox with Accept and Delete, offer Repost in the share sheet, link @mentions in comments to the right profile, keep pride and community badges after the verified check in comments, and stop the analytics SDK's once-a-second retries.
- Fill the video page's related list and the Explore grid; Explore categories other than All stay empty because videos carry no topic labels.
- Link hashtags and @mentions in captions and comments, serve hashtag pages with video and view counts, and add mention notices to the Mentions inbox tab.
- Merge likes on the same video or comment into one notice with the newest two likers and a total, as the native inbox shows them.
- Label comments from the creator, accounts you follow and friends, and mark comments the creator liked.
- Add reposts with the native button, repost counts and the profile Reposts tab, and named Favorites collections with create, rename, privacy, add, move and delete.
- Add private accounts, pending follow requests with confirm/delete, per-post audiences, and account/post comment permissions. Enforce visibility in feeds, search, comments, activity, shared-video cards, and media requests; preserve explicit admin review access.
- Add native inbox 3 message requests with live delivery, acceptance, deletion, a three-message pending limit, and mutually enabled read receipts. Implement personal message deletion and sender-only unsending within three minutes.
- Add a dedicated upload screen with preview, caption counter, progress, privacy controls and a post manager; add account options and narrow-screen settings/chat layouts.
- Add optional public pride flags at signup, self-service profile badge editing, and admin-managed community badges. Show flags after native verified badges on profiles and posts, and group secondary admin account actions in a keyboard-accessible three-dot menu.
- Add admin-managed account verification with persistent badges, grant/remove controls, and an audit trail; prevent registration and profile edits from granting verification.
- Repair the native report reason/details flow and verify submission through its success screen.
- Organize admin report cards with contained previews and review dialogs; group secondary report, video, and account actions in keyboard-accessible menus.

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
