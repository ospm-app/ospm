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
  if (pref?.startsWith('npm:') === true) {
    const newPref = pref.slice(4);

    if (newPref.startsWith('@')) {
      return newPref.substring(0, newPref.indexOf('/'));
    }
  }

  if (pkgName.startsWith('@')) {
    return pkgName.substring(0, pkgName.indexOf('/'));
  }

  return null;
}
