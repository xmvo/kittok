import { HttpError } from './http.mjs';
import { LocalOpen } from './ips.mjs';
import { DefaultThresholds, PolicyCategories } from './moderation.mjs';

export const Features = { shop: 'Shop', explore: 'Explore', following: 'Following feed', shortDrama: 'Short dramas', live: 'LIVE', search: 'Search', upload: 'Uploads', comments: 'Comments', messages: 'Direct messages' };
export const MiscFeatures = {
	verifiedBadges: ['Verified badges', 'Blue checks on accounts admins verify'],
	profileBadges: ['Profile badges', 'Pride flags beside names'],
	avatarDecorations: ['Avatar decorations', 'Animated frames around avatars, picked from the profile photo editor'],
	nameStyles: ['Name styles', 'Discord display name fonts and effects, picked in Edit profile'],
	nameplates: ['Nameplates', 'Discord nameplates behind names on comments and in messages'],
	reposts: ['Reposts', 'Repost in the share sheet and the profile Reposts tab'],
	collections: ['Collections', 'Named collections of favorites'],
	hashtags: ['Hashtags and mentions', 'Linked #tags and @mentions, tag pages, and mention notices'],
	groupedLikes: ['Grouped like notices', 'One notice per video or comment with the newest likers'],
	commentLabels: ['Comment labels', 'Creator, Following and Friends labels and the creator-liked avatar'],
	messageRequests: ['Message requests', 'Messages that recipients route to requests wait there; off delivers them to the inbox'],
	readReceipts: ['Read receipts', 'Seen status when both people turn it on'],
	unsend: ['Unsend messages', 'Senders can unsend within three minutes'],
	messageReactions: ['Message reactions', 'Emoji reactions on direct messages'],
	messageMedia: ['Photos and videos in messages', 'Send photos and short videos in direct messages'],
	groupChats: ['Group chats', 'Group direct messages with up to 32 friends'],
};
export const Misc = Object.fromEntries(Object.keys(MiscFeatures).map(Name => [Name, true]));
export const BrandSlots = { wordmarkDark: '/public/logo.svg', wordmarkLight: '/public/logo-light.svg', icon: '/public/icon.svg', favicon: '/public/icon.svg', avatar: '/public/avatar.svg' };
export const Fallbacks = { avatar: '/public/avatar.svg' };

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
	if (Key === 'misc') {
		if (!Value || typeof Value !== 'object') throw new HttpError(400, 'InvalidMisc');
		return Object.fromEntries(Object.keys(MiscFeatures).map(Name => [Name, Value[Name] !== false]));
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
	if (Key === 'moderation') {
		const Whole = (Number_, Low, High) => Number.isInteger(Number_) && Number_ >= Low && Number_ <= High;
		const Policy = Object.fromEntries(PolicyCategories.map(Name => [Name, Number(Value?.policy?.[Name] ?? DefaultThresholds.policy[Name])]));
		const Result = { strikeDays: Number(Value?.strikeDays), feature: Number(Value?.feature), total: Number(Value?.total), policy: Policy };
		if (!Whole(Result.strikeDays, 7, 365) || !Whole(Result.feature, 2, 50) || !Whole(Result.total, 2, 100) || !Object.values(Policy).every(Count => Whole(Count, 1, 50))) throw new HttpError(400, 'InvalidModerationSettings');
		return Result;
	}
	if (Key === 'mailcodes') {
		if (typeof Value !== 'boolean') throw new HttpError(400, 'InvalidMailCodes');
		return Value;
	}
	if (Key === 'brand') return Value;
	if (Key === 'mail') {
		const Port = Number(Value?.port);
		if (!Value || typeof Value.host !== 'string' || !/^[a-zA-Z0-9.-]{1,253}$/.test(Value.host) || !Number.isInteger(Port) || Port < 1 || Port > 65535 || !['starttls', 'tls'].includes(Value.secure)
			|| typeof Value.username !== 'string' || Value.username.length > 254 || typeof Value.password !== 'string' || typeof Value.from !== 'string' || !/@/.test(Value.from) || Value.from.length > 254 || /[\r\n]/.test(Value.from + Value.username)) throw new HttpError(400, 'InvalidMailSettings');
		return { host: Value.host, port: Port, secure: Value.secure, username: Value.username, password: Value.password, from: Value.from.trim() };
	}
	throw new HttpError(404, 'UnknownSetting');
}

function Apply(Config, Key, Value) {
	if (Key === 'registration') Config.Registration = Value;
	if (Key === 'name') Config.Name = Value;
	if (Key === 'features') Config.Features = Value;
	if (Key === 'misc') Object.assign(Misc, Value);
	if (Key === 'limits') { Config.MaxVideoBytes = Value.videoMB * 1024 * 1024; Config.MaxVideoSeconds = Value.videoSeconds; }
	if (Key === 'announcement') Config.Announcement = Value;
	if (Key === 'rules') Config.Rules = Value;
	if (Key === 'brand') { Config.Brand = Value; Fallbacks.avatar = Value?.avatar ? `/brand/avatar?v=${encodeURIComponent(Value.avatar)}` : BrandSlots.avatar; }
	if (Key === 'mail') {
		const Password = Value.password ? LocalOpen(Value.password) ?? '' : '';
		const Login = Value.username ? `${encodeURIComponent(Value.username)}${Password ? ':' + encodeURIComponent(Password) : ''}@` : '';
		Config.SmtpUrl = `${Value.secure === 'tls' ? 'smtps' : 'smtp'}://${Login}${Value.host}:${Value.port}`;
		Config.MailFrom = Value.from; Config.MailSetting = Value;
	}
	if (Key === 'moderation') Config.Moderation = Value;
	if (Key === 'mailcodes') Config.MailCodes = Value;
}

export async function LoadSettings(Pool, Config) {
	Config.Features = Object.fromEntries(Object.keys(Features).map(Name => [Name, true]));
	for (const Name of Object.keys(Misc)) Misc[Name] = true;
	Config.Misc = Misc;
	Config.Announcement = { text: '', link: '', version: 0 };
	Config.Rules = '';
	Config.Brand = {};
	Config.Moderation = DefaultThresholds;
	Config.MailCodes = true;
	Config.EnvMail ??= { url: Config.SmtpUrl, from: Config.MailFrom };
	[Config.SmtpUrl, Config.MailFrom, Config.MailSetting] = [Config.EnvMail.url, Config.EnvMail.from, null];
	Fallbacks.avatar = BrandSlots.avatar;
	for (const Row of (await Pool.query('SELECT key, value FROM settings')).rows) Apply(Config, Row.key, Row.value);
}

export async function SaveSetting(Pool, Config, Key, Raw) {
	let Value = Validate(Key, Raw);
	if (Key === 'announcement') Value = { ...Value, version: Value.text && Value.text !== Config.Announcement?.text ? Date.now() : Config.Announcement?.version ?? 0 };
	await Pool.query('INSERT INTO settings(key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [Key, JSON.stringify(Value)]);
	Apply(Config, Key, Value);
	return Value;
}

export function RestoreEnvMail(Config) {
	if (Config.EnvMail) [Config.SmtpUrl, Config.MailFrom, Config.MailSetting] = [Config.EnvMail.url, Config.EnvMail.from, null];
}
function MailShape(Config) {
	if (Config.MailSetting) { const { password, ...Rest } = Config.MailSetting; return { ...Rest, hasPassword: Boolean(password), source: 'admin' }; }
	if (!Config.SmtpUrl) return { host: '', port: 587, secure: 'starttls', username: '', from: Config.MailFrom ?? '', hasPassword: false, source: 'none' };
	try {
		const Url = new URL(Config.SmtpUrl), Tls = Url.protocol === 'smtps:';
		return { host: Url.hostname, port: Number(Url.port || (Tls ? 465 : 587)), secure: Tls ? 'tls' : 'starttls', username: decodeURIComponent(Url.username), from: Config.MailFrom ?? '', hasPassword: Boolean(Url.password), source: 'env' };
	} catch { return { host: '', port: 587, secure: 'starttls', username: '', from: '', hasPassword: false, source: 'env' }; }
}

export function Settings(Config) {
	return {
		registration: Config.Registration, name: Config.Name, features: Config.Features, misc: { ...Misc },
		limits: { videoMB: Math.round(Config.MaxVideoBytes / 1024 / 1024), videoSeconds: Config.MaxVideoSeconds },
		announcement: Config.Announcement, rules: Config.Rules, moderation: Config.Moderation,
		mailCodes: Config.MailCodes !== false, mailReady: Boolean(Config.SmtpUrl && Config.MailFrom), mail: MailShape(Config),
		brand: Object.fromEntries(Object.keys(BrandSlots).map(Slot => [Slot, { url: `/brand/${Slot}`, custom: Boolean(Config.Brand?.[Slot]) }])),
	};
}
