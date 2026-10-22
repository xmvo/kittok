import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Asset, AssetHosts, ClientDir, ReadJsonScript, CaptureLoginPage, CaptureNotFoundData, CaptureNotFoundPage } from '../src/client/archive.mjs';

const Response = await fetch('https://www.tiktok.com/', {
	headers: { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' },
	signal: AbortSignal.timeout(30000),
});
if (!Response.ok) throw new Error(`PageHTTP${Response.status}`);
const Html = await Response.text();
const Manifest = ReadJsonScript(Html, 'chunk-manifest');
ReadJsonScript(Html, '__UNIVERSAL_DATA_FOR_REHYDRATION__');
const Entries = new Set();
for (const Match of Html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="((?:https:)?\/\/[^"<>]+)"/g)) {
	const Url = new URL(Match[1].startsWith('//') ? `https:${Match[1]}` : Match[1]);
	if (AssetHosts.has(Url.hostname) && /\.(?:js|css|woff2?)(?:\?|$)/.test(Url.href)) Entries.add(Url.href);
}
if (Entries.size < 5) throw new Error('IncompleteClientPage');
await mkdir(ClientDir, { recursive: true });
const Queue = [...Entries];
const Failures = [];
await Promise.all(Array.from({ length: 6 }, async () => {
	while (Queue.length) {
		const Url = Queue.pop();
		try { await Asset(Url); } catch (Error) { Failures.push({ url: Url, error: Error.message }); }
	}
}));
if (Failures.length) {
	console.error(Failures);
	throw new Error('ClientCaptureIncomplete');
}
await writeFile(join(ClientDir, 'index.html'), Html);
await writeFile(join(ClientDir, 'build.json'), JSON.stringify({
	capturedAt: new Date().toISOString(),
	source: 'https://www.tiktok.com/',
	sha256: createHash('sha256').update(Html).digest('hex'),
	publicPath: Manifest.publicPath,
	entries: [...Entries],
}, null, '\t'));
console.log(`Pinned public client: ${Entries.size} assets. Original client files stay in ignored client/.`);
await CaptureLoginPage(true);
await CaptureNotFoundPage(true);
await CaptureNotFoundData();
console.log('Pinned original login page and entry assets.');
