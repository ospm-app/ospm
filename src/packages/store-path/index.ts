import { promises as fs } from 'node:fs';
import { STORE_VERSION } from '../constants/index.ts';
import { OspmError } from '../error/index.ts';
import rimraf from '@zkochan/rimraf';
import canLink from 'can-link';
import os from 'node:os';
import path from 'node:path';
import pathAbsolute from 'path-absolute';
import pathTemp from 'path-temp';
import rootLinkTarget from 'root-link-target';
import touch from 'touch';

export function getStorePath({
  pkgRoot,
  storePath,
  ospmHomeDir,
}: {
  pkgRoot: string;
  storePath?: string | undefined;
  ospmHomeDir?: string | undefined;
}): string | Promise<string> {
  if (typeof storePath === 'undefined') {
    if (typeof ospmHomeDir === 'undefined') {
      throw new OspmError(
        'NO_OSPM_HOME_DIR',
        'The ospm home directory is unknown. Cannot calculate the store directory location.'
      );
    }

    return storePathRelativeToHome(pkgRoot, 'store', ospmHomeDir);
  }

  if (isHomepath(storePath)) {
    const homedir = getHomedir();

    return storePathRelativeToHome(pkgRoot, storePath.substring(2), homedir);
  }

  const storeBasePath = pathAbsolute(storePath, pkgRoot);

  if (storeBasePath.endsWith(`${path.sep}${STORE_VERSION}`)) {
    return storeBasePath;
  }

  return path.join(storeBasePath, STORE_VERSION);
}

async function storePathRelativeToHome(
  pkgRoot: string,
  relStore: string,
  homedir: string
): Promise<string> {
  const tempFile = pathTemp(pkgRoot);
  if (path.parse(pkgRoot).root !== pkgRoot) {
    await fs.mkdir(path.dirname(tempFile), { recursive: true });
  }

  await touch(tempFile);

  const storeInHomeDir = path.join(homedir, relStore, STORE_VERSION);

  if (await canLinkToSubdir(tempFile, homedir)) {
    await fs.unlink(tempFile);

    // If the project is on the drive on which the OS home directory
    // then the store is placed in the home directory
    return storeInHomeDir;
  }

  try {
    let mountpoint = await rootLinkTarget(tempFile);

    // Usually, it is disallowed to write files into the drive's root.
    // So we create an empty directory and try to link there.
    // The store will be a directory anyway.
    const mountpointParent = path.join(mountpoint, '..');

    if (
      !dirsAreEqual(mountpointParent, mountpoint) &&
      (await canLinkToSubdir(tempFile, mountpointParent))
    ) {
      mountpoint = mountpointParent;
    }

    // If linking works only in the project folder
    // then prefer to place the store inside the homedir
    if (dirsAreEqual(pkgRoot, mountpoint)) {
      return storeInHomeDir;
    }

    return path.join(mountpoint, '.ospm-store', STORE_VERSION);
  } catch {
    // this is an unlikely situation but if there is no way to find
    // a linkable place on the disk, create the store in homedir
    return storeInHomeDir;
  } finally {
    await fs.unlink(tempFile);
  }
}

async function canLinkToSubdir(
  fileToLink: string,
  dir: string
): Promise<boolean> {
  const tmpDir = pathTemp(dir);

  try {
    await fs.mkdir(tmpDir, { recursive: true });

    return await canLink(fileToLink, pathTemp(tmpDir));
  } catch {
    return false;
  } finally {
    await safeRmdir(tmpDir);
  }
}

async function safeRmdir(dir: string): Promise<void> {
  try {
    // We cannot use just fs.rmdir here because can-link
    // sometimes might not remove the temporary file in time
    // and fs.rmdir can only remove an empty directory.
    await rimraf(dir);
  } catch {
    // ignore
  }
}

function dirsAreEqual(dir1: string, dir2: string): boolean {
  return path.relative(dir1, dir2) === '.';
}

function getHomedir(): string {
  const home = os.homedir();

  if (!home) {
    throw new Error('Could not find the homedir');
  }

  return home;
}

function isHomepath(filepath: string): boolean {
  return filepath.indexOf('~/') === 0 || filepath.indexOf('~\\') === 0;
}
