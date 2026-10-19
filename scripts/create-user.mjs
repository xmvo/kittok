import { LoadConfig } from '../src/config.mjs';
import { Database, Migrate } from '../src/db.mjs';
import { CreateUser } from '../src/auth.mjs';

function ReadPassword() {
	if (process.env.KITTOK_PASSWORD) return Promise.resolve(process.env.KITTOK_PASSWORD);
	if (!process.stdin.isTTY) throw new Error('SetKittokPasswordEnvironmentVariable');
	process.stdout.write('Password (12+ characters): ');
	return new Promise((Resolve, Reject) => {
		let Value = '';
		process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
		function Done() { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.removeListener('data', Read); process.stdout.write('\n'); }
		function Read(Text) {
			for (const Character of Text) {
				if (Character === '\u0003') { Done(); Reject(new Error('Cancelled')); return; }
				if (Character === '\r' || Character === '\n') { Done(); Resolve(Value); return; }
				if (Character === '\u007f') Value = Value.slice(0, -1);
				else Value += Character;
			}
		}
		process.stdin.on('data', Read);
	});
}

const Username = process.argv[2];
if (!Username || Username.startsWith('--')) throw new Error('Usage: npm run user:create -- username [--admin]');
const Password = await ReadPassword();
const Pool = Database(LoadConfig().DatabaseUrl);
try {
	await Migrate(Pool);
	const User = await CreateUser(Pool, { username: Username, displayName: Username, password: Password, role: process.argv.includes('--admin') ? 'admin' : 'member' }, 'closed', true);
	console.log(`Created @${User.username} (${User.role}).`);
} finally { await Pool.end(); }
