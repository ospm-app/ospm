import { detectIfCurrentPkgIsExecutable } from '../cli-meta/index.ts';
import mem from 'mem';
import { execa } from 'execa';

export async function getSystemNodeVersionNonCached(): Promise<
  string | undefined
> {
  if (detectIfCurrentPkgIsExecutable()) {
    try {
      // return execa.sync('node', ['--version']).stdout.toString();
      const { stdout } = await execa('node', ['--version']);
      return stdout.toString();
    } catch {
      // Node.js is not installed on the system
      return undefined;
    }
  }
  return process.version;
}

export const getSystemNodeVersion = mem(getSystemNodeVersionNonCached);
