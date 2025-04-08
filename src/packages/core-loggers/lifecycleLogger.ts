import { type LogBase, logger } from '../logger/index.ts';

export const lifecycleLogger = logger<LifecycleMessage>('lifecycle');

// TODO: make depPath optional
export type LifecycleMessageBase = {
  depPath: string;
  stage: string;
  wd: string;
  exitCode?: number | undefined;
  line?: string | undefined;
  optional?: boolean | undefined;
  script?: string | undefined;
  stdio?: 'stdout' | 'stderr' | undefined;
};

export interface StdioLifecycleMessage extends LifecycleMessageBase {
  line: string;
  stdio: 'stdout' | 'stderr';
}

export interface ExitLifecycleMessage extends LifecycleMessageBase {
  exitCode: number;
  optional: boolean;
}

export interface ScriptLifecycleMessage extends LifecycleMessageBase {
  script: string;
  optional: boolean;
}

export type LifecycleMessage =
  | StdioLifecycleMessage
  | ExitLifecycleMessage
  | ScriptLifecycleMessage;

export type LifecycleLog = { name: 'pnpm:lifecycle' } & LogBase &
  LifecycleMessage;
