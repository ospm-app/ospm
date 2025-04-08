import { getAllDependenciesFromManifest } from '../manifest-utils/index.ts';
import { readProjectManifest } from '../read-project-manifest/index.ts';

export async function readDepNameCompletions(
  dir?: string | undefined
): Promise<Array<{ name: string }>> {
  const { manifest } = await readProjectManifest(dir ?? process.cwd());

  return Object.keys(getAllDependenciesFromManifest(manifest)).map((name) => ({
    name,
  }));
}
