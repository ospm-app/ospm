import path from 'node:path';
import type { PackageManifest } from '../types/index.ts';
import { loadJsonFileSync } from 'load-json-file';

let ospmPkgJson: PackageManifest;

try {
  ospmPkgJson = loadJsonFileSync<PackageManifest>(
    path.resolve(__dirname, '../package.json')
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
} catch (_err: any) {
  ospmPkgJson = {
    name: 'ospm',
    version: '0.0.0',
  };
}

export { ospmPkgJson };
