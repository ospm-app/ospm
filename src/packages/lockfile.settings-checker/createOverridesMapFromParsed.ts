import type { PackageSelector } from '../parse-overrides/index.ts';

export function createOverridesMapFromParsed(
  parsedOverrides:
    | Array<
        | {
            parentPkg: PackageSelector;
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          }
        | {
            targetPkg: PackageSelector;
            selector: string;
            newPref: string;
          }
      >
    | undefined
): Record<string, string> {
  if (typeof parsedOverrides === 'undefined') {
    return {};
  }

  const overridesMap: Record<string, string> = {};

  for (const { selector, newPref } of parsedOverrides) {
    overridesMap[selector] = newPref;
  }

  return overridesMap;
}
