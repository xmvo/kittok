# Current compatibility

Version 0.1.0 establishes an independently hostable server and persistent data. The original web client remains a moving compatibility target.

| Feature | Backend | Original client |
| --- | --- | --- |
| Guest For You feed | PostgreSQL-backed, cursor pagination | Original feed/player verified with local data |
| Local video playback and seeking | MP4 stream, HTTP ranges | Verified in the original player |
| Accounts and sessions | Scrypt passwords, hashed sessions, CSRF | Original username/password form, errors, local redirect, signed-in navigation, avatar dropdown, refresh persistence, and native logout confirmation verified |
| Registration | Closed, invite-only, open | Kittok registration fallback at `/account?register=1`; native signup is not integrated |
| Uploads | Authenticated, size/duration bounds, ffmpeg transcoding | Kittok account screen; original Upload link redirects there |
| Likes, favorites, follows, comments | Persistent Kittok API | Some compatibility handlers exist; native gestures are not yet fully verified |
| Profile and item detail | Response adapters and authored data | Own profile opens from the native account dropdown and survives refresh; editing and remaining profile interactions need integration |
| User search | Local SQL lookup and response adapter | Needs browser acceptance checks |
| Video search, notifications, DMs, LIVE, shop, coins | Not implemented | Visible original controls do not imply working features |
| Moderation and admin panel | Operator CLI and admin debug routes only | Full administration UI remains to be built |

The client can emit nonfatal errors for unsupported service calls. Unknown APIs return HTTP 501 and are counted in `/_debug/unknown` for logged-in administrators. API success alone does not establish a working screen. Browser verification and database tests must be reported separately.

The original login choices and layout are retained. Google, Apple, Facebook, QR, phone/SMS, email codes, and password reset are not configured. Unconfigured external/QR providers remain visible with disabled accessibility state and an availability tooltip. Kittok authenticates local usernames and passwords only.

The server supplies the original client's `webapp.app-context.user` from the current database session, including its native `uid`, `secUid`, `uniqueId`, `nickName`, and `avatarUri` fields. Signed-in controls come from the original client. The native logout confirmation submits a CSRF-protected local Passport request. Session HTML and the bridge are never cached.

Next work: verify each native social interaction, integrate profile editing and remaining profile/search interactions, then add moderation and operational features before inviting an untrusted public community.
