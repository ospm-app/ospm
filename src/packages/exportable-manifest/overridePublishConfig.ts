import type { ProjectManifest } from '../types/index.ts';
import isEmpty from 'ramda/src/isEmpty';

// property keys that are copied from publishConfig into the manifest
const PUBLISH_CONFIG_WHITELIST = new Set([
  // manifest fields that may make sense to overwrite
  'bin',
  'type',
  'imports',
  // https://github.com/stereobooster/package.json#package-bundlers
  'main',
  'module',
  'typings',
  'types',
  'exports',
  'browser',
  'esnext',
  'es2015',
  'unpkg',
  'umd:main',
  // These are useful to hide in order to avoid warnings during local development
  'os',
  'cpu',
  'libc',
  // https://www.typescriptlang.org/docs/handbook/declaration-files/publishing.html#version-selection-with-typesversions
  'typesVersions',
]);

export function overridePublishConfig(publishManifest: ProjectManifest): void {
  const { publishConfig } = publishManifest;
  if (!publishConfig) return;

  for (const key in publishConfig) {
    if (!PUBLISH_CONFIG_WHITELIST.has(key)) {
      continue;
    }

    const value = publishConfig[key];

    publishManifest[key as keyof ProjectManifest] = value as never;

    delete publishConfig[key];
  }

  if (isEmpty.default(publishConfig)) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete publishManifest.publishConfig;
  }
}
