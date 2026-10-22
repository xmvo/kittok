import { createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { Root } from './client/archive.mjs';
import { HttpError } from './http.mjs';

let HashKey = null;
export function IpHashKey(Env = process.env) {
	if (HashKey) return HashKey;
	if (Env.IP_HASH_KEY) return (HashKey = Env.IP_HASH_KEY);
	const Directory = join(resolve(Env.MEDIA_DIR ?? `${Root}/media`), 'private'), File = join(Directory, 'ip-hash-key');
	try { HashKey = readFileSync(File, 'utf8').trim(); } catch {}
	if (!HashKey) {
		mkdirSync(Directory, { recursive: true, mode: 0o700 });
		HashKey = randomBytes(32).toString('hex');
		writeFileSync(File, HashKey + '\n', { mode: 0o600, flag: 'wx' });
	}
	return HashKey;
}

export function NormalizeIp(Value) {
	const Ip = String(Value ?? '').trim().replace(/^::ffff:(?=\d+\.)/i, '');
	if (isIP(Ip) === 4) return Ip.split('.').map(Part => String(Number(Part))).join('.');
	if (isIP(Ip) === 6) return new URL(`http://[${Ip}]/`).hostname.slice(1, -1);
	return null;
}
export const HashIp = Value => { const Ip = NormalizeIp(Value); return Ip && createHash('sha256').update(IpHashKey() + Ip).digest('hex'); };

const Pkcs8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const Spki = Buffer.from('302a300506032b656e032100', 'hex');
const PrivateFrom = Seed => createPrivateKey({ key: Buffer.concat([Pkcs8, Seed]), format: 'der', type: 'pkcs8' });
const PublicFrom = Raw => createPublicKey({ key: Buffer.concat([Spki, Raw]), format: 'der', type: 'spki' });
const RawPublic = Key => (Key.type === 'public' ? Key : createPublicKey(Key)).export({ format: 'der', type: 'spki' }).subarray(Spki.length);
const Derive = (Secret, Salt) => scryptSync(Secret, Salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

export const KeyCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()-_=+[]{};:,.<>/?~';
export function NewSecurityKey(Length = 128) {
	let Out = '';
	while (Out.length < Length) for (const Byte of randomBytes(Length)) if (Byte < 256 - (256 % KeyCharacters.length) && Out.length < Length) Out += KeyCharacters[Byte % KeyCharacters.length];
	return Out;
}
export function ValidSecurityKey(Secret) {
	return typeof Secret === 'string' && Secret.length >= 64 && Secret.length <= 512 && /\d/.test(Secret) && /[^A-Za-z0-9]/.test(Secret) && /[A-Za-z]/.test(Secret);
}
export function KeyRecord(Secret) {
	const Salt = randomBytes(16);
	return { salt: Salt.toString('base64'), public: RawPublic(PrivateFrom(Derive(Secret, Salt))).toString('base64'), created: new Date().toISOString() };
}

export async function InstanceKey(Pool) {
	const Value = (await Pool.query("SELECT value FROM settings WHERE key = 'ipkey'")).rows[0]?.value;
	return Value?.public && Value?.salt ? Value : null;
}
export function Unlock(Record, Secret) {
	if (!Record || typeof Secret !== 'string' || !Secret) return null;
	const Private = PrivateFrom(Derive(Secret, Buffer.from(Record.salt, 'base64')));
	const Expected = Buffer.from(Record.public, 'base64'), Actual = RawPublic(Private);
	return Expected.length === Actual.length && timingSafeEqual(Expected, Actual) ? Private : null;
}

export function Seal(Record, Value) {
	const Ip = NormalizeIp(Value);
	if (!Record || !Ip) return null;
	const Recipient = Buffer.from(Record.public, 'base64');
	const Ephemeral = generateKeyPairSync('x25519'), EphemeralRaw = RawPublic(Ephemeral.publicKey);
	const Shared = diffieHellman({ privateKey: Ephemeral.privateKey, publicKey: PublicFrom(Recipient) });
	const Key = Buffer.from(hkdfSync('sha256', Shared, Buffer.concat([EphemeralRaw, Recipient]), 'kittok-ip', 32));
	const Nonce = randomBytes(12), Cipher = createCipheriv('aes-256-gcm', Key, Nonce);
	const Body = Buffer.concat([Cipher.update(Ip, 'utf8'), Cipher.final()]);
	return Buffer.concat([Buffer.from([1]), EphemeralRaw, Nonce, Cipher.getAuthTag(), Body]);
}
export function Open(Private, Sealed) {
	try {
		if (!Sealed || Sealed[0] !== 1) return null;
		const EphemeralRaw = Sealed.subarray(1, 33), Nonce = Sealed.subarray(33, 45), Tag = Sealed.subarray(45, 61), Body = Sealed.subarray(61);
		const Recipient = RawPublic(Private);
		const Shared = diffieHellman({ privateKey: Private, publicKey: PublicFrom(EphemeralRaw) });
		const Key = Buffer.from(hkdfSync('sha256', Shared, Buffer.concat([EphemeralRaw, Recipient]), 'kittok-ip', 32));
		const Decipher = createDecipheriv('aes-256-gcm', Key, Nonce); Decipher.setAuthTag(Tag);
		return Buffer.concat([Decipher.update(Body), Decipher.final()]).toString('utf8');
	} catch { return null; }
}

export async function IpFields(Pool, UserId, Info = {}) {
	const Hash = HashIp(Info.ip);
	if (!Hash) return [null, null];
	let Consent = null;
	if (UserId) {
		Consent = (await Pool.query('UPDATE users SET ip_consent = COALESCE(ip_consent, $2) WHERE id = $1 RETURNING ip_consent', [UserId, Info.ipConsent ?? null])).rows[0]?.ip_consent ?? null;
	}
	return [Hash, Consent === true ? Seal(await InstanceKey(Pool), Info.ip) : null];
}
export const ConsentCookie = Request => ({ 1: true, 0: false })[/(?:^|;\s*)kittok_ip_consent=([01])/.exec(Request.headers?.cookie ?? '')?.[1]] ?? null;

export async function SetIpConsent(Pool, UserId, Allow) {
	if (typeof Allow !== 'boolean') throw new HttpError(400, 'InvalidIpConsent');
	await Pool.query('UPDATE users SET ip_consent = $2 WHERE id = $1', [UserId, Allow]);
	if (!Allow) await Promise.all([Pool.query('UPDATE user_events SET ip_sealed = NULL WHERE user_id = $1 AND ip_sealed IS NOT NULL', [UserId]), Pool.query('UPDATE sessions SET ip_sealed = NULL WHERE user_id = $1 AND ip_sealed IS NOT NULL', [UserId])]);
	return Allow;
}

const LocalKey = () => createHash('sha256').update('kittok-local:' + IpHashKey()).digest();
export function LocalSeal(Text) {
	const Nonce = randomBytes(12), Cipher = createCipheriv('aes-256-gcm', LocalKey(), Nonce);
	const Body = Buffer.concat([Cipher.update(String(Text), 'utf8'), Cipher.final()]);
	return Buffer.concat([Nonce, Cipher.getAuthTag(), Body]).toString('base64');
}
export function LocalOpen(Value) {
	try {
		const Raw = Buffer.from(String(Value), 'base64'), Decipher = createDecipheriv('aes-256-gcm', LocalKey(), Raw.subarray(0, 12));
		Decipher.setAuthTag(Raw.subarray(12, 28));
		return Buffer.concat([Decipher.update(Raw.subarray(28)), Decipher.final()]).toString('utf8');
	} catch { return null; }
}
