import path from 'node:path';
import type { PackageManifest } from '../types/index.ts';
import { loadJsonFileSync } from 'load-json-file';

let pnpmPkgJson: PackageManifest;

try {
  pnpmPkgJson = loadJsonFileSync<PackageManifest>(
    path.resolve(__dirname, '../package.json')
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
} catch (_err: any) {
  pnpmPkgJson = {
    name: 'pnpm',
    version: '0.0.0',
  };
}

export { pnpmPkgJson };
