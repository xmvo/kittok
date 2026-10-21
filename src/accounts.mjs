import { RemoveMedia } from './media.mjs';

export async function DeleteAccount(Pool, Config, UserId) {
	const Account = (await Pool.query('SELECT avatar_name FROM users WHERE id = $1', [UserId])).rows[0];
	if (!Account) return false;
	await Pool.query('DELETE FROM invites WHERE created_by = $1', [UserId]);
	const Videos = (await Pool.query('DELETE FROM videos WHERE author_id = $1 RETURNING file_name, cover_name', [UserId])).rows;
	await Pool.query('DELETE FROM users WHERE id = $1', [UserId]);
	for (const Row of Videos) await Promise.all([RemoveMedia(Config, Row.file_name), RemoveMedia(Config, Row.cover_name)]);
	if (Account.avatar_name) await RemoveMedia(Config, Account.avatar_name);
	return true;
}

export async function DeleteExpiredAccounts(Pool, Config) {
	const Due = (await Pool.query('SELECT id FROM users WHERE delete_after < now() AND deactivated_at IS NOT NULL')).rows;
	for (const Row of Due) await DeleteAccount(Pool, Config, Row.id);
	return Due.length;
}
