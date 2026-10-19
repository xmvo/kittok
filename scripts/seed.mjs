import { mkdir, access, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { Root } from '../src/client/archive.mjs';
import { LoadConfig } from '../src/config.mjs';
import { Database, Migrate } from '../src/db.mjs';
import { CreateUser, Token } from '../src/auth.mjs';
import { ImportVideo } from '../src/media.mjs';

const Config = LoadConfig();
const Media = Config.MediaDir;
await mkdir(Media, { recursive: true });
async function Exists(Path) {
	try { await access(Path); return true; } catch { return false; }
}
const Video = join(Media, 'demo.mp4');
if (!await Exists(Video)) {
	const Run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error',
		'-f', 'lavfi', '-i', 'testsrc2=size=720x1280:rate=24:duration=8',
		'-f', 'lavfi', '-i', 'sine=frequency=330:duration=8',
		'-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p',
		'-c:a', 'aac', '-shortest', '-movflags', '+faststart', '-n', Video], { stdio: 'inherit' });
	if (Run.error || Run.status !== 0) throw new Error('DemoVideoNeedsFFmpegWithLibx264');
}
const Images = {
	'avatar.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" rx="100" fill="#20d5ec"/><text x="100" y="126" font-size="70" font-family="sans-serif" text-anchor="middle" fill="#111">LC</text></svg>',
	'cover.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#121421"/><circle cx="360" cy="510" r="160" fill="#25f4ee"/><text x="360" y="800" font-size="48" font-family="sans-serif" text-anchor="middle" fill="white">Our first local video</text></svg>',
};
for (const [Name, Body] of Object.entries(Images)) {
	if (!await Exists(join(Media, Name))) await writeFile(join(Media, Name), Body);
}
console.log('Local demo video, cover, and avatar ready.');

const Pool = Database(Config.DatabaseUrl);
try {
	await Migrate(Pool);
	let User = (await Pool.query("SELECT id FROM users WHERE username = 'localcreator'")).rows[0];
	if (!User) User = await CreateUser(Pool, { username: 'localcreator', displayName: 'Local Creator', password: Token() }, 'closed', true);
	const Existing = await Pool.query("SELECT id FROM videos WHERE author_id = $1 AND description = 'Our first local video #kittok'", [User.id]);
	if (!Existing.rowCount) await ImportVideo(Pool, Config, User.id, Video, 'Our first local video #kittok');
	console.log('Demo is stored in PostgreSQL. Create your own login with npm run user:create.');
} finally { await Pool.end(); }
