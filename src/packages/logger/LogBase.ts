import type { LogLevel } from './LogLevel.ts';

export type OptionalErrorProperties = {
  pkgsStack?: Array<{ id: string; name: string; version: string }> | undefined;
  hint?: string | undefined;
  package?:
    | {
        name?: string | undefined;
        pref?: string | undefined;
        version?: string | undefined;
      }
    | undefined;
  err?: NodeJS.ErrnoException | undefined;
};

export interface LogBaseTemplate extends OptionalErrorProperties {
  level?: LogLevel | undefined;
  prefix?: string | undefined;
  message?: string | undefined;
}

export interface LogBaseDebug extends LogBaseTemplate {
  level: 'debug';
}

export interface LogBaseError extends LogBaseTemplate {
  level: 'error';
}

export interface LogBaseInfo extends LogBaseTemplate {
  level: 'info';
  prefix: string;
  message: string;
}

export interface LogBaseWarn extends LogBaseTemplate {
  level: 'warn';
  prefix: string;
  message: string;
}

export type LogBase = LogBaseDebug | LogBaseError | LogBaseInfo | LogBaseWarn;
