#!/usr/bin/env node
// Runs the Semgrep security rules on the project's source files.
// Files are streamed into the container as a tar archive instead of bind-mounting the repo;
// on Windows a bind mount makes Semgrep walk node_modules over a slow file share.
import { spawn, spawnSync } from 'node:child_process';

const IMAGE = 'semgrep/semgrep:1.183.0';
const TARGETS = [
  'app',
  'components',
  'lib',
  'server',
  'scripts',
  'tests',
  'proxy.ts',
  'next.config.ts',
  'prisma/seed.ts',
  'prisma/seeding',
  '.semgrep.yml',
];

const listed = spawnSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...TARGETS],
  { encoding: 'utf8' },
);
if (listed.status !== 0) {
  console.error(listed.stderr);
  process.exit(1);
}

const tar = spawn('tar', ['--null', '-T', '-', '-cf', '-'], { stdio: ['pipe', 'pipe', 'inherit'] });
tar.stdin.end(listed.stdout);

const scan = spawn(
  'docker',
  [
    'run',
    '--rm',
    '-i',
    IMAGE,
    'sh',
    '-c',
    'mkdir -p /scan && tar -xf - -C /scan && cd /scan && semgrep scan --config .semgrep.yml --error --metrics=off --quiet .',
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
tar.stdout.pipe(scan.stdin);

scan.on('close', (code) => process.exit(code ?? 1));
