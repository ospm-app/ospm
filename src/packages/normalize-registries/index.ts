import type { Registries } from '../types/index.ts';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import normalizeRegistryUrl from 'normalize-registry-url';
import mapValues from 'ramda/src/map';

export const DEFAULT_REGISTRIES = {
  default: 'https://registry.npmjs.org/',
};

export function normalizeRegistries(
  registries?: Record<string, string>
): Registries {
  if (registries == null) return DEFAULT_REGISTRIES;
  const normalizeRegistries = mapValues.default(
    normalizeRegistryUrl,
    registries
  );
  return {
    ...DEFAULT_REGISTRIES,
    ...normalizeRegistries,
  };
}
