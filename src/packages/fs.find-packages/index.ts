import { promises as fs } from 'node:fs';
import path from 'node:path';
import util from 'node:util';
import { readExactProjectManifest } from '../read-project-manifest/index.ts';
import type {
  Project,
  ProjectRootDir,
  ProjectRootDirRealPath,
} from '../types/index.ts';
import { lexCompare } from '../util.lex-comparator/index.ts';
import { glob } from 'tinyglobby';
import pFilter from 'p-filter';

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/bower_components/**',
  '**/test/**',
  '**/tests/**',
];

export interface Options {
  ignore?: string[] | undefined;
  includeRoot?: boolean | undefined;
  patterns?: string[] | undefined;
}

export async function findPackages(
  root: string,
  opts?: Options | undefined
): Promise<Project[]> {
  const newOpts = opts ?? {};

  const globOpts = { ...newOpts, cwd: root, expandDirectories: false };

  globOpts.ignore = newOpts.ignore ?? DEFAULT_IGNORE;

  const patterns = normalizePatterns(newOpts.patterns ?? ['.', '**']);

  // biome-ignore lint/performance/noDelete: <explanation>
  delete globOpts.patterns;

  const paths: string[] = await glob(patterns, {
    ...globOpts,
    ignore: newOpts.ignore ?? DEFAULT_IGNORE,
  });

  if (globOpts.includeRoot === true) {
    // Always include the workspace root (https://github.com/pnpm/pnpm/issues/1986)
    Array.prototype.push.apply(
      paths,
      await glob(normalizePatterns(['.']), {
        ...globOpts,
        ignore: newOpts.ignore ?? DEFAULT_IGNORE,
      })
    );
  }

  return (
    await pFilter(
      // `Array.from()` doesn't create an intermediate instance,
      // unlike `array.map()`
      Array.from(
        // Remove duplicate paths using `Set`
        new Set(
          paths
            .map((manifestPath) => {
              return path.join(root, manifestPath);
            })
            .sort((path1, path2) => {
              return lexCompare(path.dirname(path1), path.dirname(path2));
            })
        ),
        async (manifestPath: string): Promise<Project | null> => {
          try {
            const rootDir = path.dirname(manifestPath);

            return {
              rootDir: rootDir as ProjectRootDir,
              rootDirRealPath: (await fs.realpath(
                rootDir
              )) as ProjectRootDirRealPath,
              ...(await readExactProjectManifest(manifestPath)),
            };
          } catch (err: unknown) {
            if (
              util.types.isNativeError(err) &&
              'code' in err &&
              err.code === 'ENOENT'
            ) {
              return null;
            }

            throw err;
          }
        }
      ),
      Boolean
    )
  ).filter(Boolean);
}

function normalizePatterns(patterns: readonly string[]): string[] {
  const normalizedPatterns: string[] = [];
  for (const pattern of patterns) {
    // We should add separate pattern for each extension
    // for some reason, fast-glob is buggy with /package.{json,yaml,json5} pattern
    normalizedPatterns.push(pattern.replace(/\/?$/, '/package.json'));
    normalizedPatterns.push(pattern.replace(/\/?$/, '/package.json5'));
    normalizedPatterns.push(pattern.replace(/\/?$/, '/package.yaml'));
  }
  return normalizedPatterns;
}
