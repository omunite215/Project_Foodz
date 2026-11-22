#!/usr/bin/env node
// The full local check that runs before every push (and in CI).
//   node scripts/verify.mjs               run every step
//   node scripts/verify.mjs <step> ...    run selected steps
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const GITLEAKS_IMAGE = 'zricethezav/gitleaks:v8.30.1';
const GITLEAKS_ARGS = ['--config', '.gitleaks.toml', '--redact', '--no-banner'];
const root = process.cwd();

const npx = (...args) => ['npx', ...args];
const docker = (...args) => ['docker', 'run', '--rm', '-v', `${root}:/src`, '-w', '/src', ...args];
const git = (...args) => spawnSync('git', args, { encoding: 'utf8' }).stdout.trim();

// Route types are regenerated first: types left in .next by an earlier build (or by another
// branch, in a worktree) still point at routes that have since moved, and both the type-aware
// lint and tsc would fail on them.
const typegen = [...npx('next', 'typegen'), '&&'];

// In a git worktree `.git` is a file pointing into the main repository's .git, which the
// container can't follow, so the scan would read no history. There the shared git directory is
// mounted instead and scanned with every ref, the same history a scan from the main checkout reads.
function secretsScan() {
  if (!existsSync('.git') || !statSync('.git').isFile()) {
    return docker(GITLEAKS_IMAGE, 'git', ...GITLEAKS_ARGS, '.');
  }
  const commonDir = resolve(git('rev-parse', '--git-common-dir'));
  const mounts = ['-v', `${root}:/src`, '-v', `${commonDir}:/repo.git:ro`, '-w', '/src'];
  return [
    'docker',
    'run',
    '--rm',
    ...mounts,
    GITLEAKS_IMAGE,
    'git',
    ...GITLEAKS_ARGS,
    '--log-opts=--all',
    '/repo.git',
  ];
}

const STEPS = {
  // What gets verified must be exactly what gets pushed.
  'clean-tree': ['node', 'scripts/clean-tree.mjs'],
  lint: [...typegen, ...npx('oxlint', '--type-aware', '--deny-warnings')],
  format: ['node', 'scripts/format-check.mjs'],
  typecheck: [...typegen, ...npx('tsc', '--noEmit')],
  architecture: npx(
    'depcruise',
    ...['app', 'components', 'lib', 'server', 'proxy.ts'].filter((p) => existsSync(p)),
    '--config',
    '.dependency-cruiser.cjs',
  ),
  semgrep: ['node', 'scripts/semgrep.mjs'],
  secrets: secretsScan(),
  'secrets-staged': ['node', 'scripts/staged-secrets.mjs', GITLEAKS_IMAGE],
  unit: npx('vitest', 'run', '--project', 'unit'),
  integration: npx('vitest', 'run', '--project', 'integration'),
  build: npx('next', 'build'),
  storybook: npx('storybook', 'build', '--quiet'),
  e2e: npx(
    'playwright',
    'test',
    ...[
      'smoke',
      'smoke-mobile',
      'storefront-375',
      'storefront-1440',
      'account-375',
      'account-1440',
    ].flatMap((project) => ['--project', project]),
  ),
};

const DEFAULT = [
  'lint',
  'format',
  'typecheck',
  'architecture',
  'semgrep',
  'secrets',
  'unit',
  'integration',
  'build',
  'storybook',
  'e2e',
];
const selected = process.argv.slice(2);
const steps = selected.length ? selected : DEFAULT;

for (const name of steps) {
  const command = STEPS[name];
  if (!command) {
    console.error(`Unknown step "${name}". Available: ${Object.keys(STEPS).join(', ')}`);
    process.exit(2);
  }
  const started = Date.now();
  process.stderr.write(`\n▶ ${name}\n`);
  // One quoted command string: Windows needs a shell to run npx, and every argument is static.
  const line = command
    .map((part) => (/[\s"]/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part))
    .join(' ');
  const result = spawnSync(line, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (result.status !== 0) {
    console.error(`\n✖ ${name} failed after ${seconds}s`);
    process.exit(result.status ?? 1);
  }
  process.stderr.write(`✔ ${name} (${seconds}s)\n`);
}
