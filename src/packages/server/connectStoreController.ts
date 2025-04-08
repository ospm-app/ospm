import { fetch } from '../fetch/index.ts';
import type {
  FetchPackageToStoreOptions,
  FetchResponse,
  PackageResponse,
  PackageStoreManagerResponse,
  RequestPackageOptions,
  StoreController,
} from '../store-controller-types/index.ts';

import pLimit, { type LimitFunction } from 'p-limit';
import pShare from 'promise-share';
import { v4 as uuidv4 } from 'uuid';
import type { PackageManifest } from '../types/package.ts';
import type { WantedDependency } from '../resolve-dependencies/index.ts';
import type { PkgResolutionId } from '../types/index.ts';
import type { PackageFilesResponse } from '../cafs-types/index.ts';
import type {
  DirectoryResolution,
  Resolution,
} from '../resolver-base/index.ts';

export type StoreServerController<RP, FP, IP> = StoreController<RP, FP, IP> & {
  stop: () => Promise<void>;
};

export async function connectStoreController(initOpts: {
  remotePrefix: string;
  concurrency?: number | undefined;
}): Promise<
  StoreServerController<
    PackageResponse,
    {
      filesIndexFile?: string | undefined;
      inStoreLocation?: string | undefined;
    },
    PackageResponse
  >
> {
  const remotePrefix = initOpts.remotePrefix;

  const limitedFetch = limitFetch.bind<
    null,
    [LimitFunction],
    [url: string, body: object],
    Promise<PackageResponse>
  >(null, pLimit(initOpts.concurrency ?? 100));

  return new Promise((resolve, _reject): void => {
    resolve({
      close: async () => {},
      fetchPackage: fetchPackage.bind(null, remotePrefix, limitedFetch),
      getFilesIndexFilePath: () => {
        return { filesIndexFile: '', target: '' };
      }, // NOT IMPLEMENTED
      importPackage: async (
        to: string,
        opts: {
          filesResponse: PackageFilesResponse;
          force: boolean;
        }
      ): Promise<PackageResponse> => {
        return limitedFetch(`${remotePrefix}/importPackage`, {
          opts,
          to,
        });
      },
      prune: async () => {
        await limitedFetch(`${remotePrefix}/prune`, {});
      },
      requestPackage: requestPackage.bind<
        null,
        [string, (url: string, body: object) => Promise<PackageResponse>],
        [wantedDependency: WantedDependency, options: RequestPackageOptions],
        Promise<PackageResponse>
      >(null, remotePrefix, limitedFetch),
      stop: async () => {
        await limitedFetch(`${remotePrefix}/stop`, {});
      },
      upload: async (
        builtPkgLocation: string,
        opts: { filesIndexFile: string; sideEffectsCacheKey: string }
      ) => {
        await limitedFetch(`${remotePrefix}/upload`, {
          builtPkgLocation,
          opts,
        });
      },
      clearResolutionCache: () => {},
    });
  });
}

export async function connectStoreManagerController<IP>(initOpts: {
  remotePrefix: string;
  concurrency?: number | undefined;
}): Promise<StoreServerController<PackageResponse, PackageResponse, IP>> {
  const remotePrefix = initOpts.remotePrefix;

  function limitStoreManagerFetch(
    limit: (fn: () => PromiseLike<IP>) => Promise<IP>,
    url: string,
    body: object
  ): Promise<IP> {
    let newUrl = url;

    return limit(async (): Promise<IP> => {
      // TODO: the http://unix: should be also supported by the fetcher
      // but it fails with node-fetch-unix as of v2.3.0
      if (newUrl.startsWith('http://unix:')) {
        newUrl = newUrl.replace('http://unix:', 'unix:');
      }

      const response = await fetch(url, {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        retry: {
          retries: 100,
        },
      });

      if (!response.ok) {
        throw await response.json();
      }

      // TODO: valibot schema
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = (await response.json()) as any;

      // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
      if (json.error) {
        throw json.error;
      }

      return json as IP;
    });
  }

  const limitedFetch = limitStoreManagerFetch.bind<
    null,
    [LimitFunction],
    [url: string, body: object],
    Promise<IP>
  >(null, pLimit(initOpts.concurrency ?? 100));

  return new Promise((resolve, _reject): void => {
    resolve({
      close: async () => {},
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      fetchPackage: fetchStoreManagerPackage.bind<
        null,
        [string, (url: string, body: object) => Promise<IP>],
        [options: FetchPackageToStoreOptions],
        Promise<{
          filesIndexFile?: string | undefined;
          inStoreLocation?: string | undefined;
        }>
      >(null, remotePrefix, limitedFetch),
      getFilesIndexFilePath: () => {
        return { filesIndexFile: '', target: '' };
      }, // NOT IMPLEMENTED
      importPackage: async (
        to: string,
        opts: {
          filesResponse: PackageFilesResponse;
          force: boolean;
        }
      ): Promise<IP> => {
        return limitedFetch(`${remotePrefix}/importPackage`, {
          opts,
          to,
        });
      },
      prune: async () => {
        await limitedFetch(`${remotePrefix}/prune`, {});
      },
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      requestPackage: requestStoreManagerPackage.bind<
        null,
        [
          string,
          (
            url: string,
            body: object
          ) => Promise<{ isBuilt: boolean; importMethod?: string | undefined }>,
        ],
        [wantedDependency: WantedDependency, options: RequestPackageOptions],
        Promise<{ isBuilt: boolean; importMethod?: string | undefined }>
      >(null, remotePrefix, limitedFetch),
      stop: async () => {
        await limitedFetch(`${remotePrefix}/stop`, {});
      },
      upload: async (
        builtPkgLocation: string,
        opts: { filesIndexFile: string; sideEffectsCacheKey: string }
      ) => {
        await limitedFetch(`${remotePrefix}/upload`, {
          builtPkgLocation,
          opts,
        });
      },
      clearResolutionCache: () => {},
    });
  });
}

function limitFetch(
  limit: (fn: () => PromiseLike<PackageResponse>) => Promise<PackageResponse>,
  url: string,
  body: object
): Promise<PackageResponse> {
  let newUrl = url;

  return limit(async (): Promise<PackageResponse> => {
    // TODO: the http://unix: should be also supported by the fetcher
    // but it fails with node-fetch-unix as of v2.3.0
    if (newUrl.startsWith('http://unix:')) {
      newUrl = newUrl.replace('http://unix:', 'unix:');
    }

    const response = await fetch(url, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      retry: {
        retries: 100,
      },
    });

    if (!response.ok) {
      throw await response.json();
    }

    // TODO: valibot schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = (await response.json()) as any;

    // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
    if (json.error) {
      throw json.error;
    }

    return json as PackageResponse;
  });
}

async function requestPackage(
  remotePrefix: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  limitedFetch: (url: string, body: object) => any,
  wantedDependency: WantedDependency,
  options: RequestPackageOptions
): Promise<PackageResponse> {
  const msgId = uuidv4();

  const packageResponseBody = await limitedFetch(
    `${remotePrefix}/requestPackage`,
    {
      msgId,
      options,
      wantedDependency,
    }
  );

  if (options.skipFetch === true) {
    return { body: packageResponseBody };
  }

  const fetchingFiles = limitedFetch(`${remotePrefix}/packageFilesResponse`, {
    msgId,
  });

  return {
    body: packageResponseBody,
    fetching: pShare(fetchingFiles),
  };
}

async function requestStoreManagerPackage(
  remotePrefix: string,
  limitedFetch: <R>(url: string, body: object) => Promise<R>,
  wantedDependency: WantedDependency,
  options: RequestPackageOptions
): Promise<
  PackageStoreManagerResponse<{
    isBuilt: boolean;
    importMethod?: string | undefined;
  }>
> {
  const msgId = uuidv4();

  const packageResponseBody:
    | ({
        isLocal: boolean;
        isInstallable?: boolean | undefined;
        resolution?: Resolution | undefined;
        manifest?: PackageManifest | undefined;
        id: PkgResolutionId;
        normalizedPref?: string | undefined;
        updated: boolean;
        publishedAt?: string | undefined;
        resolvedVia?: string | undefined;
        latest?: string | undefined;
      } & (
        | {
            isLocal: true;
            resolution: DirectoryResolution;
          }
        | {
            isLocal: false;
          }
      ))
    | undefined = await limitedFetch(`${remotePrefix}/requestPackage`, {
    msgId,
    options,
    wantedDependency,
  });

  if (options.skipFetch === true) {
    return { body: packageResponseBody };
  }

  const fetchingFiles = limitedFetch<{
    isBuilt: boolean;
    importMethod?: string | undefined;
  }>(`${remotePrefix}/packageFilesResponse`, {
    msgId,
  });

  return {
    body: packageResponseBody,
    fetching: pShare(fetchingFiles),
  };
}

async function fetchPackage(
  remotePrefix: string,
  limitedFetch: (
    url: string,
    body: object
  ) => Promise<{
    filesIndexFile?: string | undefined;
    inStoreLocation?: string | undefined;
  }>,
  options: FetchPackageToStoreOptions
): Promise<
  FetchResponse<{
    filesIndexFile?: string | undefined;
    inStoreLocation?: string | undefined;
  }>
> {
  const msgId = uuidv4();

  const fetchResponseBody = await limitedFetch(`${remotePrefix}/fetchPackage`, {
    msgId,
    options,
  });

  const fetching = limitedFetch(`${remotePrefix}/packageFilesResponse`, {
    msgId,
  });

  return {
    fetching: pShare(fetching),
    filesIndexFile: fetchResponseBody.filesIndexFile,
    inStoreLocation: fetchResponseBody.inStoreLocation,
  };
}

async function fetchStoreManagerPackage(
  remotePrefix: string,
  limitedFetch: <R>(url: string, body: object) => Promise<R>,
  options: FetchPackageToStoreOptions
): Promise<
  FetchResponse<{ isBuilt: boolean; importMethod?: string | undefined }>
> {
  const msgId = uuidv4();

  const fetchResponseBody = await limitedFetch<{
    filesIndexFile?: string | undefined;
    inStoreLocation?: string | undefined;
  }>(`${remotePrefix}/fetchPackage`, {
    msgId,
    options,
  });

  const fetching = limitedFetch<{
    isBuilt: boolean;
    importMethod?: string | undefined;
  }>(`${remotePrefix}/packageFilesResponse`, {
    msgId,
  });

  return {
    fetching: pShare(fetching),
    filesIndexFile: fetchResponseBody.filesIndexFile,
    inStoreLocation: fetchResponseBody.inStoreLocation,
  };
}
