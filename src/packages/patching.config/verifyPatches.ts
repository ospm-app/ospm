import { PnpmError } from '../error/index.ts';
import { globalWarn } from '../logger/index.ts';
import type { PatchGroupRecord } from '../patching.types/index.ts';
import { allPatchKeys } from './allPatchKeys.ts';

export type VerifyPatchesOptions = {
  patchedDependencies: PatchGroupRecord;
  appliedPatches: Set<string>;
  allowUnusedPatches: boolean;
};

export function verifyPatches({
  patchedDependencies,
  appliedPatches,
  allowUnusedPatches,
}: VerifyPatchesOptions): void {
  const unusedPatches: string[] = [];

  for (const patchKey of allPatchKeys(patchedDependencies)) {
    if (!appliedPatches.has(patchKey)) unusedPatches.push(patchKey);
  }

  if (!unusedPatches.length) {
    return;
  }

  const message = `The following patches were not used: ${unusedPatches.join(', ')}`;

  if (allowUnusedPatches) {
    globalWarn(message);

    return;
  }

  throw new PnpmError('UNUSED_PATCH', message, {
    hint: 'Either remove them from "patchedDependencies" or update them to match packages in your dependencies.',
  });
}
