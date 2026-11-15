#!/usr/bin/env node
// Checks formatting of the files git would commit (tracked, or new and not ignored).
import { spawnSync } from 'node:child_process';

const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
});
const files = listed.stdout.split('\0').filter(Boolean);

// Batches keep the command line under Windows' length limit.
for (let i = 0; i < files.length; i += 200) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/prettier/bin/prettier.cjs',
      '--check',
      '--ignore-unknown',
      ...files.slice(i, i + 200),
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
}
