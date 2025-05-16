import type { ModulesDir } from 'src/packages/types/project.ts';
import { OspmError } from '../../../error/index.ts';

export class UnexpectedVirtualStoreDirError extends OspmError {
  expected: string;
  actual: string;
  modulesDir: ModulesDir;

  constructor(opts: {
    expected: string;
    actual: string;
    modulesDir: ModulesDir;
  }) {
    super('UNEXPECTED_VIRTUAL_STORE', 'Unexpected virtual store location');
    this.expected = opts.expected;
    this.actual = opts.actual;
    this.modulesDir = opts.modulesDir;
  }
}
