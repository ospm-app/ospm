import path from 'node:path';
import type { FetchFunction, FetchOptions } from '../fetcher-base/index.ts';
import type { Cafs } from '../cafs-types/index.ts';
import gfs from '../graceful-fs/index.ts';
import { addFilesFromTarball, type AddFilesResult } from '../worker/index.ts';
import type { Resolution } from '../resolver-base/index.ts';

// eslint-disable-next-line optimize-regex/optimize-regex
const isAbsolutePath = /^\/|^[A-Z]:/i;

export function createLocalTarballFetcher(): FetchFunction<
  Resolution,
  FetchOptions,
  AddFilesResult
> {
  return (
    cafs: Cafs,
    resolution: Resolution,
    opts: FetchOptions
  ): Promise<AddFilesResult> => {
    const tarball = resolvePath(
      opts.lockfileDir,
      resolution.tarball?.slice(5) ?? ''
    );

    const buffer = gfs.readFileSync(tarball);

    return addFilesFromTarball({
      storeDir: cafs.storeDir,
      buffer,
      filesIndexFile: opts.filesIndexFile,
      integrity: 'integrity' in resolution ? resolution.integrity : undefined,
      readManifest: opts.readManifest,
      url: tarball,
      pkg: opts.pkg,
    });
  };
}

function resolvePath(where: string, spec: string): string {
  if (isAbsolutePath.test(spec)) return spec;
  return path.resolve(where, spec);
}
