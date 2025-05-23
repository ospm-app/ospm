import path from 'node:path';
import type { DependencyManifest } from '../types/index.ts';
import { loadJsonFile } from 'load-json-file';
import process from 'node:process';

const defaultManifest = {
  name:
    process.env.npm_package_name != null && process.env.npm_package_name !== ''
      ? process.env.npm_package_name
      : 'ospm',
  version:
    process.env.npm_package_version != null &&
    process.env.npm_package_version !== ''
      ? process.env.npm_package_version
      : '0.0.0',
};

let pkgJson: DependencyManifest | undefined;

if (require.main == null) {
  pkgJson = defaultManifest;
} else {
  try {
    pkgJson = {
      ...defaultManifest,
      ...loadJsonFile<DependencyManifest>(
        path.join(path.dirname(require.main.filename), '../package.json')
      ),
    };
  } catch {
    pkgJson = defaultManifest;
  }
}

export const packageManager = {
  name: pkgJson.name,
  // Never a prerelease version
  stableVersion: pkgJson.version.includes('-')
    ? pkgJson.version.slice(0, pkgJson.version.indexOf('-'))
    : pkgJson.version,
  // This may be a 3.0.0-beta.2
  version: pkgJson.version,
};

export interface Process {
  arch: NodeJS.Architecture;
  platform: NodeJS.Platform;
  pkg?: unknown;
}

export function detectIfCurrentPkgIsExecutable(
  proc: Process = process
): boolean {
  return 'pkg' in proc && proc.pkg != null;
}

export function isExecutedByCorepack(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.COREPACK_ROOT != null;
}

export function getCurrentPackageName(proc: Process = process): string {
  return detectIfCurrentPkgIsExecutable(proc)
    ? getExePackageName(proc)
    : 'ospm';
}

function getExePackageName(proc: Process): string {
  return `@ospm/${normalizePlatformName(proc)}-${normalizeArchName(proc)}`;
}

function normalizePlatformName(proc: Process): string {
  switch (proc.platform) {
    case 'win32':
      return 'win';
    case 'darwin':
      return 'macos';
    default:
      return proc.platform;
  }
}

function normalizeArchName(proc: Process): string {
  if (proc.platform === 'win32' && proc.arch === 'ia32') {
    return 'x86';
  }
  return proc.arch;
}
