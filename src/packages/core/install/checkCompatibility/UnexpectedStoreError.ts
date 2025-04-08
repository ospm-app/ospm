import type { ModulesDir } from 'src/packages/types/project.ts';
import { PnpmError } from '../../../error/index.ts';

export class UnexpectedStoreError extends PnpmError {
  expectedStorePath: string;
  actualStorePath: string;
  modulesDir: ModulesDir;

  constructor(opts: {
    expectedStorePath: string;
    actualStorePath: string;
    modulesDir: ModulesDir;
  }) {
    super('UNEXPECTED_STORE', 'Unexpected store location');
    this.expectedStorePath = opts.expectedStorePath;
    this.actualStorePath = opts.actualStorePath;
    this.modulesDir = opts.modulesDir;
  }
}
