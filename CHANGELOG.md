# Changelog

## 0.1.0

- TikTok Studio at `/tiktokstudio`: the real creator dashboard with key metrics and charts from your views, likes, comments and followers, your posts list (search, sort, privacy, pin and delete), and your comments with filters and replies. Studio's Upload button opens Kittok's upload page.
- Unknown pages go to TikTok's real 404 page (`/404?fromUrl=...`), and the admin panel no longer sometimes lands on it instead of loading.
- The repo and Docker image now ship the copy of TikTok's web client Kittok is built against, instead of downloading TikTok's latest on first start, which broke new instances whenever TikTok updated.
- Avatar decorations and nameplates are no longer shipped: import Discord's collectibles catalog from the admin panel's Misc page (upload or URL) or with `npm run collectibles`. The Discord fonts now ship with their Open Font License notices.
- The admin panel says "Server is outdated, please restart" when Kittok's code changed on disk but the server hasn't been restarted, instead of a page error.
- Set the default profile photo for new accounts and the mail server (with a test email) from the admin panel's Instance page. The SMTP password is stored encrypted. Admins see "User has opted out from their ip being visible" for people who said they mind, and can't reveal their IPs.
- IP addresses are no longer stored in plaintext: they're kept as keyed hashes for matching alt accounts, and sealed to an owner-made security key only for people who say they don't mind. Admins see IPs blurred and only after entering the key, and alts without the IP. Everyone is asked once, and can change it under IP address in their account.
- The @mention picker in comments lists the people you follow and searches by name, instead of a server error toast when a video opens. Nameplates also show on comments in the video popup.
- Discord display name styles and nameplates: pick a font, an effect (Solid, Gradient, Neon, Toon, Pop, Gummy or Prism) and colors from presets or a hue slider in Edit profile, and a nameplate that shows behind your comments and in other people's messages list.
- Stories: share a video to your story from the upload page and it shows in the stories tray for 24 hours, with TikTok's rings, player, and list of who watched.
- Download video from the right-click menu or the share panel saves a copy with a Kittok watermark: the logo and @username move from the top-left to the bottom-right halfway through, then an end card shows the logo and username, like TikTok's. A Downloads switch in Settings > Privacy lets you turn it off for your videos.
- Group chats with up to 32 friends: start one from the new button in Messages, then add people, rename it, remove people (owner), or leave from the group button in the chat. They use the client's own group inbox, names, and notices.
- Admins see the photo or video in reported direct messages.
- Send photos and short videos in direct messages with the native media button. They show up as TikTok's own photo and video cards, blurred for the recipient until tapped, and only people in the chat can open them. An admin switch turns it off.
- Download your data from Settings: pick everything or just some of it, TXT or JSON, and get a ZIP laid out like TikTok's export that also has your own videos. Downloading asks for your password, and files expire after 4 days.
- Deactivate or delete your account from the native Settings page, with TikTok's 30-day window to change your mind by logging back in. Deleting someone who made invites no longer fails, and banned or deactivated accounts stay out of user search.
- Emoji reactions on direct messages through the client's own reaction picker, pushed live to the other person, and replies that keep their quoted message.
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
