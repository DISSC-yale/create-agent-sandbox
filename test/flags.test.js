import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, HELP_TEXT } from '../src/flags.js';

function run(args) {
  return parseArgs(['node', 'cli.js', ...args]);
}

test('parseArgs: defaults', () => {
  assert.deepEqual(run([]), {
    dryRun: false,
    check: false,
    help: false,
    version: false,
    yes: false,
    ref: null,
    projectName: null,
  });
});

test('parseArgs: --dry-run and --check flags', () => {
  assert.equal(run(['--dry-run']).dryRun, true);
  assert.equal(run(['--check']).check, true);
});

test('parseArgs: --help / -h', () => {
  assert.equal(run(['--help']).help, true);
  assert.equal(run(['-h']).help, true);
});

test('parseArgs: --version / -v', () => {
  assert.equal(run(['--version']).version, true);
  assert.equal(run(['-v']).version, true);
});

test('parseArgs: --yes / -y', () => {
  assert.equal(run(['--yes']).yes, true);
  assert.equal(run(['-y']).yes, true);
});

test('parseArgs: --ref <value> space-separated', () => {
  assert.equal(run(['--ref', 'v1.0.0']).ref, 'v1.0.0');
});

test('parseArgs: --ref=<value> equals form', () => {
  assert.equal(run(['--ref=main']).ref, 'main');
});

test('parseArgs: positional project name', () => {
  assert.equal(run(['my-project']).projectName, 'my-project');
});

test('parseArgs: positional + flags in any order', () => {
  const parsed = run(['--dry-run', 'my-project', '--ref', 'v1.0.0']);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.projectName, 'my-project');
  assert.equal(parsed.ref, 'v1.0.0');
});

test('parseArgs: first positional wins', () => {
  const parsed = run(['first', 'second']);
  assert.equal(parsed.projectName, 'first');
});

test('parseArgs: unknown flags are silently ignored', () => {
  // Not the greatest behavior, but documenting what actually happens.
  const parsed = run(['--unknown-flag']);
  assert.equal(parsed.dryRun, false);
  assert.equal(parsed.projectName, null);
});

test('HELP_TEXT mentions every documented flag', () => {
  for (const flag of ['--check', '--dry-run', '--ref', '--yes', '--help', '--version']) {
    assert.match(HELP_TEXT, new RegExp(flag), `help text missing ${flag}`);
  }
});
