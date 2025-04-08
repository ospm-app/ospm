import type { LogBase } from '../logger/index.ts';

export type RegistryLog = { name: 'pnpm:registry' } & LogBase & {
    message: string;
  };
