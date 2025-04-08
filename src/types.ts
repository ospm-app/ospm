import type { Config } from './packages/config/index.ts';
import type { ReadPackageHook } from './packages/types/index.ts';
import type { ReporterType } from './reporter/index.ts';

export type PnpmOptions = Omit<Config, 'reporter'> & {
  argv: {
    cooked: string[];
    original: string[];
    remain: string[];
  };
  cliOptions: object;
  reporter?: ReporterType | undefined;
  packageManager?:
    | {
        name: string;
        version: string;
      }
    | undefined;

  hooks?:
    | {
        readPackage?: ReadPackageHook[] | undefined;
      }
    | undefined;

  ignoreFile?: ((filename: string) => boolean) | undefined;
};
