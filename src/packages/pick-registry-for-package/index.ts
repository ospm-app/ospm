import type { Registries } from '../types/index.ts';

export function pickRegistryForPackage(
  registries: Registries,
  packageName: string,
  pref?: string | undefined
): string {
  const scope = getScope(packageName, pref);

  return scope !== null ? (registries[scope] ?? '') : registries.default;
}

function getScope(pkgName: string, pref?: string | undefined): string | null {
  if (typeof pref === 'string' && pref !== '') {
    if (pref.startsWith('npm:') === true) {
      const newPref = pref.slice(4);

      if (newPref.startsWith('@') === true) {
        return newPref.substring(0, newPref.indexOf('/'));
      }
    }

    if (pref.startsWith('ospm:') === true) {
      const newPref = pref.slice(4);

      if (newPref.startsWith('$') === true) {
        return newPref.substring(0, newPref.indexOf('/'));
      }
    }
  }

  if (pkgName.startsWith('$') === true) {
    return pkgName.substring(0, pkgName.indexOf('/'));
  }

  if (pkgName.startsWith('@') === true) {
    return pkgName.substring(0, pkgName.indexOf('/'));
  }

  return null;
}
