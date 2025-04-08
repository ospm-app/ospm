import path from 'node:path';
import pMapValues from 'p-map-values';
import { createHexHashFromFile } from '../crypto.hash/index.ts';
import type { PatchFile } from '../patching.types/index.ts';

export async function calcPatchHashes(
  patches: Record<string, string>,
  lockfileDir: string
): Promise<Record<string, PatchFile>> {
  return pMapValues.default(
    async (patchFilePath: string): Promise<{ hash: string; path: string }> => {
      return {
        hash: await createHexHashFromFile(patchFilePath),
        path: path.relative(lockfileDir, patchFilePath).replaceAll('\\', '/'),
      };
    },
    patches
  );
}
