import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, '..', 'bin', 'cli.js');

function runCli(args, opts = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    ...opts,
  });
}

test('cli: --help exits 0 and prints usage', () => {
  const r = runCli(['--help']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /create-agent-sandbox/);
  assert.match(r.stdout, /OPTIONS/);
});

test('cli: -h is the same as --help', () => {
  const r = runCli(['-h']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /USAGE/);
});

test('cli: --version prints the package.json version and exits 0', () => {
  const r = runCli(['--version']);
  assert.equal(r.status, 0);
  const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  assert.equal(r.stdout.trim(), pkg.version);
});

test('cli: --check runs detection non-interactively and exits 0', () => {
  const r = runCli(['--check']);
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  // Banner + detection summary should print a Node.js line at minimum.
  assert.match(r.stdout, /Node\.js/);
  assert.match(r.stdout, /Detection complete/);
});

test('cli: rejects a project name from argv that would escape cwd', () => {
  // Interactive prompt enforces [a-zA-Z0-9._-]+ so a path-like name should be
  // rejected before any filesystem action. NO_COLOR keeps output clean for grep.
  const r = runCli(['../escape-attempt'], { env: { ...process.env, NO_COLOR: '1' } });
  assert.notEqual(r.status, 0, 'should exit non-zero');
  assert.match(
    (r.stdout + r.stderr),
    /Invalid project name|Letters, numbers, dot, dash, underscore only/
  );
});

test('cli: rejects a project name from argv containing shell metacharacters', () => {
  const r = runCli(['foo;rm'], { env: { ...process.env, NO_COLOR: '1' } });
  assert.notEqual(r.status, 0);
  assert.match((r.stdout + r.stderr), /Invalid project name|Letters, numbers/);
});
