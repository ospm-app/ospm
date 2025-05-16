import fs from 'node:fs';
import path from 'node:path';
import { OspmError } from '../error/index.ts';
import type {
  FetchFromRegistry,
  RetryTimeoutOptions,
} from '../fetching-types/index.ts';
import { pickFetcher } from '../pick-fetcher/index.ts';
import { createCafsStore } from '../create-cafs-store/index.ts';
import { createTarballFetcher } from '../tarball-fetcher/index.ts';
import AdmZip from 'adm-zip';
import renameOverwrite from 'rename-overwrite';
import { temporaryDirectory } from 'tempy';
import { isNonGlibcLinux } from 'detect-libc';
import { getNodeTarball } from './getNodeTarball.ts';

export type FetchNodeOptions = {
  storeDir: string;
  fetchTimeout?: number | undefined;
  nodeMirrorBaseUrl?: string | undefined;
  retry?: RetryTimeoutOptions | undefined;
};

export async function fetchNode(
  fetch: FetchFromRegistry,
  version: string,
  targetDir: string,
  opts: FetchNodeOptions
): Promise<void> {
  if (await isNonGlibcLinux()) {
    throw new OspmError(
      'MUSL',
      'The current system uses the "MUSL" C standard library. Node.js currently has prebuilt artifacts only for the "glibc" libc, so we can install Node.js only for glibc'
    );
  }

  const nodeMirrorBaseUrl =
    opts.nodeMirrorBaseUrl ?? 'https://nodejs.org/download/release/';

  const { tarball, pkgName } = getNodeTarball(
    version,
    nodeMirrorBaseUrl,
    process.platform,
    process.arch
  );

  if (tarball.endsWith('.zip')) {
    await downloadAndUnpackZip(fetch, tarball, targetDir, pkgName);
    return;
  }

  const getAuthHeader = (): string | undefined => {
    return;
  };

  const fetchers = createTarballFetcher(fetch, getAuthHeader, {
    retry: opts.retry,
    timeout: opts.fetchTimeout,
    // These are not needed for fetching Node.js
    rawConfig: {},
    unsafePerm: false,
  });

  const cafs = createCafsStore(opts.storeDir);

  const fetchTarball = pickFetcher(fetchers, { tarball });

  const { filesIndex } = await fetchTarball(
    cafs,
    // TODO: fix any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { tarball } as any,
    {
      // TODO: change the name or don't save an index file for node.js tarballs
      filesIndexFile: path.join(opts.storeDir, encodeURIComponent(tarball)),
      lockfileDir: process.cwd(),
      pkg: {},
    }
  );

  cafs.importPackage(targetDir, {
    filesResponse: {
      unprocessed: false,
      filesIndex: filesIndex as Record<string, string>,
      resolvedFrom: 'remote',
      requiresBuild: false,
    },
    force: true,
  });
}

async function downloadAndUnpackZip(
  fetchFromRegistry: FetchFromRegistry,
  zipUrl: string,
  targetDir: string,
  pkgName: string
): Promise<void> {
  const response = await fetchFromRegistry(zipUrl);

  const tmp = path.join(temporaryDirectory(), 'ospm.zip');

  const dest = fs.createWriteStream(tmp);

  await new Promise((resolve, reject): void => {
    response.body
      ?.pipe(dest)
      .on('error', reject)
      .on('close', (): void => {
        resolve(undefined);
      });
  });

  const zip = new AdmZip(tmp);

  const nodeDir = path.dirname(targetDir);

  zip.extractAllTo(nodeDir, true);

  await renameOverwrite(path.join(nodeDir, pkgName), targetDir);

  await fs.promises.unlink(tmp);
}
