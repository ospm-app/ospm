import gfs from '../graceful-fs/index.ts';
import type { ProjectManifest } from '../types/index.ts';
import JSON5 from 'json5';
import parseJson from 'parse-json';
import stripBom from 'strip-bom';

export async function readJson5File(
  filePath: string
): Promise<{ data: ProjectManifest; text: string }> {
  const text = await readFileWithoutBom(filePath);

  try {
    return {
      data: JSON5.parse(text),
      text,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    err.message = `${err.message as string} in ${filePath}`;
    err['code'] = 'ERR_PNPM_JSON5_PARSE';
    throw err;
  }
}

export async function readJsonFile(
  filePath: string
): Promise<{ data: ProjectManifest; text: string }> {
  const text = await readFileWithoutBom(filePath);
  try {
    return {
      // TODO: valibot schema
      data: parseJson(text, filePath) as unknown as ProjectManifest,
      text,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    err['code'] = 'ERR_PNPM_JSON_PARSE';
    throw err;
  }
}

async function readFileWithoutBom(path: string): Promise<string> {
  return stripBom(await gfs.readFile(path, 'utf8'));
}
