import { LoadConfig } from '../src/config.mjs';
import { DecorationAssets, DecorationImage, LoadCollectibles } from '../src/decorations.mjs';

const Config = LoadConfig();
await LoadCollectibles(Config);
const Assets = DecorationAssets();
if (!Assets.length) { console.error('Import Discord collectibles first: npm run collectibles -- collectibles.json, or Misc in the admin panel'); process.exit(1); }
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
