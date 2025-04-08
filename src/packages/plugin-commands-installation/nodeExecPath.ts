import { promises as fs } from 'node:fs';
import which from 'which';
import process from 'node:process';

export async function getNodeExecPath(): Promise<string> {
  try {
    // The system default Node.js executable is preferred
    // not the one used to run the pnpm CLI.
    const nodeExecPath = await which('node');

    return fs.realpath(nodeExecPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (err: any) {
    if (err['code'] !== 'ENOENT') {
      throw err;
    }

    return process.env.NODE ?? process.execPath;
  }
}
