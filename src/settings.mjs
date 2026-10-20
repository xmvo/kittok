import { HttpError } from './http.mjs';

export const Features = { shop: 'Shop', explore: 'Explore', following: 'Following feed', shortDrama: 'Short dramas', live: 'LIVE', search: 'Search', upload: 'Uploads', comments: 'Comments', messages: 'Direct messages' };
export const BrandSlots = { wordmarkDark: '/public/logo.svg', wordmarkLight: '/public/logo-light.svg', icon: '/public/avatar.svg', favicon: '/public/avatar.svg' };

function Validate(Key, Value) {
	if (Key === 'registration') {
		if (!['closed', 'invite', 'open'].includes(Value)) throw new HttpError(400, 'InvalidRegistrationMode');
		return Value;
	}
	if (Key === 'name') {
		const Name = String(Value ?? '').trim();
		if (Name.length < 1 || Name.length > 60) throw new HttpError(400, 'InvalidInstanceName');
		return Name;
	}
	if (Key === 'features') {
		if (!Value || typeof Value !== 'object') throw new HttpError(400, 'InvalidFeatures');
		return Object.fromEntries(Object.keys(Features).map(Name => [Name, Value[Name] !== false]));
	}
	if (Key === 'limits') {
		const VideoMB = Number(Value?.videoMB), VideoSeconds = Number(Value?.videoSeconds);
		if (!Number.isInteger(VideoMB) || VideoMB < 1 || VideoMB > 2048 || !Number.isInteger(VideoSeconds) || VideoSeconds < 1 || VideoSeconds > 3600) throw new HttpError(400, 'InvalidLimits');
		return { videoMB: VideoMB, videoSeconds: VideoSeconds };
	}
	if (Key === 'announcement') {
		const Text = String(Value?.text ?? '').trim(), Link = String(Value?.link ?? '').trim();
		if (Text.length > 500) throw new HttpError(400, 'AnnouncementTooLong');
		if (Link && !/^(?:https?:\/\/[^\s"'<>]+|\/[^\s"'<>]*)$/.test(Link)) throw new HttpError(400, 'InvalidAnnouncementLink');
		return { text: Text, link: Text ? Link : '' };
	}
	if (Key === 'rules') {
		const Rules = String(Value ?? '').trim();
		if (Rules.length > 10000) throw new HttpError(400, 'RulesTooLong');
		return Rules;
	}
	if (Key === 'brand') return Value;
	throw new HttpError(404, 'UnknownSetting');
}

function Apply(Config, Key, Value) {
	if (Key === 'registration') Config.Registration = Value;
	if (Key === 'name') Config.Name = Value;
	if (Key === 'features') Config.Features = Value;
	if (Key === 'limits') { Config.MaxVideoBytes = Value.videoMB * 1024 * 1024; Config.MaxVideoSeconds = Value.videoSeconds; }
	if (Key === 'announcement') Config.Announcement = Value;
	if (Key === 'rules') Config.Rules = Value;
	if (Key === 'brand') Config.Brand = Value;
}

export async function LoadSettings(Pool, Config) {
	Config.Features = Object.fromEntries(Object.keys(Features).map(Name => [Name, true]));
	Config.Announcement = { text: '', link: '', version: 0 };
	Config.Rules = '';
	Config.Brand = {};
	for (const Row of (await Pool.query('SELECT key, value FROM settings')).rows) Apply(Config, Row.key, Row.value);
}

export async function SaveSetting(Pool, Config, Key, Raw) {
	let Value = Validate(Key, Raw);
	if (Key === 'announcement') Value = { ...Value, version: Value.text && Value.text !== Config.Announcement?.text ? Date.now() : Config.Announcement?.version ?? 0 };
	await Pool.query('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [Key, JSON.stringify(Value)]);
	Apply(Config, Key, Value);
	return Value;
}

export function Settings(Config) {
	return {
		registration: Config.Registration, name: Config.Name, features: Config.Features,
		limits: { videoMB: Math.round(Config.MaxVideoBytes / 1024 / 1024), videoSeconds: Config.MaxVideoSeconds },
		announcement: Config.Announcement, rules: Config.Rules,
		brand: Object.fromEntries(Object.keys(BrandSlots).map(Slot => [Slot, { url: `/brand/${Slot}`, custom: Boolean(Config.Brand?.[Slot]) }])),
	};
}
