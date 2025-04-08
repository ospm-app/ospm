import parseNpmTarballUrl from 'parse-npm-tarball-url';
import getVersionSelectorType from 'version-selector-type';

export interface RegistryPackageSpec {
  type: 'tag' | 'version' | 'range';
  name: string;
  fetchSpec: string;
  normalizedPref?: string | undefined;
}

export function parsePref(
  pref: string,
  alias: string | undefined,
  defaultTag: string,
  registry: string
): RegistryPackageSpec | null {
  let name = alias;

  let newPref = pref;

  if (pref.startsWith('npm:')) {
    newPref = newPref.slice(4);

    const index = newPref.lastIndexOf('@');

    if (index < 1) {
      name = newPref;
      newPref = defaultTag;
    } else {
      name = newPref.slice(0, index);
      newPref = newPref.slice(index + 1);
    }
  }

  if (typeof name === 'string' && name !== '') {
    const selector = getVersionSelectorType(newPref);

    if (selector != null) {
      return {
        fetchSpec: selector.normalized,
        name,
        type: selector.type,
      };
    }
  }

  if (newPref.startsWith(registry)) {
    const pkg = parseNpmTarballUrl.default(newPref);

    if (pkg != null) {
      return {
        fetchSpec: pkg.version,
        name: pkg.name,
        normalizedPref: newPref,
        type: 'version',
      };
    }
  }
  return null;
}
