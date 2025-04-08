import { PnpmError } from '../error/index.ts';
import semver from 'semver';
import type { PartialUndefined } from '../exec.pkg-requires-build/index.ts';

export class UnsupportedEngineError extends PnpmError {
  wanted: WantedEngine;
  current: Engine;
  packageId: string;

  constructor(packageId: string, wanted: WantedEngine, current: Engine) {
    super(
      'UNSUPPORTED_ENGINE',
      `Unsupported engine for ${packageId}: wanted: ${JSON.stringify(wanted)} (current: ${JSON.stringify(current)})`
    );

    this.packageId = packageId;
    this.wanted = wanted;
    this.current = current;
  }
}

export function checkEngine(
  packageId: string,
  wantedEngine: WantedEngine | undefined,
  currentEngine: Engine
): UnsupportedEngineError | null {
  if (typeof wantedEngine === 'undefined') {
    return null;
  }

  const unsatisfiedWanted: WantedEngine = {};

  if (
    typeof wantedEngine.node === 'string' &&
    !semver.satisfies(currentEngine.node, wantedEngine.node, {
      includePrerelease: true,
    })
  ) {
    unsatisfiedWanted.node = wantedEngine.node;
  }

  if (
    typeof currentEngine.pnpm === 'string' &&
    typeof wantedEngine.pnpm === 'string' &&
    !semver.satisfies(currentEngine.pnpm, wantedEngine.pnpm, {
      includePrerelease: true,
    })
  ) {
    unsatisfiedWanted.pnpm = wantedEngine.pnpm;
  }

  if (Object.keys(unsatisfiedWanted).length > 0) {
    return new UnsupportedEngineError(
      packageId,
      unsatisfiedWanted,
      currentEngine
    );
  }

  return null;
}

export interface Engine {
  node: string;
  pnpm?: string | undefined;
}

export type WantedEngine = PartialUndefined<Engine>;
