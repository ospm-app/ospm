import path from 'node:path';
import type {
  DepPath,
  DependenciesField,
  HoistedDependencies,
  ModulesDir,
  Registries,
} from '../types/index.ts';
import readYamlFile from 'read-yaml-file';
import mapValues from 'ramda/src/map';
import isWindows from 'is-windows';
import writeYamlFile from 'write-yaml-file';

// The dot prefix is needed because otherwise `npm shrinkwrap`
// thinks that it is an extraneous package.
const MODULES_FILENAME = '.modules.yaml';

export type IncludedDependencies = {
  [dependenciesField in DependenciesField]: boolean;
};

export interface Modules {
  hoistedAliases?: { [depPath: DepPath]: string[] } | undefined; // for backward compatibility
  hoistedDependencies: HoistedDependencies;
  hoistPattern?: string[] | undefined;
  included?: IncludedDependencies | undefined;
  layoutVersion: number;
  nodeLinker?: 'hoisted' | 'isolated' | 'pnp' | undefined;
  packageManager: string;
  pendingBuilds: string[];
  ignoredBuilds?: string[] | undefined;
  prunedAt: string;
  registries?: Registries | undefined; // nullable for backward compatibility
  shamefullyHoist?: boolean | undefined; // for backward compatibility
  publicHoistPattern?: string[] | undefined;
  skipped: string[];
  storeDir: string;
  virtualStoreDir: string;
  virtualStoreDirMaxLength?: number | undefined;
  injectedDeps?: Record<string, string[]> | undefined;
  hoistedLocations?: Record<string, string[]> | undefined;
}

export async function readModulesManifest(
  modulesDir: ModulesDir
): Promise<Modules | null> {
  const modulesYamlPath = path.join(modulesDir, MODULES_FILENAME);

  let modules!: Modules;

  try {
    modules = await readYamlFile.default<Modules>(modulesYamlPath);

    if (typeof modules === 'undefined') {
      return modules;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }

    return null;
  }

  if (!modules.virtualStoreDir) {
    modules.virtualStoreDir = path.join(modulesDir, '.pnpm');
  } else if (!path.isAbsolute(modules.virtualStoreDir)) {
    modules.virtualStoreDir = path.join(modulesDir, modules.virtualStoreDir);
  }

  switch (modules.shamefullyHoist) {
    case true: {
      if (modules.publicHoistPattern == null) {
        modules.publicHoistPattern = ['*'];
      }

      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition, @typescript-eslint/strict-boolean-expressions
      if (modules.hoistedAliases != null && !modules.hoistedDependencies) {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        // Type 'Record<DepPath, { [k: string]: string; }>' is not assignable to type 'HoistedDependencies'.
        // 'string & { __brand: "DepPath"; }' index signatures are incompatible.
        // Type '{ [k: string]: string; }' is not assignable to type 'Record<string, "public" | "private">'.
        // 'string' index signatures are incompatible.
        // Type 'string' is not assignable to type '"public" | "private"'.ts(2322)
        modules.hoistedDependencies = mapValues.default(
          (
            aliases: string[]
          ): {
            [k: string]: string;
          } => {
            return Object.fromEntries(
              aliases.map((alias) => [alias, 'public'])
            );
          },
          modules.hoistedAliases
        );
      }

      break;
    }

    case false: {
      if (modules.publicHoistPattern == null) {
        modules.publicHoistPattern = [];
      }

      if (
        typeof modules.hoistedAliases !== 'undefined' &&
        typeof modules.hoistedDependencies === 'undefined'
      ) {
        modules.hoistedDependencies = {};

        for (const depPath of Object.keys(modules.hoistedAliases)) {
          modules.hoistedDependencies[depPath as DepPath] = {};

          for (const alias of modules.hoistedAliases[depPath as DepPath] ??
            []) {
            const dep = modules.hoistedDependencies[depPath as DepPath];

            if (typeof dep !== 'undefined') {
              dep[alias] = 'private';
            }
          }
        }
      }

      break;
    }
  }

  if (!modules.prunedAt) {
    modules.prunedAt = new Date().toUTCString();
  }

  if (typeof modules.virtualStoreDirMaxLength === 'undefined') {
    modules.virtualStoreDirMaxLength = 120;
  }

  return modules;
}

const YAML_OPTS = {
  lineWidth: 1000,
  noCompatMode: true,
  noRefs: true,
  sortKeys: true,
};

export async function writeModulesManifest(
  modulesDir: ModulesDir,
  modules: Modules & { registries: Registries },
  opts?:
    | {
        makeModulesDir?: boolean | undefined;
      }
    | undefined
): Promise<void> {
  const modulesYamlPath = path.join(modulesDir, MODULES_FILENAME);

  const saveModules = { ...modules };

  if (Array.isArray(saveModules.skipped)) {
    saveModules.skipped.sort();
  }

  if (
    saveModules.hoistPattern == null ||
    (saveModules.hoistPattern as unknown) === ''
  ) {
    // Because the YAML writer fails on undefined fields
    // biome-ignore lint/performance/noDelete: <explanation>
    delete saveModules.hoistPattern;
  }
  if (saveModules.publicHoistPattern == null) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete saveModules.publicHoistPattern;
  }
  if (
    saveModules.hoistedAliases == null ||
    (saveModules.hoistPattern == null && saveModules.publicHoistPattern == null)
  ) {
    // biome-ignore lint/performance/noDelete: <explanation>
    delete saveModules.hoistedAliases;
  }

  // We should store the absolute virtual store directory path on Windows
  // because junctions are used on Windows. Junctions will break even if
  // the relative path to the virtual store remains the same after moving
  // a project.
  if (!isWindows()) {
    saveModules.virtualStoreDir = path.relative(
      modulesDir,
      saveModules.virtualStoreDir
    );
  }
  try {
    await writeYamlFile(modulesYamlPath, saveModules, {
      ...YAML_OPTS,
      makeDir: opts?.makeModulesDir ?? false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}
