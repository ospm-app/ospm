import path from 'node:path';
import type { DependencyManifest, PackageBin } from '../types/index.ts';
import { glob } from 'tinyglobby';
import isSubdir from 'is-subdir';

export type Command = {
  name: string;
  path: string;
};

export async function getBinsFromPackageManifest(
  manifest: DependencyManifest,
  pkgPath: string
): Promise<Command[]> {
  if (typeof manifest.bin !== 'undefined') {
    return commandsFromBin(manifest.bin, manifest.name, pkgPath);
  }

  if (typeof manifest.directories?.bin !== 'undefined') {
    const binDir = path.join(pkgPath, manifest.directories.bin);

    const files = await findFiles(binDir);

    return files.map((file) => ({
      name: path.basename(file),
      path: path.join(binDir, file),
    }));
  }

  return [];
}

async function findFiles(dir: string): Promise<string[]> {
  try {
    return await glob('**', {
      cwd: dir,
      onlyFiles: true,
      followSymbolicLinks: false,
      expandDirectories: false,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }

    return [];
  }
}

function commandsFromBin(
  bin: PackageBin,
  pkgName: string,
  pkgPath: string
): Array<{
  name: string;
  path: string;
}> {
  if (typeof bin === 'string') {
    return [
      {
        name: normalizeBinName(pkgName),
        path: path.join(pkgPath, bin),
      },
    ];
  }
  return Object.keys(bin)
    .filter(
      (commandName) =>
        encodeURIComponent(commandName) === commandName ||
        commandName === '$' ||
        commandName.startsWith('@')
    )
    .map((commandName) => {
      const binPath = bin[commandName];

      if (typeof binPath !== 'string') {
        return null;
      }

      return {
        name: normalizeBinName(commandName),
        path: path.join(pkgPath, binPath),
      };
    })
    .filter(Boolean)
    .filter((cmd) => {
      return isSubdir(pkgPath, cmd.path);
    });
}

function normalizeBinName(name: string): string {
  return name.startsWith('@') ? name.slice(name.indexOf('/') + 1) : name;
}
