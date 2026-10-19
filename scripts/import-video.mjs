import { resolve } from 'node:path';
import { LoadConfig } from '../src/config.mjs';
import { Database, Migrate } from '../src/db.mjs';
import { FindUser } from '../src/store.mjs';
import { ImportVideo } from '../src/media.mjs';
const [Username, File, Description = ''] = process.argv.slice(2);
if (!Username || !File) throw new Error('Usage: npm run video:import -- username /path/to/video.mp4 "Caption"');
const Config = LoadConfig();
const Pool = Database(Config.DatabaseUrl);
try {
	await Migrate(Pool);
	const User = await FindUser(Pool, Username);
	const VideoId = await ImportVideo(Pool, Config, User.id, resolve(File), Description);
	console.log(`Imported ${Config.Origin}/@${User.username}/video/${VideoId}`);
} finally { await Pool.end(); }
