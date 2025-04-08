import type { PatchGroupRecord } from '../patching.types/index.ts';

export function* allPatchKeys(
  patchedDependencies: PatchGroupRecord
): Generator<string> {
  for (const name in patchedDependencies) {
    const group = patchedDependencies[name];

    if (typeof group === 'undefined') {
      continue;
    }

    for (const version in group.exact) {
      const v = group.exact[version];

      if (typeof v !== 'undefined') {
        yield v.key;
      }
    }

    for (const item of group.range) {
      yield item.patch.key;
    }

    if (group.all) {
      yield group.all.key;
    }
  }
}
