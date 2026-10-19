import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { join, extname } from 'node:path';
import { HttpError } from './http.mjs';

export const Mime = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.json': 'application/json', '.ico': 'image/x-icon' };
const SafeName = /^[a-zA-Z0-9_-]+\.(?:mp4|jpg|png|svg)$/;

function Run(Executable, Args, Failure = 'InvalidVideo') {
	return new Promise((Resolve, Reject) => {
		const Process = spawn(Executable, Args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const Chunks = [];
		let Size = 0;
		const Timer = setTimeout(() => { Process.kill('SIGKILL'); Reject(new HttpError(422, 'VideoProcessingTimeout')); }, 180000).unref();
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

export async function ImportVideo(Pool, Config, UserId, Input, Description = '') {
	if (typeof Description !== 'string' || Description.length > 2200) throw new HttpError(400, 'DescriptionTooLong');
	const InputInfo = await stat(Input);
	if (!InputInfo.size || InputInfo.size > Config.MaxVideoBytes) throw new HttpError(413, 'VideoTooLarge');
	const Probe = JSON.parse(await Run(Config.FFprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-show_streams', '-show_format', '-of', 'json', Input]));
	const Track = Probe.streams.find(Track => Track.codec_type === 'video');
	const Duration = Number(Probe.format.duration);
	if (!Track || !Number.isFinite(Duration) || Duration <= 0 || Duration > Config.MaxVideoSeconds || Track.width > 4096 || Track.height > 4096) throw new HttpError(422, 'UnsupportedVideo');
	await mkdir(Config.MediaDir, { recursive: true });
	const Key = randomUUID();
	const VideoName = `${Key}.mp4`;
	const CoverName = `${Key}.jpg`;
	const Video = join(Config.MediaDir, VideoName);
	const Cover = join(Config.MediaDir, CoverName);
	try {
		await Run(Config.FFmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm', '-i', Input,
			'-map', '0:v:0', '-map', '0:a:0?', '-vf', "scale='min(1080,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast',
			'-crf', '25', '-pix_fmt', 'yuv420p', '-threads', '2', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-t', String(Config.MaxVideoSeconds), '-n', Video]);
		await Run(Config.FFmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', Video, '-frames:v', '1', '-threads', '1', '-n', Cover]);
		const OutputProbe = JSON.parse(await Run(Config.FFprobe, ['-v', 'error', '-show_streams', '-of', 'json', Video]));
		const OutputTrack = OutputProbe.streams.find(Track => Track.codec_type === 'video');
		const Info = await stat(Video);
		const Result = await Pool.query('INSERT INTO videos(author_id, description, file_name, cover_name, width, height, duration, bytes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id', [UserId, Description, VideoName, CoverName, OutputTrack.width, OutputTrack.height, Duration, Info.size]);
		return Result.rows[0].id;
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

export const AvatarExists = async (Config, Name) => (await stat(join(Config.MediaDir, Name)).catch(() => null))?.isFile() ?? false;
export const RemoveMedia = (Config, Name) => rm(join(Config.MediaDir, Name), { force: true });

export async function ReceiveVideo(Request, Config) {
	await mkdir(join(Config.MediaDir, '.incoming'), { recursive: true });
	const File = join(Config.MediaDir, '.incoming', randomUUID());
	let Bytes = 0;
	const Limit = new Transform({ transform(Chunk, Encoding, Done) {
		Bytes += Chunk.length;
		Done(Bytes > Config.MaxVideoBytes ? new HttpError(413, 'VideoTooLarge') : null, Chunk);
	} });
	try {
		await pipeline(Request, Limit, createWriteStream(File, { flags: 'wx', mode: 0o600 }));
		return File;
	} catch (Error) { await rm(File, { force: true }); throw Error; }
}

export async function ServeMedia(Request, Response, Config, Name) {
	if (!SafeName.test(Name)) throw new HttpError(404, 'MediaNotFound');
	const File = join(Config.MediaDir, Name);
	const Info = await stat(File).catch(() => null);
	if (!Info?.isFile()) throw new HttpError(404, 'MediaNotFound');
	const Headers = { 'content-type': Mime[extname(Name)], 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=86400' };
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
