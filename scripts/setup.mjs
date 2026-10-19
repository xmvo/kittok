import { writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Root } from '../src/client/archive.mjs';
const Password = randomBytes(32).toString('hex');
const Body = `INSTANCE_NAME=Kittok\nINSTANCE_DESCRIPTION=A little corner of the internet for your videos.\nPUBLIC_ORIGIN=http://127.0.0.1:3210\nREGISTRATION_MODE=closed\nHOST=127.0.0.1\nPORT=3210\nHOST_PORT=3210\nPOSTGRES_PASSWORD=${Password}\nDATABASE_URL=postgresql://kittok:${Password}@127.0.0.1:5432/kittok\nMAX_VIDEO_MB=100\nMAX_VIDEO_SECONDS=600\n`;
try {
	await writeFile(join(Root, '.env'), Body, { flag: 'wx', mode: 0o600 });
	console.log('Created .env with a random database password. Set PUBLIC_ORIGIN to your domain before hosting.');
} catch (Error) {
	if (Error.code !== 'EEXIST') throw Error;
	console.log('.env already exists; preserved existing configuration.');
}
