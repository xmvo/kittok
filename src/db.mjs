import pg from 'pg';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Root } from './client/archive.mjs';
import { IpHashKey } from './ips.mjs';

export function Database(Url) {
	const Pool = new pg.Pool({ connectionString: Url, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
	Pool.on('error', Error => console.error('DatabaseConnectionError', Error.code ?? 'Unknown'));
	return Pool;
}

export async function Transaction(Pool, Work) {
	const Client = await Pool.connect();
	try {
		await Client.query('BEGIN');
		const Result = await Work(Client);
		await Client.query('COMMIT');
		return Result;
	} catch (Error) {
		await Client.query('ROLLBACK');
		throw Error;
	} finally { Client.release(); }
}

export async function Migrate(Pool) {
	return Transaction(Pool, async Client => {
		await Client.query('SELECT pg_advisory_xact_lock(741950192)');
		await Client.query("SELECT set_config('kittok.ip_hash_key', $1, true)", [IpHashKey()]);
		await Client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
		for (const Name of (await readdir(join(Root, 'migrations'))).filter(Name => /^\d+.*\.sql$/.test(Name)).sort()) {
			const Sql = await readFile(join(Root, 'migrations', Name), 'utf8');
			const Hash = createHash('sha256').update(Sql).digest('hex');
			const Existing = await Client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [Name]);
			if (Existing.rows.length) {
				if (Existing.rows[0].checksum !== Hash) throw new Error(`MigrationChanged:${Name}`);
				continue;
			}
			await Client.query(Sql);
			await Client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [Name, Hash]);
		}
	});
}
