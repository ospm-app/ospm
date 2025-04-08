import type { LogBase } from '../logger/index.ts';

export type ReporterFunction = (logObj: LogBase) => void;
