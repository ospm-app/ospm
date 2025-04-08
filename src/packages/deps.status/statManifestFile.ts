import type fs from 'node:fs';
import path from 'node:path';
import { MANIFEST_BASE_NAMES } from '../constants/index.ts';
import { safeStat } from './safeStat.ts';

export async function statManifestFile(
  projectRootDir: string
): Promise<fs.Stats | undefined> {
  const attempts = await Promise.all(
    MANIFEST_BASE_NAMES.map(
      (
        baseName: 'package.json' | 'package.json5' | 'package.yaml'
      ): Promise<fs.Stats | undefined> => {
        const manifestPath = path.join(projectRootDir, baseName);

        return safeStat(manifestPath);
      }
    )
  );

  return attempts.find((stats: fs.Stats | undefined): stats is fs.Stats => {
    return typeof stats !== 'undefined';
  });
}
