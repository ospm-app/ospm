import type { AuditReport, AuditAdvisory } from '../audit/index.ts';
import { readProjectManifest } from '../read-project-manifest/index.ts';
import difference from 'ramda/src/difference';

export async function fix(
  dir: string,
  auditReport: AuditReport
): Promise<Record<string, string>> {
  const { manifest, writeProjectManifest } = await readProjectManifest(dir);

  const vulnOverrides = createOverrides(
    Object.values(auditReport.advisories),
    manifest.pnpm?.auditConfig?.ignoreCves
  );

  if (Object.values(vulnOverrides).length === 0) {
    return vulnOverrides;
  }

  await writeProjectManifest({
    ...manifest,
    pnpm: {
      ...manifest.pnpm,
      overrides: {
        ...manifest.pnpm?.overrides,
        ...vulnOverrides,
      },
    },
  });

  return vulnOverrides;
}

function createOverrides(
  advisories: AuditAdvisory[],
  ignoreCves?: string[] | undefined
): Record<string, string> {
  let newAdvisories = advisories;

  if (ignoreCves) {
    newAdvisories = newAdvisories.filter(({ cves }) => {
      return difference.default(cves, ignoreCves).length > 0;
    });
  }

  return Object.fromEntries(
    newAdvisories
      .filter(({ vulnerable_versions, patched_versions }) => {
        return (
          vulnerable_versions !== '>=0.0.0' && patched_versions !== '<0.0.0'
        );
      })
      .map((advisory) => {
        return [
          `${advisory.module_name}@${advisory.vulnerable_versions}`,
          advisory.patched_versions,
        ];
      })
  );
}
