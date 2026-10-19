import { mkdir, mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Root } from '../src/client/archive.mjs';
const Files = ['package.json', 'package-lock.json', 'README.md', 'LICENSE', 'CHANGELOG.md', '.env.example', '.gitignore', '.dockerignore', 'Dockerfile', 'compose.yaml', 'src', 'scripts', 'migrations', 'public', 'docs', 'deploy', 'test'];
const Temp = await mkdtemp(join(tmpdir(), 'kittok-source-'));
try {
	const Target = join(Temp, 'kittok');
	await mkdir(Target);
	for (const Name of Files) await cp(join(Root, Name), join(Target, Name), { recursive: true });
	await mkdir(join(Root, 'dist'), { recursive: true });
	const Result = spawnSync('tar', ['-czf', join(Root, 'dist/kittok-0.1.0.tar.gz'), '-C', Temp, 'kittok'], { stdio: 'inherit' });
	if (Result.status !== 0) throw new Error('SourcePackagingFailed');
	console.log('dist/kittok-0.1.0.tar.gz');
} finally { await rm(Temp, { recursive: true, force: true }); }
