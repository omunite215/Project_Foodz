#!/usr/bin/env node
// The full local check that runs before every push (and in CI).
//   node scripts/verify.mjs               run every step
//   node scripts/verify.mjs <step> ...    run selected steps
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const GITLEAKS_IMAGE = 'zricethezav/gitleaks:v8.30.1';
const root = process.cwd();

const npx = (...args) => ['npx', ...args];
const docker = (...args) => ['docker', 'run', '--rm', '-v', `${root}:/src`, '-w', '/src', ...args];

const STEPS = {
  lint: npx('oxlint', '--type-aware', '--deny-warnings'),
  format: npx('prettier', '--check', '.'),
  typecheck: npx('tsc', '--noEmit'),
  architecture: npx(
    'depcruise',
    ...['app', 'components', 'lib', 'server', 'proxy.ts'].filter((p) => existsSync(p)),
    '--config',
    '.dependency-cruiser.cjs',
  ),
  semgrep: ['node', 'scripts/semgrep.mjs'],
  secrets: docker(
    GITLEAKS_IMAGE,
    'git',
    '--config',
    '.gitleaks.toml',
    '--redact',
    '--no-banner',
    '.',
  ),
  'secrets-staged': ['node', 'scripts/staged-secrets.mjs', GITLEAKS_IMAGE],
  unit: npx('vitest', 'run', '--project', 'unit'),
  integration: npx('vitest', 'run', '--project', 'integration'),
  build: npx('next', 'build'),
  e2e: npx('playwright', 'test', '--project', 'smoke', '--project', 'smoke-mobile'),
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
