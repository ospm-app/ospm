import type { RegistryPackageSpec } from './parsePref.ts';

export function toRaw(spec: RegistryPackageSpec): string {
  return `${spec.name}@${spec.fetchSpec}`;
}
