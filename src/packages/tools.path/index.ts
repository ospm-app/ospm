import path from 'node:path';

export function getToolDirPath(opts: {
  ospmHomeDir: string;
  tool: {
    name: string;
    version: string;
  };
}): string {
  return path.join(
    opts.ospmHomeDir,
    '.tools',
    opts.tool.name.replaceAll('/', '+'),
    opts.tool.version
  );
}
