import { promises as fs, type Stats } from 'node:fs';
import path from 'node:path';
import { PnpmError } from '../error/index.ts';
import type { ProjectManifest } from '../types/index.ts';
import {
  extractComments,
  type CommentSpecifier,
} from '../text.comments-parser/index.ts';
import { writeProjectManifest } from '../write-project-manifest/index.ts';
import readYamlFile from 'read-yaml-file';
import detectIndent from '@gwhitney/detect-indent';
import equal from 'fast-deep-equal';
import isWindows from 'is-windows';
import { readJson5File, readJsonFile } from './readFile.ts';

export type WriteProjectManifest = (
  manifest: ProjectManifest,
  force?: boolean | undefined
) => Promise<void>;

export async function safeReadProjectManifestOnly(
  projectDir: string
): Promise<ProjectManifest | null> {
  try {
    return await readProjectManifestOnly(projectDir);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (
      (err as NodeJS.ErrnoException).code ===
      'ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND'
    ) {
      return null;
    }
    throw err;
  }
}

export async function readProjectManifest(projectDir: string): Promise<{
  fileName: string;
  manifest: ProjectManifest;
  writeProjectManifest: WriteProjectManifest;
}> {
  const result = await tryReadProjectManifest(projectDir);
  if (result.manifest !== null) {
    return result as {
      fileName: string;
      manifest: ProjectManifest;
      writeProjectManifest: WriteProjectManifest;
    };
  }
  throw new PnpmError(
    'NO_IMPORTER_MANIFEST_FOUND',
    `No package.json (or package.yaml, or package.json5) was found in "${projectDir}".`
  );
}

export async function readProjectManifestOnly(
  projectDir: string
): Promise<ProjectManifest> {
  const { manifest } = await readProjectManifest(projectDir);
  return manifest;
}

export async function tryReadProjectManifest(projectDir: string): Promise<{
  fileName: string;
  manifest: ProjectManifest | null;
  writeProjectManifest: WriteProjectManifest;
}> {
  try {
    const manifestPath = path.join(projectDir, 'package.json');
    const { data, text } = await readJsonFile(manifestPath);
    return {
      fileName: 'package.json',
      manifest: data,
      writeProjectManifest: createManifestWriter({
        ...detectFileFormatting(text),
        initialManifest: data,
        manifestPath,
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
  try {
    const manifestPath = path.join(projectDir, 'package.json5');
    const { data, text } = await readJson5File(manifestPath);
    return {
      fileName: 'package.json5',
      manifest: data,
      writeProjectManifest: createManifestWriter({
        ...detectFileFormattingAndComments(text),
        initialManifest: data,
        manifestPath,
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  try {
    const manifestPath = path.join(projectDir, 'package.yaml');

    const manifest = await readPackageYaml(manifestPath);

    return {
      fileName: 'package.yaml',
      manifest,
      writeProjectManifest: createManifestWriter({
        initialManifest: manifest,
        manifestPath,
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }

  if (isWindows()) {
    // ENOTDIR isn't used on Windows, but pnpm expects it.
    let s: Stats | undefined;

    try {
      s = await fs.stat(projectDir);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
    } catch (_err: any) {
      // Ignore
    }

    if (s != null && !s.isDirectory()) {
      const err = new Error(`"${projectDir}" is not a directory`);
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      err['code'] = 'ENOTDIR';
      throw err;
    }
  }

  const filePath = path.join(projectDir, 'package.json');

  return {
    fileName: 'package.json',
    manifest: null,
    writeProjectManifest: async (manifest: ProjectManifest) =>
      writeProjectManifest(filePath, manifest),
  };
}

interface FileFormattingAndComments {
  comments?: CommentSpecifier[] | undefined;
  indent: string;
  insertFinalNewline: boolean;
}

function detectFileFormattingAndComments(
  text: string
): FileFormattingAndComments {
  const { comments, text: newText, hasFinalNewline } = extractComments(text);

  return {
    comments,
    indent: detectIndent.default(newText).indent,
    insertFinalNewline: hasFinalNewline,
  };
}

interface FileFormatting {
  indent: string;
  insertFinalNewline: boolean;
}

function detectFileFormatting(text: string): FileFormatting {
  return {
    indent: detectIndent.default(text).indent,
    insertFinalNewline: text.endsWith('\n'),
  };
}

interface ReadExactProjectManifestResult {
  manifest: ProjectManifest;
  writeProjectManifest: WriteProjectManifest;
}

export async function readExactProjectManifest(
  manifestPath: string
): Promise<ReadExactProjectManifestResult> {
  const base = path.basename(manifestPath).toLowerCase();
  switch (base) {
    case 'package.json': {
      const { data, text } = await readJsonFile(manifestPath);
      return {
        manifest: data,
        writeProjectManifest: createManifestWriter({
          ...detectFileFormatting(text),
          initialManifest: data,
          manifestPath,
        }),
      };
    }
    case 'package.json5': {
      const { data, text } = await readJson5File(manifestPath);
      return {
        manifest: data,
        writeProjectManifest: createManifestWriter({
          ...detectFileFormattingAndComments(text),
          initialManifest: data,
          manifestPath,
        }),
      };
    }
    case 'package.yaml': {
      const manifest = await readPackageYaml(manifestPath);
      return {
        manifest,
        writeProjectManifest: createManifestWriter({
          initialManifest: manifest,
          manifestPath,
        }),
      };
    }
  }
  throw new Error(`Not supported manifest name "${base}"`);
}

async function readPackageYaml(filePath: string): Promise<ProjectManifest> {
  try {
    return await readYamlFile.default<ProjectManifest>(filePath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err.name !== 'YAMLException') throw err;
    err.message = `${err.message as string}\nin ${filePath}`;
    err.code = 'ERR_PNPM_YAML_PARSE';
    throw err;
  }
}

function createManifestWriter(opts: {
  initialManifest: ProjectManifest;
  comments?: CommentSpecifier[] | undefined;
  indent?: string | number | undefined;
  insertFinalNewline?: boolean;
  manifestPath: string;
}): WriteProjectManifest {
  let initialManifest = normalize(opts.initialManifest);
  return async (updatedManifest: ProjectManifest, force?: boolean) => {
    const newUpdatedManifest = normalize(updatedManifest);

    if (force === true || !equal(initialManifest, newUpdatedManifest)) {
      await writeProjectManifest(opts.manifestPath, newUpdatedManifest, {
        comments: opts.comments,
        indent: opts.indent,
        insertFinalNewline: opts.insertFinalNewline,
      });
      initialManifest = normalize(newUpdatedManifest);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(undefined);
  };
}

const dependencyKeys = new Set([
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
]);

function normalize(manifest: ProjectManifest): ProjectManifest {
  const result: Record<string, unknown> = {};

  for (const key in manifest) {
    if (Object.prototype.hasOwnProperty.call(manifest, key)) {
      const value = manifest[key as keyof ProjectManifest];

      if (typeof value !== 'object' || !dependencyKeys.has(key)) {
        result[key] = structuredClone(value);
      } else {
        const keys = Object.keys(value);
        if (keys.length !== 0) {
          keys.sort();
          const sortedValue: Record<string, unknown> = {};
          for (const k of keys) {
            // @ts-expect-error this is fine
            sortedValue[k] = value[k];
          }
          result[key] = sortedValue;
        }
      }
    }
  }

  // TODO: fix this
  return result as unknown as ProjectManifest;
}
