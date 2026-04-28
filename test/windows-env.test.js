import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWriteUserEnvInvocation } from '../src/windows-env.js';

const SECRET = 'sk-test-ABCDEF0123456789-bearer-token';

test('windows: secret value is never placed in argv (would leak via Win32_Process.CommandLine)', () => {
  const { command, args } = buildWriteUserEnvInvocation('AWS_BEARER_TOKEN_BEDROCK', SECRET);
  assert.equal(command, 'powershell.exe');
  for (const arg of args) {
    assert.ok(!arg.includes(SECRET), `argv leaked secret: ${arg}`);
  }
});

test('windows: secret value is delivered via the child environment', () => {
  const { childEnv } = buildWriteUserEnvInvocation('AWS_BEARER_TOKEN_BEDROCK', SECRET);
  assert.equal(childEnv.__AGENT_SANDBOX_VALUE, SECRET);
});

test('windows: PowerShell script references $env:__AGENT_SANDBOX_VALUE (not a literal value)', () => {
  const { args } = buildWriteUserEnvInvocation('AWS_BEARER_TOKEN_BEDROCK', SECRET);
  const script = args[args.indexOf('-Command') + 1];
  assert.match(script, /\$env:__AGENT_SANDBOX_VALUE/);
  assert.ok(!script.includes(SECRET));
});

test('windows: variable name is safely single-quoted in the script', () => {
  // Name is not user-controlled in our code, but escaping defends against future callers.
  const { args } = buildWriteUserEnvInvocation("evil' + nasty", SECRET);
  const script = args[args.indexOf('-Command') + 1];
  // Single quote escaped as ''; the injection is neutralized.
  assert.match(script, /'evil'' \+ nasty'/);
  // And the secret still isn't in the script.
  assert.ok(!script.includes(SECRET));
});

test('windows: value is stringified safely even for non-string inputs', () => {
  const { childEnv } = buildWriteUserEnvInvocation('AWS_REGION', 123);
  assert.equal(childEnv.__AGENT_SANDBOX_VALUE, '123');
});
