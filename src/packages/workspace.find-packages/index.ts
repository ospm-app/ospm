import { packageIsInstallable } from '../cli-utils/index.ts';
import { USEFUL_NON_ROOT_PNPM_FIELDS } from '../constants/index.ts';
import type {
  Project,
  ProjectManifest,
  SupportedArchitectures,
} from '../types/index.ts';
import { lexCompare } from '../util.lex-comparator/index.ts';
import { findPackages } from '../fs.find-packages/index.ts';
import { logger } from '../logger/index.ts';

export type { Project };

export type WorkspacePackagesPatterns = 'all-packages' | string[];

export interface FindWorkspacePackagesOpts {
  /**
   * An array of globs for the packages included in the workspace.
   *
   * In most cases, callers should read the pnpm-workspace.yml and pass the
   * "packages" field.
   */
  patterns?: string[] | undefined;

  engineStrict?: boolean | undefined;
  packageManagerStrict?: boolean | undefined;
  packageManagerStrictVersion?: boolean | undefined;
  nodeVersion?: string | undefined;
  sharedWorkspaceLockfile?: boolean | undefined;
  supportedArchitectures?: SupportedArchitectures | undefined;
}

export async function findWorkspacePackages(
  workspaceRoot: string,
  opts?: FindWorkspacePackagesOpts | undefined
): Promise<Project[]> {
  const pkgs = await findWorkspacePackagesNoCheck(workspaceRoot, {
    ...opts,
    patterns: opts?.patterns ?? [],
  });

  for (const pkg of pkgs) {
    packageIsInstallable(pkg.rootDir, pkg.manifest, {
      ...opts,
      supportedArchitectures: opts?.supportedArchitectures ?? {
        os: ['current'],
        cpu: ['current'],
        libc: ['current'],
      },
    });

    // When setting shared-workspace-lockfile=false, `pnpm` can be set in sub-project's package.json.
    if (
      opts?.sharedWorkspaceLockfile === true &&
      pkg.rootDir !== workspaceRoot
    ) {
      checkNonRootProjectManifest(pkg);
    }
  }

  return pkgs;
}

export async function findWorkspacePackagesNoCheck(
  workspaceRoot: string,
  opts?: { patterns?: string[] | undefined } | undefined
): Promise<Project[]> {
  const pkgs = await findPackages(workspaceRoot, {
    ignore: ['**/node_modules/**', '**/bower_components/**'],
    includeRoot: true,
    patterns: opts?.patterns,
  });

  pkgs.sort((pkg1: { rootDir: string }, pkg2: { rootDir: string }) =>
    lexCompare(pkg1.rootDir, pkg2.rootDir)
  );

  return pkgs;
}

const uselessNonRootManifestFields: Array<keyof ProjectManifest> = [
  'resolutions',
];

type ProjectManifestPnpm = Required<ProjectManifest>['pnpm'];
const usefulNonRootPnpmFields: ReadonlyArray<string> =
  USEFUL_NON_ROOT_PNPM_FIELDS;

function checkNonRootProjectManifest({ manifest, rootDir }: Project): void {
  const warn = printNonRootFieldWarning.bind(null, rootDir);

  for (const field of uselessNonRootManifestFields) {
    if (field in manifest) {
      warn(field);
    }
  }

  for (const field in manifest.pnpm) {
    if (!usefulNonRootPnpmFields.includes(field as keyof ProjectManifestPnpm)) {
      warn(`pnpm.${field}`);
    }
  }
}

function printNonRootFieldWarning(prefix: string, propertyPath: string): void {
  logger.warn({
    message: `The field "${propertyPath}" was found in ${prefix}/package.json. This will not take effect. You should configure "${propertyPath}" at the root of the workspace instead.`,
    prefix,
  });
}
