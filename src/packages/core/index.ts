export type { HoistingLimits } from '../headless/index.ts';
export * from './api.ts';

export { UnexpectedStoreError } from './install/checkCompatibility/UnexpectedStoreError.js';
export { UnexpectedVirtualStoreDirError } from './install/checkCompatibility/UnexpectedVirtualStoreDirError.js';
export type { InstallOptions } from './install/extendInstallOptions.js';

export type { WorkspacePackages } from '../resolver-base/index.ts';
export type { UpdateMatchingFunction } from '../resolve-dependencies/index.ts';
