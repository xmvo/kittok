import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { createHash, randomUUID } from 'node:crypto';
import { join, extname } from 'node:path';
import { PostSettings } from './privacy.mjs';
import { GuessCategory } from './categories.mjs';
import { HttpError } from './http.mjs';
import { AssetFile, Root } from './client/archive.mjs';

export const Mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.json': 'application/json', '.ico': 'image/x-icon' };
const SafeName = /^[a-zA-Z0-9_-]+\.(?:mp4|jpg|png|svg)$/;

function Run(Executable, Args, Failure = 'InvalidVideo', Timeout = 180000, Nice = 0) {
	return new Promise((Resolve, Reject) => {
		const Process = spawn(Executable, Args, { stdio: ['ignore', 'pipe', 'pipe'] });
		if (Nice && Process.pid) try { setPriority(Process.pid, Nice); } catch {}
		const Chunks = [];
		let Size = 0;
		const Timer = setTimeout(() => { Process.kill('SIGKILL'); Reject(new HttpError(422, 'VideoProcessingTimeout')); }, Timeout).unref();
		Process.stdout.on('data', Chunk => { Size += Chunk.length; if (Size < 1024 * 1024) Chunks.push(Chunk); });
		Process.stderr.resume();
		Process.once('error', () => { clearTimeout(Timer); Reject(new HttpError(503, 'VideoToolsUnavailable')); });
		Process.once('exit', Code => {
			clearTimeout(Timer);
			if (Code !== 0) Reject(new HttpError(422, Failure));
			else Resolve(Buffer.concat(Chunks).toString('utf8'));
		});
	});
}

export async function ImportVideo(Pool, Config, UserId, Input, Description = '', Settings = { visibility: 'public', comment_permission: 'default' }) {
	PostSettings(Settings.visibility, Settings.comment_permission);
	if (typeof Description !== 'string' || Description.length > 2200) throw new HttpError(400, 'DescriptionTooLong');
	const Video = await TranscodeVideo(Config, Input, Config.MaxVideoBytes, Config.MaxVideoSeconds);
	try {
		const Result = await Pool.query("INSERT INTO videos(author_id, description, file_name, cover_name, width, height, duration, bytes, visibility, comment_permission, category, story_expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, CASE WHEN $12 THEN now() + interval '24 hours' END) RETURNING id",
			[UserId, Description, Video.VideoName, Video.CoverName, Video.Width, Video.Height, Video.Duration, Video.Bytes, Settings.visibility, Settings.comment_permission, Settings.story ? 0 : Settings.category ?? GuessCategory(Description), Boolean(Settings.story)]);
		return Result.rows[0].id;
	} catch (Error) {
		await Promise.allSettled([RemoveMedia(Config, Video.VideoName), RemoveMedia(Config, Video.CoverName)]);
		throw Error;
	}
}

export async function TranscodeVideo(Config, Input, MaxBytes, MaxSeconds) {
	const InputInfo = await stat(Input);
	if (!InputInfo.size || InputInfo.size > MaxBytes) throw new HttpError(413, 'VideoTooLarge');
	const Probe = JSON.parse(await Run(Config.FFprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-show_streams', '-show_format', '-of', 'json', Input]));
	const Track = Probe.streams.find(Track => Track.codec_type === 'video');
	const Duration = Number(Probe.format.duration);
	if (!Track || !Number.isFinite(Duration) || Duration <= 0 || Duration > MaxSeconds || Track.width > 4096 || Track.height > 4096) throw new HttpError(422, 'UnsupportedVideo');
	await mkdir(Config.MediaDir, { recursive: true });
	const Key = randomUUID();
	const VideoName = `${Key}.mp4`;
	const CoverName = `${Key}.jpg`;
	const Video = join(Config.MediaDir, VideoName);
	const Cover = join(Config.MediaDir, CoverName);
	const Input_ = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-i', Input, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1'];
	const Output = ['-movflags', '+faststart', '-t', String(MaxSeconds), '-n', Video];
	const Audio = Probe.streams.find(Track => Track.codec_type === 'audio');
	const Playable = Track.codec_name === 'h264' && Track.pix_fmt === 'yuv420p' && Track.width <= 1080 && (!Audio || Audio.codec_name === 'aac');
	const Encode = () => Run(Config.FFmpeg, [...Input_, '-vf', "scale='min(1080,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast',
		'-crf', '25', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-b:a', '128k', ...Output], 'InvalidVideo', Math.max(180000, Duration * 1500));
	try {
		if (Playable) await Run(Config.FFmpeg, [...Input_, '-c', 'copy', ...Output]).catch(async () => { await rm(Video, { force: true }); await Encode(); });
		else await Encode();
		await Run(Config.FFmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', Video, '-frames:v', '1', '-threads', '1', '-n', Cover]);
		const OutputProbe = JSON.parse(await Run(Config.FFprobe, ['-v', 'error', '-show_streams', '-of', 'json', Video]));
		const OutputTrack = OutputProbe.streams.find(Track => Track.codec_type === 'video');
		const Info = await stat(Video);
		return { VideoName, CoverName, Width: OutputTrack.width, Height: OutputTrack.height, Duration: Math.min(Duration, MaxSeconds), Bytes: Info.size };
	} catch (Error) {
		await Promise.allSettled([rm(Video, { force: true }), rm(Cover, { force: true })]);
		throw Error;
	}
}

export async function SaveAvatar(Config, UserId, Bytes) {
	await mkdir(join(Config.MediaDir, '.incoming'), { recursive: true });
	const Input = join(Config.MediaDir, '.incoming', randomUUID());
	const Name = `avatar-${UserId}-${randomUUID()}.jpg`;
	const Whitelist = ['-protocol_whitelist', 'file', '-format_whitelist', 'png_pipe,jpeg_pipe,webp_pipe'];
	try {
		await writeFile(Input, Bytes, { flag: 'wx', mode: 0o600 });
		const Track = JSON.parse(await Run(Config.FFprobe, ['-v', 'error', ...Whitelist, '-show_streams', '-of', 'json', Input], 'InvalidImage')).streams?.[0];
		if (!Track || Track.width > 4096 || Track.height > 4096) throw new HttpError(422, 'InvalidImage');
		await Run(Config.FFmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...Whitelist, '-i', Input, '-frames:v', '1', '-map_metadata', '-1',
			'-vf', 'scale=200:200:force_original_aspect_ratio=increase,crop=200:200', '-q:v', '3', '-threads', '1', '-n', join(Config.MediaDir, Name)], 'InvalidImage');
		return Name;
	} finally { await rm(Input, { force: true }); }
}

export async function SaveBrandImage(Config, Slot, Bytes) {
	await mkdir(join(Config.MediaDir, '.incoming'), { recursive: true });
	const Input = join(Config.MediaDir, '.incoming', randomUUID());
	const Name = `brand-${Slot}-${randomUUID()}.png`;
	const Whitelist = ['-protocol_whitelist', 'file', '-format_whitelist', 'png_pipe,jpeg_pipe,webp_pipe'];
	const [Width, Height] = Slot.startsWith('wordmark') ? [1200, 400] : [512, 512];
	try {
		await writeFile(Input, Bytes, { flag: 'wx', mode: 0o600 });
		const Track = JSON.parse(await Run(Config.FFprobe, ['-v', 'error', ...Whitelist, '-show_streams', '-of', 'json', Input], 'InvalidImage')).streams?.[0];
		if (!Track || Track.width > 4096 || Track.height > 4096) throw new HttpError(422, 'InvalidImage');
		await Run(Config.FFmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...Whitelist, '-i', Input, '-frames:v', '1', '-map_metadata', '-1',
			'-vf', `scale='min(${Width},iw)':'min(${Height},ih)':force_original_aspect_ratio=decrease`, '-pix_fmt', 'rgba', '-c:v', 'png', '-threads', '1', '-n', join(Config.MediaDir, Name)], 'InvalidImage');
		return Name;
	} finally { await rm(Input, { force: true }); }
}

export async function SaveMessageImage(Config, Input) {
	const Whitelist = ['-protocol_whitelist', 'file', '-format_whitelist', 'png_pipe,jpeg_pipe,webp_pipe,gif'];
	const Track = JSON.parse(await Run(Config.FFprobe, ['-v', 'error', ...Whitelist, '-show_streams', '-of', 'json', Input], 'InvalidImage')).streams?.find(Track => Track.codec_type === 'video');
	if (!Track || Track.width > 8192 || Track.height > 8192) throw new HttpError(422, 'InvalidImage');
	const Name = `${randomUUID()}.jpg`, File = join(Config.MediaDir, Name);
	try {
		await Run(Config.FFmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', ...Whitelist, '-i', Input, '-frames:v', '1', '-map_metadata', '-1',
			'-vf', "scale='min(2048,iw)':'min(2048,ih)':force_original_aspect_ratio=decrease", '-q:v', '3', '-threads', '1', '-n', File], 'InvalidImage');
		const Output = JSON.parse(await Run(Config.FFprobe, ['-v', 'error', '-show_streams', '-of', 'json', File], 'InvalidImage')).streams[0];
		return { Name, Width: Output.width, Height: Output.height, Bytes: (await stat(File)).size };
	} catch (Error) { await rm(File, { force: true }); throw Error; }
}

const WatermarkVersion = 3, Outro = 2.5, Downloading = new Map(), Queue = [];
let Encoding = 0;
const TikTokFont = AssetFile('https://sf16-website-login.neutral.ttwstatic.com/obj/tiktok_web_login_static/tiktok_fonts/TikTokFont-Bold.woff2?_default_font=1&v=2');

async function Watermark(Config, Row, Output, Background) {
	const Input = join(Config.MediaDir, Row.file_name);
	const Logo = Config.Brand?.wordmarkDark ? join(Config.MediaDir, Config.Brand.wordmarkDark) : join(Root, 'public/logo.svg'), Svg = Logo.endsWith('.svg');
	const Probe = JSON.parse(await Run(Config.FFprobe, ['-v', 'error', '-show_streams', '-of', 'json', Input]));
	const Track = Probe.streams.find(Stream => Stream.codec_type === 'video'), Audio = Probe.streams.some(Stream => Stream.codec_type === 'audio');
	const ViewBox = Svg && /viewBox="[\d.\s-]*?\s([\d.]+)\s+([\d.]+)"/.exec(await readFile(Logo, 'utf8'));
	const LogoTrack = ViewBox ? { width: Number(ViewBox[1]), height: Number(ViewBox[2]) } : JSON.parse(await Run(Config.FFprobe, ['-v', 'error', '-show_streams', '-of', 'json', Logo], 'InvalidImage')).streams[0];
	const [Numerator, Denominator] = String(Track.r_frame_rate ?? '30/1').split('/').map(Number);
	const Rate = Math.min(Math.max(Math.round(Numerator / (Denominator || 1)) || 30, 10), 60);
	const Even = Value => Math.max(2, Math.round(Value / 2) * 2), Shrink = Math.min(1, 720 / Math.min(Track.width, Track.height));
	const Width = Even(Track.width * Shrink), Height = Even(Track.height * Shrink), Duration = Number(Row.duration), Base = Math.min(Width, Height);
	const Aspect = LogoTrack.height / LogoTrack.width;
	const LogoW = Even(Base * 0.25), LogoH = Math.round(LogoW * Aspect), Size = Math.round(Base * 0.042), Margin = Math.round(Base * 0.04), Inset = Math.round(LogoW * 0.03);
	const Top = Math.round(Height * 0.06), Gap = Math.round(Size * 0.15), Bottom = Height - Math.round(Height * 0.06) - (LogoH + Gap + Size), Half = (Duration / 2).toFixed(3);
	const EndW = Even(Base * 0.5), EndH = Math.round(EndW * Aspect), EndSize = Math.round(Base * 0.05);
	const Font = (await stat(TikTokFont).catch(() => null)) && !/[\\:',;[\]=]/.test(TikTokFont) ? `fontfile=${TikTokFont}` : 'font=Sans';
	const Text = `${Font}:text='@${Row.username}':fontcolor=white`;
	const Scale = Width => Svg ? [] : [`scale=${Width}:-2`];
	const Graph = [
		[`[1:v]${[...Scale(LogoW), 'format=rgba'].join(',')},split=3[logo1][logo2][logos]`],
		['[logos]colorchannelmixer=rr=0:gg=0:bb=0:aa=0.35,gblur=sigma=2,split[shadow1][shadow2]'],
		[`[0:v]${Shrink < 1 ? `scale=${Width}:${Height},` : ''}setsar=1,fps=${Rate}[base]`],
		[`[base][shadow1]overlay=x=${Margin + 2}:y=${Top + 2}:enable='lt(t,${Half})'[v1]`],
		[`[v1][logo1]overlay=x=${Margin}:y=${Top}:enable='lt(t,${Half})'[v2]`],
		[`[v2][shadow2]overlay=x=${Width - Margin - LogoW + 2}:y=${Bottom + 2}:enable='gte(t,${Half})'[v3]`],
		[`[v3][logo2]overlay=x=${Width - Margin - LogoW}:y=${Bottom}:enable='gte(t,${Half})'[v4]`],
		[`[v4]drawtext=${Text}:fontsize=${Size}:shadowcolor=black@0.35:shadowx=2:shadowy=2:x='if(lt(t,${Half}),${Margin + Inset},w-${Margin + Inset}-text_w)':y='if(lt(t,${Half}),${Top + LogoH + Gap},${Bottom + LogoH + Gap})',format=yuv420p[main]`],
		[`color=c=black:s=${Width}x${Height}:r=${Rate}:d=${Outro},setsar=1[card]`],
		[`[2:v]${[...Scale(EndW), 'format=rgba'].join(',')},fade=in:st=0:d=0.4:alpha=1[endlogo]`],
		[`[card][endlogo]overlay=x='(W-w)/2+if(lt(t,0.5),7*sin(t*95),0)':y='H*0.42-h/2':eof_action=repeat[e1]`],
		[`[e1]drawtext=${Text}:fontsize=${EndSize}:x=(w-text_w)/2:y=${Math.round(Height * 0.42 + EndH / 2 + EndSize * 0.5)}:alpha='if(lt(t,0.35),0,min(1,(t-0.35)/0.35))',format=yuv420p[end]`],
		...(Audio ? [['[0:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a0]'], [`anullsrc=r=44100:cl=stereo,atrim=duration=${Outro}[a1]`], ['[main][a0][end][a1]concat=n=2:v=1:a=1[v][a]']] : [['[main][end]concat=n=2:v=1:a=0[v]']]),
	].join(';');
	const LogoInput = (Width, Height) => [...(Svg ? ['-width', String(Width), '-height', String(Height)] : []), '-i', Logo];
	await Run(Config.FFmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file', '-i', Input, ...LogoInput(LogoW, LogoH), '-loop', '1', '-framerate', String(Rate), '-t', String(Outro), ...LogoInput(EndW, EndH),
		'-filter_complex', Graph, '-map', '[v]', ...(Audio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '128k'] : []), '-c:v', 'libx264', '-preset', Background ? 'veryfast' : 'ultrafast', '-crf', Background ? '26' : '28',
		'-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-map_metadata', '-1', '-threads', Background ? '2' : '0', '-n', Output], 'DownloadFailed', Math.max(180000, Duration * 3000), Background ? 10 : 0);
}

const DownloadName = (Config, Row) => `dl-${Row.id}-${createHash('sha256').update(`${WatermarkVersion}:${Row.username}:${Config.Brand?.wordmarkDark ?? ''}`).digest('hex').slice(0, 16)}.mp4`;
const Ready = async (Config, Row) => Row.download_name === DownloadName(Config, Row) && (await stat(join(Config.MediaDir, Row.download_name)).catch(() => null))?.isFile();

export async function DownloadCopy(Pool, Config, Row, Background = false) {
	const Name = DownloadName(Config, Row);
	if (await Ready(Config, Row)) return Name;
	if (!Downloading.has(Name)) Downloading.set(Name, (async () => {
		if (Encoding >= 2) await new Promise(Resolve => Queue.push(Resolve));
		Encoding++;
		const Partial = join(Config.MediaDir, '.incoming', `${randomUUID()}.mp4`);
		try {
			await mkdir(join(Config.MediaDir, '.incoming'), { recursive: true });
			await Watermark(Config, Row, Partial, Background);
			await rename(Partial, join(Config.MediaDir, Name));
			const Updated = (await Pool.query('UPDATE videos v SET download_name = $2 FROM (SELECT download_name FROM videos WHERE id = $1) old WHERE v.id = $1 RETURNING old.download_name', [Row.id, Name])).rows[0];
			if (!Updated) { await RemoveMedia(Config, Name); throw new HttpError(404, 'VideoNotFound'); }
			if (Updated.download_name && Updated.download_name !== Name) await RemoveMedia(Config, Updated.download_name);
			return Name;
		} finally {
			await rm(Partial, { force: true });
			Encoding--; Queue.shift()?.();
			Downloading.delete(Name);
		}
	})());
	return Downloading.get(Name);
}

export async function SweepStories(Pool, Config) {
	const Rows = (await Pool.query("DELETE FROM videos WHERE story_expires_at < now() - interval '1 day' RETURNING file_name, cover_name, download_name")).rows;
	for (const Row of Rows) await Promise.all([RemoveMedia(Config, Row.file_name), RemoveMedia(Config, Row.cover_name), Row.download_name && RemoveMedia(Config, Row.download_name)]);
}

let Warming = null, WarmAgain = false;
export function WarmDownloads(Pool, Config) {
	if (Warming) { WarmAgain = true; return Warming; }
	Warming = (async () => {
		do {
			WarmAgain = false;
			const Rows = (await Pool.query('SELECT v.id, v.file_name, v.duration, v.download_name, u.username FROM videos v JOIN users u ON u.id = v.author_id WHERE v.story_expires_at IS NULL ORDER BY v.view_count DESC, v.id DESC')).rows;
			for (const Row of Rows) if (!(await Ready(Config, Row))) await DownloadCopy(Pool, Config, Row, true).catch(() => {});
		} while (WarmAgain);
	})().finally(() => { Warming = null; });
	return Warming;
}

export const AvatarExists =async (Config, Name) => (await stat(join(Config.MediaDir, Name)).catch(() => null))?.isFile() ?? false;
export const RemoveMedia = (Config, Name) => rm(join(Config.MediaDir, Name), { force: true });

export async function ReceiveVideo(Request, Config, MaxBytes = Config.MaxVideoBytes, TooLarge = 'VideoTooLarge') {
	await mkdir(join(Config.MediaDir, '.incoming'), { recursive: true });
	const File = join(Config.MediaDir, '.incoming', randomUUID());
	let Bytes = 0;
	const Limit = new Transform({ transform(Chunk, Encoding, Done) {
		Bytes += Chunk.length;
		Done(Bytes > MaxBytes ? new HttpError(413, TooLarge) : null, Chunk);
	} });
	try {
		await pipeline(Request, Limit, createWriteStream(File, { flags: 'wx', mode: 0o600 }));
		return File;
	} catch (Error) { await rm(File, { force: true }); throw Error; }
}

export async function ServeMedia(Request, Response, Config, Name, Protected = false) {
	if (!SafeName.test(Name)) throw new HttpError(404, 'MediaNotFound');
	const File = join(Config.MediaDir, Name);
	const Info = await stat(File).catch(() => null);
	if (!Info?.isFile()) throw new HttpError(404, 'MediaNotFound');
	const Headers = { 'content-type': Mime[extname(Name)], 'accept-ranges': 'bytes', 'cache-control': Protected ? 'private, no-store' : 'public, max-age=86400', vary: 'Cookie' };
	let Start = 0;
	let End = Info.size - 1;
	if (Request.headers.range) {
		const Match = Request.headers.range.match(/^bytes=(\d*)-(\d*)$/);
		if (!Match || (!Match[1] && !Match[2])) { Response.writeHead(416, { 'content-range': `bytes */${Info.size}` }); return Response.end(); }
		Start = Match[1] ? Number(Match[1]) : Math.max(0, Info.size - Number(Match[2]));
		End = Match[1] && Match[2] ? Math.min(Number(Match[2]), Info.size - 1) : Info.size - 1;
		if (!Number.isSafeInteger(Start) || !Number.isSafeInteger(End) || Start > End || Start >= Info.size) { Response.writeHead(416, { 'content-range': `bytes */${Info.size}` }); return Response.end(); }
		Headers['content-range'] = `bytes ${Start}-${End}/${Info.size}`;
	}
	Response.writeHead(Request.headers.range ? 206 : 200, { ...Headers, 'content-length': End - Start + 1 });
	if (Request.method === 'HEAD') return Response.end();
	await pipeline(createReadStream(File, { start: Start, end: End }), Response);
}
