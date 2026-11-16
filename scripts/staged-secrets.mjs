#!/usr/bin/env node
// Scans only the staged changes for secrets before a commit is created.
import { spawnSync } from 'node:child_process';

const image = process.argv[2];
const diff = spawnSync('git', ['diff', '--cached', '--no-color', '-U0'], { encoding: 'utf8' });
if (!diff.stdout.trim()) process.exit(0);

const scan = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-i',
    '-v',
    `${process.cwd()}:/src`,
    '-w',
    '/src',
    image,
    'stdin',
    '--config',
    '.gitleaks.toml',
    '--redact',
    '--no-banner',
  ],
  { input: diff.stdout, stdio: ['pipe', 'inherit', 'inherit'] },
);
process.exit(scan.status ?? 1);
