import { readFile, writeFile } from 'node:fs/promises';

const Source = process.argv[2];
if (!Source) throw new Error('Usage: node scripts/import-decorations.mjs collectibles.json');
const Categories = JSON.parse(await readFile(Source, 'utf8'));
const Collect = (Type, Valid, Entry) => {
	const Seen = new Map();
	for (const Category of Categories) {
		for (const Product of Category.products ?? []) {
			for (const Item of Product.items ?? []) {
				if (Item.type !== Type || !Valid(Item)) continue;
				const Own = Product.items.length === 1;
				const Existing = Seen.get(Item.sku_id);
				if (Existing && (Existing.Own || !Own)) continue;
				Seen.set(Item.sku_id, { Own, Entry: Entry(Item, Product.name.replace(/ Bundle$/, ''), Category.name) });
			}
		}
	}
	return [...Seen.values()].map(Value => Value.Entry);
};
const Decorations = Collect(0, Item => /^(a_)?[0-9a-f]{32}$/.test(Item.asset), (Item, Name, Collection) => [Item.sku_id, Item.asset, Name, Collection, Item.label ?? '']);
const Nameplates = Collect(2, Item => /^\d{17,20}$/.test(Item.sku_id), (Item, Name, Collection) => [Item.sku_id, Name, Collection, Item.label ?? '', Item.palette ?? '']);
await writeFile(new URL('../src/decorations.json', import.meta.url), JSON.stringify(Decorations) + '\n');
await writeFile(new URL('../src/nameplates.json', import.meta.url), JSON.stringify(Nameplates) + '\n');
console.log(`Wrote ${Decorations.length} decorations and ${Nameplates.length} nameplates.`);
