import { readFileSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.mjs';
import { Misc } from './settings.mjs';

const Entries = JSON.parse(readFileSync(new URL('./decorations.json', import.meta.url), 'utf8'));
const ById = new Map(Entries.map(Entry => [Entry[0], Entry]));
const ByAsset = new Map(Entries.map(Entry => [Entry[1], Entry]));
const Pending = new Map();

const Image = (Asset, Still) => `/_kittok/decorations/${Asset}.png${Still ? '?static=1' : ''}`;
const Shape = ([Id, Asset, Name, , Label]) => ({ id: Id, name: Name, label: Label, image: Image(Asset), still: Image(Asset, true) });

export const DecorationCatalog = (() => {
	const Collections = new Map();
	for (const Entry of Entries) {
		if (!Collections.has(Entry[3])) Collections.set(Entry[3], []);
		Collections.get(Entry[3]).push(Shape(Entry));
	}
	return { collections: [...Collections].map(([Name, Items]) => ({ name: Name, items: Items })) };
})();

export function AvatarDecoration(Value) {
	if (Value === '' || Value === null) return '';
	if (typeof Value !== 'string' || !ById.has(Value)) throw new HttpError(400, 'InvalidAvatarDecoration');
	return Value;
}

export function PublicDecoration(User) {
	const Entry = Misc.avatarDecorations && ById.get(User.avatar_decoration);
	return Entry ? Shape(Entry) : null;
}

export async function DecorationImage(Config, Asset, Still) {
	if (!ByAsset.has(Asset)) throw new HttpError(404, 'DecorationNotFound');
	const Directory = join(Config.MediaDir, 'decorations');
	const File = join(Directory, `${Asset}${Still ? '-static' : ''}.png`);
	const Cached = await readFile(File).catch(() => null);
	if (Cached) return Cached;
	if (!Pending.has(File)) Pending.set(File, (async () => {
		const Remote = await fetch(`https://cdn.discordapp.com/avatar-decoration-presets/${Asset}.png?size=240&passthrough=${Still ? 'false' : 'true'}`, { signal: AbortSignal.timeout(15000) }).catch(() => null);
		if (!Remote?.ok || Remote.headers.get('content-type') !== 'image/png') throw new HttpError(502, 'CouldntFetchDecoration');
		const Data = Buffer.from(await Remote.arrayBuffer());
		await mkdir(Directory, { recursive: true });
		const Temporary = join(Directory, `.${randomUUID()}`);
		await writeFile(Temporary, Data); await rename(Temporary, File);
		return Data;
	})().finally(() => Pending.delete(File)));
	return Pending.get(File);
}
