import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HttpError } from './http.mjs';
import { Misc } from './settings.mjs';

let Entries = [], ById = new Map(), ByAsset = new Map(), Plates = [], PlateById = new Map(), Catalogs = { decorations: { collections: [] }, nameplates: { collections: [] } };
const Pending = new Map();

const Image = (Asset, Still) => `/_kittok/decorations/${Asset}.png${Still ? '?static=1' : ''}`;
const Shape = ([Id, Asset, Name, , Label]) => ({ id: Id, name: Name, label: Label, image: Image(Asset), still: Image(Asset, true) });
const Palettes = { crimson: ['#900007', '#E7040F'], berry: ['#893A99', '#B11FCF'], sky: ['#0080B7', '#56CCFF'], teal: ['#086460', '#7DEED7'], forest: ['#2D5401', '#6AA624'],
	bubble_gum: ['#DC3E97', '#F957B3'], violet: ['#730BC8', '#972FED'], cobalt: ['#0131C2', '#4278FF'], clover: ['#047B20', '#63CD5A'], lemon: ['#F6CD12', '#FED400'], white: ['#FFFFFF', '#FFFFFF'], black: ['#000000', '#000000'] };
const PlateShape = ([Id, Name, , Label, Palette]) => ({ id: Id, name: Name, label: Label, image: `/_kittok/nameplates/${Id}.png`, video: `/_kittok/nameplates/${Id}.webm`,
	palette: { dark: Palettes[Palette]?.[0] ?? '', light: Palettes[Palette]?.[1] ?? '' } });
const Group = (List, Index, Make) => {
	const Collections = new Map();
	for (const Entry of List) {
		if (!Collections.has(Entry[Index])) Collections.set(Entry[Index], []);
		Collections.get(Entry[Index]).push(Make(Entry));
	}
	return { collections: [...Collections].map(([Name, Items]) => ({ name: Name, items: Items })) };
};
const Files = Config => ({ Decorations: join(Config.MediaDir, 'private', 'decorations.json'), Nameplates: join(Config.MediaDir, 'private', 'nameplates.json') });

function Use(Decorations, Nameplates) {
	Entries = Decorations; ById = new Map(Entries.map(Entry => [Entry[0], Entry])); ByAsset = new Map(Entries.map(Entry => [Entry[1], Entry]));
	Plates = Nameplates; PlateById = new Map(Plates.map(Entry => [Entry[0], Entry]));
	Catalogs = { decorations: Group(Entries, 3, Shape), nameplates: Group(Plates, 2, PlateShape) };
}
export async function LoadCollectibles(Config) {
	const Read = Path => readFile(Path, 'utf8').then(JSON.parse).then(Value => Array.isArray(Value) ? Value : []).catch(() => []);
	Use(await Read(Files(Config).Decorations), await Read(Files(Config).Nameplates));
}
export const DecorationCatalog = () => Catalogs.decorations;
export const NameplateCatalog = () => Catalogs.nameplates;
export const DecorationAssets = () => Entries.map(Entry => Entry[1]);
export const CollectibleCounts = () => ({ decorations: Entries.length, nameplates: Plates.length });

export function BuildCollectibles(Categories) {
	if (!Array.isArray(Categories)) throw new HttpError(400, 'InvalidCollectibles');
	const Text = (Value, Limit) => String(Value ?? '').slice(0, Limit);
	const Collect = (Type, Valid, Entry) => {
		const Seen = new Map();
		for (const Category of Categories) {
			for (const Product of Array.isArray(Category?.products) ? Category.products : []) {
				const Items = Array.isArray(Product?.items) ? Product.items : [];
				for (const Item of Items) {
					if (Item?.type !== Type || !/^\d{17,20}$/.test(String(Item.sku_id)) || !Valid(Item)) continue;
					const Own = Items.length === 1, Existing = Seen.get(Item.sku_id);
					if (Existing && (Existing.Own || !Own)) continue;
					Seen.set(Item.sku_id, { Own, Entry: Entry(Item, Text(Product.name, 100).replace(/ Bundle$/, ''), Text(Category.name, 100)) });
				}
			}
		}
		return [...Seen.values()].map(Value => Value.Entry);
	};
	const Decorations = Collect(0, Item => /^(a_)?[0-9a-f]{32}$/.test(Item.asset), (Item, Name, Collection) => [Item.sku_id, Item.asset, Name, Collection, Text(Item.label, 300)]);
	const Nameplates = Collect(2, () => true, (Item, Name, Collection) => [Item.sku_id, Name, Collection, Text(Item.label, 300), Object.hasOwn(Palettes, Item.palette) ? Item.palette : '']);
	if (!Decorations.length && !Nameplates.length) throw new HttpError(422, 'NoCollectiblesFound');
	return { Decorations, Nameplates };
}
export async function SaveCollectibles(Config, Categories) {
	const { Decorations, Nameplates } = BuildCollectibles(Categories);
	await mkdir(join(Config.MediaDir, 'private'), { recursive: true, mode: 0o700 });
	for (const [Path, Data] of [[Files(Config).Decorations, Decorations], [Files(Config).Nameplates, Nameplates]]) {
		const Temporary = `${Path}.${randomUUID()}`;
		await writeFile(Temporary, JSON.stringify(Data) + '\n'); await rename(Temporary, Path);
	}
	Use(Decorations, Nameplates);
	return CollectibleCounts();
}

export function AvatarDecoration(Value) {
	if (Value === '' || Value === null) return '';
	if (typeof Value !== 'string' || !ById.has(Value)) throw new HttpError(400, 'InvalidAvatarDecoration');
	return Value;
}

export function Nameplate(Value) {
	if (Value === '' || Value === null) return '';
	if (typeof Value !== 'string' || !PlateById.has(Value)) throw new HttpError(400, 'InvalidNameplate');
	return Value;
}
export const PublicNameplate = User => Misc.nameplates && PlateById.has(User.nameplate) ? PlateShape(PlateById.get(User.nameplate)) : null;

export const NameFonts = [11, 12, 3, 4, 6, 7, 8, 10, 13, 14, 15, 16];
export const NameEffects = { 1: 1, 2: 2, 3: 1, 4: 1, 5: 1, 7: 5, 8: 4 };
export function NameStyle(Value) {
	if (Value === null) return null;
	const Font = Number(Value?.font), Effect = Number(Value?.effect), Colors = Value?.colors;
	if (!NameFonts.includes(Font) || !NameEffects[Effect] || !Array.isArray(Colors) || Colors.length > NameEffects[Effect] || (!Colors.length && Effect !== 1)
		|| !Colors.every(Color => Number.isInteger(Color) && Color >= 0 && Color <= 0xFFFFFF)) throw new HttpError(400, 'InvalidNameStyle');
	return { font: Font, effect: Effect, colors: Colors };
}
export const PublicNameStyle = User => Misc.nameStyles && User.name_style ? User.name_style : null;

export async function NameplateFile(Config, Id, Kind) {
	if (!PlateById.has(Id)) throw new HttpError(404, 'NameplateNotFound');
	const Directory = join(Config.MediaDir, 'nameplates');
	const File = join(Directory, `${Id}.${Kind}`);
	const Cached = await readFile(File).catch(() => null);
	if (Cached) return Cached;
	if (!Pending.has(File)) Pending.set(File, (async () => {
		const Remote = await fetch(`https://cdn.discordapp.com/media/v1/collectibles-shop/${Id}/${Kind === 'png' ? 'static' : 'video'}`, { signal: AbortSignal.timeout(20000) }).catch(() => null);
		if (!Remote?.ok || Remote.headers.get('content-type') !== (Kind === 'png' ? 'image/png' : 'video/webm')) throw new HttpError(502, 'CouldntFetchNameplate');
		const Data = Buffer.from(await Remote.arrayBuffer());
		await mkdir(Directory, { recursive: true });
		const Temporary = join(Directory, `.${randomUUID()}`);
		await writeFile(Temporary, Data); await rename(Temporary, File);
		return Data;
	})().finally(() => Pending.delete(File)));
	return Pending.get(File);
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
