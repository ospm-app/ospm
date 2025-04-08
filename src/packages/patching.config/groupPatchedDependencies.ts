import * as dp from '../dependency-path/index.ts';
import { PnpmError } from '../error/index.ts';
import type {
  PatchFile,
  PatchGroup,
  PatchGroupRecord,
} from '../patching.types/index.ts';
import { validRange } from 'semver';

export function groupPatchedDependencies(
  patchedDependencies: Record<string, PatchFile>
): PatchGroupRecord {
  const result: PatchGroupRecord = {};

  function getGroup(name: string): PatchGroup {
    let group: PatchGroup | undefined = result[name];

    if (group) {
      return group;
    }

    group = {
      exact: {},
      range: [],
      all: undefined,
    };

    result[name] = group;

    return group;
  }

  for (const key in patchedDependencies) {
    const file = patchedDependencies[key];

    if (typeof file === 'undefined') {
      continue;
    }

    const { name, version, nonSemverVersion } = dp.parse(key);

    if (typeof name === 'string' && typeof version === 'string') {
      getGroup(name).exact[version] = { strict: true, file, key };

      continue;
    }

    if (typeof name === 'string' && typeof nonSemverVersion !== 'undefined') {
      if (validRange(nonSemverVersion) === null) {
        throw new PnpmError(
          'PATCH_NON_SEMVER_RANGE',
          `${nonSemverVersion} is not a valid semantic version range.`
        );
      }

      if (nonSemverVersion.trim() === '*') {
        getGroup(name).all = { strict: true, file, key };
      } else {
        getGroup(name).range.push({
          version: nonSemverVersion,
          patch: { strict: true, file, key },
        });
      }

      continue;
    }

    // Set `strict` to `false` to preserve backward compatibility.
    getGroup(key).all = { strict: false, file, key };
  }

  return result;
}
