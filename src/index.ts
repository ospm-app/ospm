import '@total-typescript/ts-reset';

import process from 'node:process';

// Avoid "Possible EventEmitter memory leak detected" warnings
// because it breaks ospm's CLI output
process.setMaxListeners(0);

const argv = process.argv.slice(2);

(async () => {
  switch (argv[0]) {
    // commands that are passed through to npm:
    case 'access':
    case 'adduser':
    case 'bugs':
    case 'deprecate':
    case 'dist-tag':
    case 'docs':
    case 'edit':
    case 'find':
    case 'home':
    case 'info':
    case 'issues':
    case 'login':
    case 'logout':
    case 'owner':
    case 'ping':
    case 'prefix':
    case 'profile':
    case 'pkg':
    case 'repo':
    case 's':
    case 'se':
    case 'search':
    case 'set-script':
    case 'show':
    case 'star':
    case 'stars':
    case 'team':
    case 'token':
    case 'unpublish':
    case 'unstar':
    case 'v':
    case 'version':
    case 'view':
    case 'whoami':
    case 'xmas': {
      await passThruToNpm();
      break;
    }

    default: {
      await runOspm();
      break;
    }
  }
})();

async function runOspm(): Promise<void> {
  const { errorHandler } = await import('./errorHandler.ts');

  try {
    const { main } = await import('./main.ts');

    await main(argv);
  } catch (err: unknown) {
    // TODO: valibot error handling
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    await errorHandler(err);
  }
}

async function passThruToNpm(): Promise<void> {
  const { runNpm } = await import('./runNpm.ts');

  const { status } = await runNpm(argv);

  // eslint-disable-next-line n/no-process-exit
  process.exit(status);
}
