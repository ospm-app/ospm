import type { PackageScripts } from '../types/index.ts';
import didYouMean, { ReturnTypeEnums } from 'didyoumean2';
import { readdirSync } from 'node:fs';
import path from 'node:path';

export function getNearestProgram({
  dir,
  modulesDir,
  programName,
  workspaceDir,
}: {
  dir: string;
  modulesDir: string;
  programName: string;
  workspaceDir: string | undefined;
}): string | null {
  try {
    const binDir = path.join(dir, modulesDir, '.bin');

    const programList = readProgramsFromDir(binDir);

    if (typeof workspaceDir === 'string' && workspaceDir !== dir) {
      const workspaceBinDir = path.join(workspaceDir, modulesDir, '.bin');
      programList.push(...readProgramsFromDir(workspaceBinDir));
    }

    return getNearest(programName, programList);
  } catch {
    return null;
  }
}

function readProgramsFromDir(binDir: string): string[] {
  const files = readdirSync(binDir);

  if (process.platform !== 'win32') {
    return files;
  }

  const executableExtensions = ['.cmd', '.bat', '.ps1', '.exe', '.com'];

  return files.map((fullName: string): string => {
    const { name, ext } = path.parse(fullName);

    return executableExtensions.includes(ext.toLowerCase()) ? name : fullName;
  });
}

export function buildCommandNotFoundHint(
  scriptName: string,
  scripts?: PackageScripts | undefined
): string {
  let hint = `Command "${scriptName}" not found.`;

  const nearestCommand = getNearestScript(scriptName, scripts);

  if (typeof nearestCommand === 'string') {
    hint += ` Did you mean "ospm run ${nearestCommand}"?`;
  }

  return hint;
}

export function getNearestScript(
  scriptName: string,
  scripts?: PackageScripts | undefined
): string | null {
  return getNearest(scriptName, Object.keys(scripts ?? []));
}

export function getNearest(
  name: string,
  list: readonly string[] | null
): string | null {
  if (list == null || list.length === 0) return null;
  return didYouMean(name, list, {
    returnType: ReturnTypeEnums.FIRST_CLOSEST_MATCH,
  });
}
