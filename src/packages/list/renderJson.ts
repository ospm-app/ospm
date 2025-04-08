import { DEPENDENCIES_FIELDS, type DependenciesField } from '../types/index.ts';
import type { PackageNode } from '../reviewing.dependencies-hierarchy/index.ts';
import sortBy from 'ramda/src/sortBy';
import path from 'ramda/src/path';
import type { Ord } from 'ramda';
import { getPkgInfo, type PkgInfo } from './getPkgInfo.ts';
import type { PackageDependencyHierarchy } from './types.ts';

const sortPackages = sortBy.default(
  path.default(['pkg', 'alias']) as (pkg: PackageNode) => Ord
);

type RenderJsonResultItem = Pick<
  PackageDependencyHierarchy,
  'name' | 'version' | 'path'
> &
  Required<Pick<PackageDependencyHierarchy, 'private'>> & {
    dependencies?: Record<string, PackageJsonListItem> | undefined;
    devDependencies?: Record<string, PackageJsonListItem> | undefined;
    optionalDependencies?: Record<string, PackageJsonListItem> | undefined;
    unsavedDependencies?: Record<string, PackageJsonListItem> | undefined;
  };

export async function renderJson(
  pkgs: PackageDependencyHierarchy[],
  opts: {
    depth?: number | undefined;
    long?: boolean | undefined;
    search: boolean;
  }
): Promise<string> {
  const jsonArr = await Promise.all(
    pkgs.map(
      async (
        pkg: PackageDependencyHierarchy
      ): Promise<RenderJsonResultItem> => {
        const jsonObj: RenderJsonResultItem = {
          name: pkg.name,
          version: pkg.version,
          path: pkg.path,
          private: pkg.private,
        };

        Object.assign(
          jsonObj,
          Object.fromEntries(
            await Promise.all(
              ([...DEPENDENCIES_FIELDS.sort(), 'unsavedDependencies'] as const)
                .filter(
                  (
                    dependenciesField: DependenciesField | 'unsavedDependencies'
                  ): boolean => {
                    const p = pkg[dependenciesField as keyof typeof pkg];

                    return Array.isArray(p) && p.length > 0;
                  }
                )
                .map(
                  async (
                    dependenciesField: DependenciesField | 'unsavedDependencies'
                  ): Promise<
                    readonly [
                      DependenciesField | 'unsavedDependencies',
                      Record<string, PackageJsonListItem>,
                    ]
                  > => {
                    return [
                      dependenciesField,
                      await toJsonResult(
                        // Argument of type 'string | boolean | undefined' is not assignable to parameter of type 'PackageNode[]'.
                        // Type 'undefined' is not assignable to type 'PackageNode[]'.ts(2345)
                        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                        // @ts-expect-error
                        pkg[dependenciesField as keyof typeof pkg],
                        {
                          long: opts.long,
                        }
                      ),
                    ] as const;
                  }
                )
            )
          )
        );

        return jsonObj;
      }
    )
  );

  return JSON.stringify(jsonArr, null, 2);
}

export async function toJsonResult(
  entryNodes: PackageNode[],
  opts: {
    long: boolean;
  }
): Promise<Record<string, PackageJsonListItem>> {
  const dependencies: Record<string, PackageJsonListItem> = {};

  await Promise.all(
    sortPackages(entryNodes).map(async (node: PackageNode): Promise<void> => {
      const subDependencies = await toJsonResult(node.dependencies ?? [], opts);

      const dep: PackageJsonListItem = opts.long
        ? await getPkgInfo(node)
        : {
            alias: node.alias as string | undefined,
            from: node.name,
            version: node.version,
            resolved: node.resolved,
            path: node.path,
          };

      if (Object.keys(subDependencies).length > 0) {
        dep.dependencies = subDependencies;
      }

      if (typeof dep.resolved === 'undefined' || dep.resolved === '') {
        // biome-ignore lint/performance/noDelete: <explanation>
        delete dep.resolved;
      }

      // biome-ignore lint/performance/noDelete: <explanation>
      delete dep.alias;

      dependencies[node.alias] = dep;
    })
  );

  return dependencies;
}

interface PackageJsonListItem extends PkgInfo {
  dependencies?: Record<string, PackageJsonListItem> | undefined;
}
