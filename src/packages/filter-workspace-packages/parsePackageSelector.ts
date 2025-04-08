import path from 'node:path';

export interface PackageSelector {
  diff?: string;
  exclude?: boolean;
  excludeSelf?: boolean;
  includeDependencies?: boolean;
  includeDependents?: boolean;
  namePattern?: string;
  parentDir?: string;
  followProdDepsOnly?: boolean;
}

export function parsePackageSelector(
  rawSelector: string,
  prefix: string
): PackageSelector {
  let exclude = false;
  let rs = rawSelector;

  if (rs.startsWith('!')) {
    exclude = true;

    rs = rs.substring(1);
  }

  let excludeSelf = false;

  const includeDependencies = rs.endsWith('...');

  if (includeDependencies) {
    rs = rs.slice(0, -3);

    if (rs.endsWith('^')) {
      excludeSelf = true;
      rs = rs.slice(0, -1);
    }
  }

  const includeDependents = rs.startsWith('...');

  if (includeDependents) {
    rs = rs.substring(3);

    if (rs.startsWith('^')) {
      excludeSelf = true;
      rs = rs.slice(1);
    }
  }

  const matches = rs.match(/^([^.][^[\]{}]*)?({[^}]+})?(\[[^\]]+])?$/);

  if (matches === null) {
    if (isSelectorByLocation(rs)) {
      return {
        exclude,
        excludeSelf: false,
        parentDir: path.join(prefix, rs),
      };
    }

    return {
      excludeSelf: false,
      namePattern: rs,
    };
  }

  return {
    diff: matches[3]?.slice(1, -1) ?? '',
    exclude,
    excludeSelf,
    includeDependencies,
    includeDependents,
    namePattern: matches[1] ?? '',
    parentDir:
      typeof matches[2] === 'string'
        ? path.join(prefix, matches[2].slice(1, -1))
        : '',
  };
}

function isSelectorByLocation(rawSelector: string): boolean {
  if (rawSelector[0] !== '.') return false;

  // . or ./ or .\
  if (
    rawSelector.length === 1 ||
    rawSelector[1] === '/' ||
    rawSelector[1] === '\\'
  )
    return true;

  if (rawSelector[1] !== '.') return false;

  // .. or ../ or ..\
  return (
    rawSelector.length === 2 ||
    rawSelector[2] === '/' ||
    rawSelector[2] === '\\'
  );
}
