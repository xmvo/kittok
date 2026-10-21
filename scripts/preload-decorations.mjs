import { readFileSync } from 'node:fs';
import { LoadConfig } from '../src/config.mjs';
import { DecorationImage } from '../src/decorations.mjs';

const Config = LoadConfig();
const Assets = JSON.parse(readFileSync(new URL('../src/decorations.json', import.meta.url), 'utf8')).map(Entry => Entry[1]);
const Jobs = Assets.flatMap(Asset => [[Asset, true], [Asset, false]]);
let Next = 0, Done = 0, Failed = 0;
async function Worker() {
	while (Next < Jobs.length) {
		const [Asset, Still] = Jobs[Next++];
		try { await DecorationImage(Config, Asset, Still); } catch { Failed++; }
		if (++Done % 100 === 0 || Done === Jobs.length) console.log(`${Done}/${Jobs.length} images, ${Failed} failed`);
	}
}
await Promise.all(Array.from({ length: 6 }, Worker));
