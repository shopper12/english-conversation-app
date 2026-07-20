import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serverTarget = resolve(root, 'dist', 'server');
await mkdir(serverTarget, { recursive: true });
await cp(resolve(root, 'server'), serverTarget, { recursive: true });
