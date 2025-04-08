import * as utils from '../read-project-manifest/index.ts';
import type {
  ProjectManifest,
  SupportedArchitectures,
} from '../types/index.ts';
import { packageIsInstallable } from './packageIsInstallable.ts';

export type ReadProjectManifestOpts = {
  engineStrict?: boolean | undefined;
  packageManagerStrict?: boolean | undefined;
  packageManagerStrictVersion?: boolean | undefined;
  nodeVersion?: string | undefined;
  supportedArchitectures?: SupportedArchitectures | undefined;
};

// type BaseReadProjectManifestResult = {
//   fileName: string;
//   writeProjectManifest: (
//     manifest: ProjectManifest,
//     force?: boolean | undefined
//   ) => Promise<void>;
// }

export type ReadProjectManifestResult = {
  fileName: string;
  writeProjectManifest: (
    manifest: ProjectManifest,
    force?: boolean | undefined
  ) => Promise<void>;
  manifest: ProjectManifest;
};

export async function readProjectManifest(
  projectDir: string,
  opts: ReadProjectManifestOpts = {}
): Promise<ReadProjectManifestResult> {
  const { fileName, manifest, writeProjectManifest } =
    await utils.readProjectManifest(projectDir);

  packageIsInstallable(projectDir, manifest, opts);

  return { fileName, manifest, writeProjectManifest };
}

export async function readProjectManifestOnly(
  projectDir: string,
  opts: ReadProjectManifestOpts = {}
): Promise<ProjectManifest> {
  const manifest = await utils.readProjectManifestOnly(projectDir);
  packageIsInstallable(projectDir, manifest, opts);
  return manifest;
}

export type TryReadProjectManifestResult = {
  fileName: string;
  writeProjectManifest: (
    manifest: ProjectManifest,
    force?: boolean | undefined
  ) => Promise<void>;
  manifest: ProjectManifest | null;
};

export async function tryReadProjectManifest(
  projectDir: string,
  opts: ReadProjectManifestOpts
): Promise<TryReadProjectManifestResult> {
  const { fileName, manifest, writeProjectManifest } =
    await utils.tryReadProjectManifest(projectDir);

  if (manifest === null) {
    return { fileName, manifest, writeProjectManifest };
  }

  await packageIsInstallable(projectDir, manifest, opts);

  return { fileName, manifest, writeProjectManifest };
}
