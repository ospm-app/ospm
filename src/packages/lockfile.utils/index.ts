import { refToRelative } from '../dependency-path/index.ts';

export { extendProjectsWithTargetDirs } from './extendProjectsWithTargetDirs.ts';
export { nameVerFromPkgSnapshot } from './nameVerFromPkgSnapshot.ts';
export { packageIdFromSnapshot } from './packageIdFromSnapshot.ts';
export { packageIsIndependent } from './packageIsIndependent.ts';
export { pkgSnapshotToResolution } from './pkgSnapshotToResolution.ts';
export { refIsLocalTarball, refIsLocalDirectory } from './refIsLocalTarball.ts';

// for backward compatibility
export const getPkgShortId = refToRelative;
