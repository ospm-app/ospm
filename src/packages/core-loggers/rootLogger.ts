import { type LogBase, logger } from '../logger/index.ts';

export const rootLogger = logger<RootMessage>('root');

export type DependencyType = 'prod' | 'dev' | 'optional';

export type RootMessage = {
  prefix: string;
} & (
  | {
      added: {
        id?: string | undefined;
        name: string;
        realName: string;
        version?: string | undefined;
        dependencyType?: DependencyType | undefined;
        latest?: string | undefined;
        linkedFrom?: string | undefined;
      };
    }
  | {
      removed: {
        name: string;
        version?: string | undefined;
        dependencyType?: DependencyType | undefined;
      };
    }
);

export type RootLog = { name: 'ospm:root' } & LogBase & RootMessage;
