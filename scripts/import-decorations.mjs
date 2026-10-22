import { readFile } from 'node:fs/promises';
import { LoadConfig } from '../src/config.mjs';
import { SaveCollectibles } from '../src/decorations.mjs';

const Source = process.argv[2];
if (!Source) { console.error('Usage: npm run collectibles -- collectibles.json'); process.exit(1); }
const Counts = await SaveCollectibles(LoadConfig(), JSON.parse(await readFile(Source, 'utf8')));
console.log(`Imported ${Counts.decorations} decorations and ${Counts.nameplates} nameplates. Restart Kittok to load them, or import from Misc in the admin panel instead.`);
