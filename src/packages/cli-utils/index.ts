import { packageManager } from '../cli-meta/index.ts';

export { getConfig } from './getConfig.ts';
export * from './packageIsInstallable.ts';
export * from './readDepNameCompletions.ts';
export * from './readProjectManifest.ts';
export * from './recursiveSummary.ts';
export * from './style.ts';

export function docsUrl(cmd: string): string {
  const [ospmMajorVersion] = packageManager.version.split('.');
  return `https://ospm.app/${ospmMajorVersion}.x/cli/${cmd}`;
}
