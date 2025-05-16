import { type LogBase, logger } from '../logger/index.ts';

export const stageLogger = logger<StageMessage>('stage');

export type StageMessage = {
  prefix: string;
  stage:
    | 'resolution_started'
    | 'resolution_done'
    | 'importing_started'
    | 'importing_done';
};

export type StageLog = { name: 'ospm:stage' } & LogBase & StageMessage;
