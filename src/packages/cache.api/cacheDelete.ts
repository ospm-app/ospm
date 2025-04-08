import path from 'node:path';
import fs from 'node:fs';
import { findMetadataFiles } from './cacheList.ts';

export async function cacheDelete(
  opts: { cacheDir: string; registry?: string | undefined },
  filter: string[]
): Promise<string> {
  const metaFiles = await findMetadataFiles(opts, filter);

  for (const metaFile of metaFiles) {
    fs.unlinkSync(path.join(opts.cacheDir, metaFile));
  }

  return metaFiles.sort().join('\n');
}
