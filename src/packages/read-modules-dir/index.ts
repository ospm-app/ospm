import path from 'node:path';
import util from 'node:util';
import gracefulFs from 'graceful-fs';

const readdir = util.promisify(gracefulFs.readdir);

export async function readModulesDir(
  modulesDir: string
): Promise<string[] | null> {
  try {
    return await _readModulesDir(modulesDir);
  } catch (err: unknown) {
    if (util.types.isNativeError(err) && 'code' in err && err.code === 'ENOENT')
      return null;
    throw err;
  }
}

async function _readModulesDir(
  modulesDir: string,
  scope?: string | undefined
): Promise<string[]> {
  const pkgNames: string[] = [];

  const parentDir =
    typeof scope === 'string' ? path.join(modulesDir, scope) : modulesDir;

  await Promise.all(
    (await readdir(parentDir, { withFileTypes: true })).map(async (dir) => {
      if (dir.isFile() || dir.name[0] === '.') return;

      if (typeof scope === 'undefined' && dir.name[0] === '@') {
        pkgNames.push(...(await _readModulesDir(modulesDir, dir.name)));
        return;
      }

      const pkgName =
        typeof scope === 'string' ? `${scope}/${dir.name as string}` : dir.name;
      pkgNames.push(pkgName);
    })
  );
  return pkgNames;
}
