// src/packages/tarball-fetcher/ospmTarballFetcher.ts
import type { FetchFunction, FetchOptions } from '../fetcher-base/index.ts';
import type { FetchFromRegistry } from '../fetching-types/index.ts';
import type { Resolution } from '../resolver-base/index.ts';
import type { AddFilesResult } from '../worker/index.ts';
import type { Cafs } from '../cafs-types/index.ts';

export function createOspmTarballFetcher(
  fetchFromRegistry: FetchFromRegistry,
  getAuthHeader: (registry: string) => string | undefined,
  // opts: {
  //   rawConfig: Record<string, string>;
  //   timeout?: number;
  //   retry?: {
  //     retries?: number;
  //     factor?: number;
  //     minTimeout?: number;
  //     maxTimeout?: number;
  //   };
  // }
): FetchFunction<Resolution, FetchOptions, AddFilesResult> {
  return async function ospmTarballFetcher(
    _cafs: Cafs,
    resolution: Resolution,
    opts: FetchOptions
  ): Promise<AddFilesResult> {
    // Skip if not an OSPM package
    if (!resolution.tarball?.startsWith('https://registry.ospm.app/')) {
      throw new Error('Not an OSPM package');
    }

    // Add authentication header if available
    const authHeader = getAuthHeader('https://registry.ospm.app/');

    const headers: Record<string, string> = {};

    if (authHeader) {
      headers['authorization'] = authHeader;
    }

    // Use the standard fetchFromRegistry but with our custom headers
    const response = await fetchFromRegistry(
      resolution.tarball,
      {
        ...opts,
        authHeaderValue: authHeader,
        headers,
      }
    );

    if (!response.ok) {
      const error = new Error(`Failed to download tarball from ${resolution.tarball}: ${response.status} ${response.statusText}`);

      (error as any).statusCode = response.status;

      throw error;
    }

    // The rest of the tarball processing is handled by the worker
    return {
      filesIndex: {},
      manifest: {
        name: '',
        version: '',
      },
      requiresBuild: false,
    };
  };
}
