import type { LogBase } from '../logger/index.ts';

export type RegistryLog = { name: 'ospm:registry' } & LogBase & {
    message: string;
  };
