import { createInterface } from 'node:readline';
import { LoadConfig } from '../src/config.mjs';
import { Database, Migrate, Transaction } from '../src/db.mjs';
import { InstanceKey, KeyRecord, NewSecurityKey, Open, Seal, Unlock, ValidSecurityKey } from '../src/ips.mjs';

const Flags = new Set(process.argv.slice(2));
const Usage = 'Usage: npm run ip-key [-- --own] [-- --replace] [-- --reset]';
if ([...Flags].some(Flag => !['--own', '--replace', '--reset'].includes(Flag))) { console.error(Usage); process.exit(1); }

function Ask(Question, Hidden = true) {
	return new Promise(Resolve => {
		const Lines = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
		if (Hidden && process.stdin.isTTY) Lines._writeToOutput = Text => { if (Text.includes(Question)) process.stdout.write(Text); };
		Lines.question(Question, Answer => { Lines.close(); if (Hidden && process.stdin.isTTY) process.stdout.write('\n'); Resolve(Answer.trim()); });
	});
}

const Config = LoadConfig();
const Pool = Database(Config.DatabaseUrl);
try {
	await Migrate(Pool);
	const Current = await InstanceKey(Pool);
	if (Flags.has('--reset')) {
		if (!Current) { console.log('No security key is set up.'); process.exit(0); }
		if (await Ask('This forgets the security key and deletes every sealed IP for good. Type RESET to continue: ', false) !== 'RESET') { console.log('Nothing changed.'); process.exit(1); }
		await Transaction(Pool, async Client => {
			await Client.query("DELETE FROM settings WHERE key = 'ipkey'");
			await Client.query('UPDATE user_events SET ip_sealed = NULL WHERE ip_sealed IS NOT NULL');
			await Client.query('UPDATE sessions SET ip_sealed = NULL WHERE ip_sealed IS NOT NULL');
		});
		console.log('Security key forgotten and sealed IPs deleted. Run npm run ip-key to set up a new one.');
		process.exit(0);
	}
	if (Current && !Flags.has('--replace')) { console.log('A security key is already set up. Use --replace to change it (you need the current one), or --reset if it is lost.'); process.exit(1); }
	let Old = null;
	if (Current) {
		Old = Unlock(Current, await Ask('Current security key: '));
		if (!Old) { console.error('WrongSecurityKey'); process.exit(1); }
	}
	let Secret;
	if (Flags.has('--own')) {
		Secret = await Ask('New security key (at least 64 characters, with letters, numbers and symbols): ');
		if (!ValidSecurityKey(Secret)) { console.error('WeakSecurityKey'); process.exit(1); }
		if (await Ask('Type it again: ') !== Secret) { console.error('KeysDontMatch'); process.exit(1); }
	} else Secret = NewSecurityKey();
	const Record = KeyRecord(Secret);
	const Moved = await Transaction(Pool, async Client => {
		let Count = 0;
		if (Old) for (const Table of ['user_events', 'sessions']) {
			const Key = Table === 'sessions' ? 'token_hash' : 'id';
			for (const Row of (await Client.query(`SELECT ${Key} AS key, ip_sealed FROM ${Table} WHERE ip_sealed IS NOT NULL`)).rows) {
				await Client.query(`UPDATE ${Table} SET ip_sealed = $2 WHERE ${Key} = $1`, [Row.key, Seal(Record, Open(Old, Row.ip_sealed))]);
				Count++;
			}
		}
		await Client.query("INSERT INTO settings(key, value) VALUES ('ipkey', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()", [JSON.stringify(Record)]);
		return Count;
	});
	if (Flags.has('--own')) console.log('Security key saved.');
	else console.log(`Your security key (shown once, save it somewhere safe; it can't be recovered):\n\n${Secret}\n`);
	if (Old) console.log(`Re-sealed ${Moved} IPs to the new key.`);
	console.log('Admins enter it on an account\'s Security tab to show IPs of people who allowed it.');
} finally { await Pool.end(); }
