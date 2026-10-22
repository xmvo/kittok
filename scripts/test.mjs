import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Database } from '../src/db.mjs';
const AdminUrl = process.env.KITTOK_TEST_ADMIN_URL ?? process.env.DATABASE_URL;
if (!AdminUrl) throw new Error('SetDatabaseUrlForTemporaryTestDatabase');
const Name = `kittok_test_${randomBytes(8).toString('hex')}`;
const Admin = Database(AdminUrl);
const TestUrl = new URL(AdminUrl); TestUrl.pathname = '/' + Name;
let Created = false;
try {
	await Admin.query(`CREATE DATABASE ${Name}`); Created = true;
	const Child = spawn(process.execPath, ['--test', 'test/compatibility.test.mjs'], {
		stdio: 'inherit', env: { ...process.env, DATABASE_URL: TestUrl.href, KITTOK_TEST_DATABASE: Name, IP_HASH_KEY: randomBytes(16).toString('hex'), PUBLIC_ORIGIN: 'http://127.0.0.1:13210', PORT: '13210', HOST: '127.0.0.1', REGISTRATION_MODE: 'invite' },
	});
	const Code = await new Promise((Resolve, Reject) => { Child.once('error', Reject); Child.once('exit', Resolve); });
	process.exitCode = Code ?? 1;
} finally {
	if (Created) await Admin.query(`DROP DATABASE ${Name} WITH (FORCE)`);
	await Admin.end();
}
