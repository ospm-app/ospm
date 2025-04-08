import validateNpmPackageName from 'validate-npm-package-name';

export type ParsedWantedDependency = {
  alias: string;
  pref: string;
};

export type ParseWantedDependencyResult = Partial<ParsedWantedDependency>;

export function parseWantedDependency(
  rawWantedDependency: string
): ParseWantedDependencyResult {
  const versionDelimiter = rawWantedDependency.indexOf('@', 1); // starting from 1 to skip the @ that marks scope

  if (versionDelimiter !== -1) {
    const alias = rawWantedDependency.slice(0, versionDelimiter);

    if (validateNpmPackageName(alias).validForOldPackages === true) {
      return {
        alias,
        pref: rawWantedDependency.slice(versionDelimiter + 1),
      };
    }
    return {
      pref: rawWantedDependency,
    };
  }

  if (
    validateNpmPackageName(rawWantedDependency).validForOldPackages === true
  ) {
    return {
      alias: rawWantedDependency,
    };
  }

  return {
    pref: rawWantedDependency,
  };
}
