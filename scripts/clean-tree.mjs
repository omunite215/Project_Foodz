#!/usr/bin/env node
// Fails when the working tree has uncommitted or untracked files, so the pre-push checks
// always run against exactly what is being pushed.
import { spawnSync } from 'node:child_process';

const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
if (status.status !== 0) process.exit(status.status ?? 1);
if (status.stdout.trim()) {
  console.error(`Uncommitted changes:\n${status.stdout}Commit or stash them before pushing.`);
  process.exit(1);
}
