import path from 'node:path';
import util from 'node:util';
import {
  readProjectManifest,
  type WriteProjectManifest,
} from '../read-project-manifest/index.ts';
import { writeProjectManifest } from '../write-project-manifest/index.ts';
import type { CommentSpecifier } from '../text.comments-parser/CommentSpecifier.ts';
import type { ProjectManifest } from '../types/package.ts';

export async function createProjectManifestWriter(projectDir: string): Promise<
  | ((
      manifest: ProjectManifest,
      opts?:
        | {
            comments?: CommentSpecifier[] | undefined;
            indent?: string | number | undefined;
            insertFinalNewline?: boolean | undefined;
          }
        | undefined
    ) => Promise<void>)
  | WriteProjectManifest
> {
  try {
    const { writeProjectManifest } = await readProjectManifest(projectDir);

    return writeProjectManifest;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (
      util.types.isNativeError(err) &&
      'code' in err &&
      err.code === 'ERR_OSPM_NO_IMPORTER_MANIFEST_FOUND'
    ) {
      return writeProjectManifest.bind(
        null,
        path.join(projectDir, 'package.json')
      ); // as WriteProjectManifest;
    }

    throw err;
  }
}
