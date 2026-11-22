#!/usr/bin/env node
// Checks formatting of the files git would commit (tracked, or new and not ignored).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
});
// A tracked file deleted in the working tree is still listed until the deletion is staged.
const files = listed.stdout.split('\0').filter((file) => file && existsSync(file));

// Batches keep the command line under Windows' length limit. oxfmt skips file types it cannot
// format; --no-error-on-unmatched-pattern keeps a batch of only such files from failing. Every
// batch runs, so one check lists all unformatted files.
let failed = 0;
for (let i = 0; i < files.length; i += 200) {
  const result = spawnSync(
    process.execPath,
    [
      'node_modules/oxfmt/bin/oxfmt',
      '--check',
      '--no-error-on-unmatched-pattern',
      ...files.slice(i, i + 200),
    ],
    { stdio: 'inherit' },
  );
  if (result.status !== 0) failed = result.status ?? 1;
}
process.exit(failed);
