import { resolve } from 'node:path';
import { Root } from './client/archive.mjs';

export function LoadConfig(Env = process.env) {
	const Port = Number(Env.PORT ?? 3210);
	if (!Number.isInteger(Port) || Port < 1 || Port > 65535) throw new Error('InvalidPort');
	const Origin = new URL(Env.PUBLIC_ORIGIN ?? `http://127.0.0.1:${Port}`);
	if (!['http:', 'https:'].includes(Origin.protocol) || Origin.username || Origin.password || Origin.pathname !== '/' || Origin.search || Origin.hash) throw new Error('InvalidPublicOrigin');
	const IsLocal = ['localhost', '127.0.0.1', '[::1]'].includes(Origin.hostname);
	if (!IsLocal && Origin.protocol !== 'https:') throw new Error('PublicOriginNeedsHTTPS');
	const DatabaseUrl = Env.DATABASE_URL;
	if (!DatabaseUrl || !['postgres:', 'postgresql:'].includes(new URL(DatabaseUrl).protocol)) throw new Error('DatabaseUrlRequired');
	const Registration = Env.REGISTRATION_MODE ?? 'closed';
	if (!['closed', 'invite', 'open'].includes(Registration)) throw new Error('InvalidRegistrationMode');
	const MaxVideoMB = Number(Env.MAX_VIDEO_MB ?? 100);
	if (!Number.isInteger(MaxVideoMB) || MaxVideoMB < 1 || MaxVideoMB > 2048) throw new Error('InvalidVideoLimit');
	const MaxVideoSeconds = Number(Env.MAX_VIDEO_SECONDS ?? 600);
	if (!Number.isInteger(MaxVideoSeconds) || MaxVideoSeconds < 1 || MaxVideoSeconds > 3600) throw new Error('InvalidDurationLimit');
	return {
		Port, Host: Env.HOST ?? '127.0.0.1', Origin: Origin.origin, DatabaseUrl, Registration,
		Name: (Env.INSTANCE_NAME ?? 'Kittok').trim().slice(0, 60) || 'Kittok',
		Description: (Env.INSTANCE_DESCRIPTION ?? 'A little corner of the internet for your videos.').slice(0, 300),
		MediaDir: resolve(Env.MEDIA_DIR ?? `${Root}/media`), SecureCookies: Origin.protocol === 'https:',
		MaxVideoBytes: MaxVideoMB * 1024 * 1024, MaxVideoSeconds,
		FFmpeg: Env.FFMPEG ?? 'ffmpeg', FFprobe: Env.FFPROBE ?? 'ffprobe',
		SourceUrl: Env.SOURCE_URL || '/source', IsLocal,
		IpHeader: /^[a-z0-9-]{1,64}$/.test(String(Env.IP_HEADER ?? '').toLowerCase()) ? Env.IP_HEADER.toLowerCase() : null,
		CountryHeader: /^[a-z0-9-]{1,64}$/.test(String(Env.COUNTRY_HEADER ?? '').toLowerCase()) ? Env.COUNTRY_HEADER.toLowerCase() : null,
	};
}
