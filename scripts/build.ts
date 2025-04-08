import '@total-typescript/ts-reset';

import { build } from 'esbuild';
import { glob } from 'glob';
import process from 'node:process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function runBuild(): Promise<void> {
  const entryPoints = await glob('./src/**/*.ts', {
    ignore: ['**/*.test.ts', 'vitest.config.ts'],
  });

  const isProduction = process.env.NODE_ENV === 'production';

  try {
    await mkdir('./dist', { recursive: true });

    console.info('Building CommonJS version...');

    await build({
      entryPoints,
      outdir: './dist/cjs',
      bundle: false,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      sourcemap: true,
      minify: isProduction,
    });

    await writeFile(
      join('./dist/cjs', 'package.json'),
      JSON.stringify({ type: 'commonjs' }, null, 2)
    );

    console.info('Building ESM version...');

    await build({
      entryPoints,
      outdir: './dist/esm',
      bundle: false,
      platform: 'node',
      format: 'esm',
      target: 'node22',
      sourcemap: true,
      minify: isProduction,
      outExtension: { '.js': '.mjs' },
    });

    await writeFile(
      join('./dist/esm', 'package.json'),
      JSON.stringify({ type: 'module' }, null, 2)
    );

    await writeFile(
      join('./dist', 'package.json'),
      JSON.stringify(
        {
          type: 'module',
          exports: {
            '.': {
              import: './esm/index.mjs',
              require: './cjs/index.js',
            },
            './*': {
              import: './esm/*.mjs',
              require: './cjs/*.js',
            },
          },
        },
        null,
        2
      )
    );

    console.info('Build completed successfully!');
  } catch (error: unknown) {
    console.error('Build failed:', error);

    // eslint-disable-next-line n/no-process-exit
    process.exit(1);
  }
}

runBuild();
