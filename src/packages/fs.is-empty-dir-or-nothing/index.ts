import fs from 'node:fs';

export function isEmptyDirOrNothing(path: string): boolean {
  try {
    const pathStat = fs.statSync(path);

    if (pathStat.isFile()) {
      return pathStat.size === 0;
    }

    return isDirEmpty(path);
  } catch (error: unknown) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return true;
    }

    // If an error other than ENOENT is thrown, we cannot promise that the path is empty
    return false;
  }
}

function isDirEmpty(path: string): boolean {
  const files = fs.readdirSync(path);
  return files.length === 0;
}
