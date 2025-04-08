import path from 'node:path';
import { execaSync } from 'execa';

export function runPnpmCli(command: string[], { cwd }: { cwd: string }): void {
  const execOpts = {
    cwd,
    stdio: 'inherit' as const,
  };

  const execFileName = path.basename(process.execPath).toLowerCase();

  if (execFileName === 'pnpm' || execFileName === 'pnpm.exe') {
    execaSync(process.execPath, command, execOpts);
  } else if (path.basename(process.argv[1] ?? '') === 'pnpm.cjs') {
    execaSync(process.execPath, [process.argv[1] ?? '', ...command], execOpts);
  } else {
    execaSync('pnpm', command, execOpts);
  }
}
