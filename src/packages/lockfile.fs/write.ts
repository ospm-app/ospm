import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  LockfileObject,
  LockfileFile,
  ProjectSnapshot,
} from '../lockfile.types/index.ts';
import { WANTED_LOCKFILE } from '../constants/index.ts';
import rimraf from '@zkochan/rimraf';
import yaml from 'js-yaml';
import isEmpty from 'ramda/src/isEmpty';
import writeFileAtomicCB from 'write-file-atomic';
import { lockfileLogger as logger } from './logger.ts';
import { sortLockfileKeys } from './sortLockfileKeys.ts';
import { getWantedLockfileName } from './lockfileName.ts';
import { convertToLockfileFile } from './lockfileFormatConverters.ts';

async function writeFileAtomic(filename: string, data: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    writeFileAtomicCB(filename, data, {}, (err?: Error): void => {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      err != null ? reject(err) : resolve();
    });
  });
}

const LOCKFILE_YAML_FORMAT = {
  blankLines: true,
  lineWidth: -1, // This is setting line width to never wrap
  noCompatMode: true,
  noRefs: true,
  sortKeys: false,
};

export async function writeWantedLockfile(
  pkgPath: string,
  wantedLockfile: LockfileObject,
  opts?:
    | {
        useGitBranchLockfile?: boolean | undefined;
        mergeGitBranchLockfiles?: boolean | undefined;
      }
    | undefined
): Promise<void> {
  const wantedLockfileName: string = await getWantedLockfileName(opts);

  return writeLockfile(wantedLockfileName, pkgPath, wantedLockfile);
}

export async function writeCurrentLockfile(
  virtualStoreDir: string,
  currentLockfile: LockfileObject
): Promise<void> {
  // empty lockfile is not saved
  if (isEmptyLockfile(currentLockfile)) {
    await rimraf(path.join(virtualStoreDir, 'lock.yaml'));

    return;
  }

  await fs.mkdir(virtualStoreDir, { recursive: true });

  return writeLockfile('lock.yaml', virtualStoreDir, currentLockfile);
}

async function writeLockfile(
  lockfileFilename: string,
  pkgPath: string,
  wantedLockfile: LockfileObject
): Promise<void> {
  const lockfilePath = path.join(pkgPath, lockfileFilename);

  const lockfileToStringify = convertToLockfileFile(wantedLockfile);

  return writeLockfileFile(lockfilePath, lockfileToStringify);
}

export function writeLockfileFile(
  lockfilePath: string,
  wantedLockfile: LockfileFile
): Promise<void> {
  const yamlDoc = yamlStringify(wantedLockfile);

  return writeFileAtomic(lockfilePath, yamlDoc);
}

function yamlStringify(lockfile: LockfileFile): string {
  const sortedLockfile = sortLockfileKeys(lockfile as LockfileFile);

  return yaml.dump(sortedLockfile, LOCKFILE_YAML_FORMAT);
}

export function isEmptyLockfile(lockfile: LockfileObject): boolean {
  return Object.values(lockfile.importers ?? {}).every(
    (importer: ProjectSnapshot): boolean => {
      return (
        isEmpty.default(importer.specifiers) &&
        isEmpty.default(importer.dependencies ?? {})
      );
    }
  );
}

export async function writeLockfiles(opts: {
  wantedLockfile: LockfileObject;
  wantedLockfileDir: string;
  currentLockfile: LockfileObject;
  currentLockfileDir: string;
  useGitBranchLockfile?: boolean | undefined;
  mergeGitBranchLockfiles?: boolean | undefined;
}): Promise<void> {
  const wantedLockfileName: string = await getWantedLockfileName(opts);

  const wantedLockfilePath = path.join(
    opts.wantedLockfileDir,
    wantedLockfileName
  );

  const currentLockfilePath = path.join(opts.currentLockfileDir, 'lock.yaml');

  const wantedLockfileToStringify = convertToLockfileFile(opts.wantedLockfile);

  const yamlDoc = yamlStringify(wantedLockfileToStringify);

  // in most cases the `ospm-lock.yaml` and `node_modules/.ospm-lock.yaml` are equal
  // in those cases the YAML document can be stringified only once for both files
  // which is more efficient
  if (opts.wantedLockfile === opts.currentLockfile) {
    await Promise.all([
      writeFileAtomic(wantedLockfilePath, yamlDoc),
      (async (): Promise<void> => {
        if (isEmptyLockfile(opts.wantedLockfile)) {
          await rimraf(currentLockfilePath);
        } else {
          await fs.mkdir(path.dirname(currentLockfilePath), {
            recursive: true,
          });

          await writeFileAtomic(currentLockfilePath, yamlDoc);
        }
      })(),
    ]);

    return;
  }

  logger.debug({
    message: `\`${WANTED_LOCKFILE}\` differs from \`${path.relative(opts.wantedLockfileDir, currentLockfilePath)}\``,
    prefix: opts.wantedLockfileDir,
  });

  const currentLockfileToStringify = convertToLockfileFile(
    opts.currentLockfile
  );

  const currentYamlDoc = yamlStringify(currentLockfileToStringify);

  await Promise.all([
    writeFileAtomic(wantedLockfilePath, yamlDoc),
    (async (): Promise<void> => {
      if (isEmptyLockfile(opts.wantedLockfile)) {
        await rimraf(currentLockfilePath);
      } else {
        await fs.mkdir(path.dirname(currentLockfilePath), { recursive: true });

        await writeFileAtomic(currentLockfilePath, currentYamlDoc);
      }
    })(),
  ]);
}
