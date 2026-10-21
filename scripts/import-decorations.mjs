import { readFile, writeFile } from 'node:fs/promises';

const Source = process.argv[2];
if (!Source) throw new Error('Usage: node scripts/import-decorations.mjs collectibles.json');
const Categories = JSON.parse(await readFile(Source, 'utf8'));
const Seen = new Map();
for (const Category of Categories) {
	for (const Product of Category.products ?? []) {
		for (const Item of Product.items ?? []) {
			if (Item.type !== 0 || !/^(a_)?[0-9a-f]{32}$/.test(Item.asset)) continue;
			const Own = Product.items.length === 1;
			const Existing = Seen.get(Item.sku_id);
			if (Existing && (Existing.Own || !Own)) continue;
			Seen.set(Item.sku_id, { Own, Entry: [Item.sku_id, Item.asset, Product.name.replace(/ Bundle$/, ''), Category.name, Item.label ?? ''] });
		}
	}
}
const Decorations = [...Seen.values()].map(Value => Value.Entry);
await writeFile(new URL('../src/decorations.json', import.meta.url), JSON.stringify(Decorations) + '\n');
console.log(`Wrote ${Decorations.length} decorations.`);
