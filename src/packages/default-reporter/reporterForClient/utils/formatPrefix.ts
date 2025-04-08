import path from 'node:path';
import normalize from 'normalize-path';
import { PREFIX_MAX_LENGTH } from '../outputConstants.ts';

export function formatPrefix(cwd: string, prefix: string): string {
  const newPrefix = formatPrefixNoTrim(cwd, prefix);

  if (newPrefix.length <= PREFIX_MAX_LENGTH) {
    return newPrefix;
  }

  const shortPrefix = newPrefix.slice(-PREFIX_MAX_LENGTH + 3);

  const separatorLocation = shortPrefix.indexOf('/');

  if (separatorLocation <= 0) {
    return `...${shortPrefix}`;
  }

  return `...${shortPrefix.slice(separatorLocation)}`;
}

export function formatPrefixNoTrim(cwd: string, newPrefix: string): string {
  return normalize(path.relative(cwd, newPrefix) || '.');
}
