import { PnpmError } from '../error/index.ts';
import type { SupportedArchitectures } from '../types/index.ts';
import { familySync as getLibcFamilySync } from 'detect-libc';

const currentLibc = getLibcFamilySync() ?? 'unknown';

export class UnsupportedPlatformError extends PnpmError {
  wanted: WantedPlatform;
  current: Platform;

  constructor(packageId: string, wanted: WantedPlatform, current: Platform) {
    super(
      'UNSUPPORTED_PLATFORM',
      `Unsupported platform for ${packageId}: wanted ${JSON.stringify(wanted)} (current: ${JSON.stringify(current)})`
    );
    this.wanted = wanted;
    this.current = current;
  }
}

export function checkPlatform(
  packageId: string,
  wantedPlatform: WantedPlatform,
  supportedArchitectures?: SupportedArchitectures
): UnsupportedPlatformError | null {
  const current = {
    os: dedupeCurrent(
      process.platform,
      supportedArchitectures?.os ?? ['current']
    ),
    cpu: dedupeCurrent(
      process.arch,
      supportedArchitectures?.cpu ?? ['current']
    ),
    libc: dedupeCurrent(
      currentLibc,
      supportedArchitectures?.libc ?? ['current']
    ),
  };

  const { platform, arch } = process;
  let osOk = true;
  let cpuOk = true;
  let libcOk = true;

  if (typeof wantedPlatform.os !== 'undefined') {
    osOk = checkList(current.os, wantedPlatform.os);
  }
  if (typeof wantedPlatform.cpu !== 'undefined') {
    cpuOk = checkList(current.cpu, wantedPlatform.cpu);
  }
  if (typeof wantedPlatform.libc !== 'undefined' && currentLibc !== 'unknown') {
    libcOk = checkList(current.libc, wantedPlatform.libc);
  }

  if (!osOk || !cpuOk || !libcOk) {
    return new UnsupportedPlatformError(packageId, wantedPlatform, {
      os: platform,
      cpu: arch,
      libc: currentLibc,
    });
  }

  return null;
}

export interface Platform {
  cpu: string | string[];
  os: string | string[];
  libc: string | string[];
}

export type WantedPlatform = Partial<Platform>;

function checkList(value: string | string[], list: string | string[]): boolean {
  let tmp: string | undefined;
  let match = false;
  let blc = 0;

  let newList = list;

  if (typeof newList === 'string') {
    newList = [newList];
  }

  newList = newList.filter((value) => typeof value === 'string');

  if (newList.length === 1 && newList[0] === 'any') {
    return true;
  }

  const values = Array.isArray(value) ? value : [value];

  for (const value of values) {
    for (let i = 0; i < newList.length; ++i) {
      tmp = newList[i];

      if (typeof tmp !== 'string') {
        continue;
      }

      if (tmp[0] === '!') {
        tmp = tmp.slice(1);
        if (tmp === value) {
          return false;
        }
        ++blc;
      } else {
        match = match || tmp === value;
      }
    }
  }

  return match || blc === list.length;
}

function dedupeCurrent(current: string, supported: string[]): string[] {
  return supported.map((supported) => {
    return supported === 'current' ? current : supported;
  });
}
