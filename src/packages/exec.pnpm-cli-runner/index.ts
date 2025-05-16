import path from 'node:path';
import { execaSync } from 'execa';

export function runOspmCli(command: string[], { cwd }: { cwd: string }): void {
  const execOpts = {
    cwd,
    stdio: 'inherit' as const,
  };

  const execFileName = path.basename(process.execPath).toLowerCase();

  if (execFileName === 'ospm' || execFileName === 'ospm.exe') {
    execaSync(process.execPath, command, execOpts);
  } else if (path.basename(process.argv[1] ?? '') === 'ospm.cjs') {
    execaSync(process.execPath, [process.argv[1] ?? '', ...command], execOpts);
  } else {
    execaSync('ospm', command, execOpts);
  }
}
