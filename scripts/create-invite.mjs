import { LoadConfig } from '../src/config.mjs';
import { Database, Migrate } from '../src/db.mjs';
import { Hash, Token } from '../src/auth.mjs';
const Pool = Database(LoadConfig().DatabaseUrl);
try {
	await Migrate(Pool);
	const Username = process.argv[2];
	const User = await Pool.query("SELECT id FROM users WHERE username = $1 AND role = 'admin'", [Username]);
	if (!User.rowCount) throw new Error('AdminUsernameRequired');
	const Code = Token();
	await Pool.query("INSERT INTO invites(token_hash, created_by, expires_at) VALUES ($1, $2, now() + interval '7 days')", [Hash(Code), User.rows[0].id]);
	console.log(`One-use invite, valid for seven days: ${Code}`);
} finally { await Pool.end(); }
