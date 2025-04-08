import { type LogBase, logger } from '../logger/index.ts';

export const scopeLogger = logger<ScopeMessage>('scope');

export type ScopeMessage = {
  selected: number;
  total?: number | undefined;
  workspacePrefix?: string | undefined;
};

export type ScopeLog = { name: 'pnpm:scope' } & LogBase & ScopeMessage;
