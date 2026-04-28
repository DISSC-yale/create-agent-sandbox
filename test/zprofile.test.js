import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

// zprofile.js is only used on macOS. On Windows os.homedir() reads USERPROFILE,
// not HOME, so the test's home override has no effect and tests would target
// the real ~/.zprofile. POSIX mode bits also don't map onto NTFS.
const SKIP_ON_WINDOWS = platform() === 'win32'
  ? { skip: 'zprofile is mac-only; see windows-env.test.js for the Windows path' }
  : {};

// zprofile.js computes ZPROFILE_PATH from homedir() at load time, so each test
// sets HOME before a fresh dynamic import (cache-busted via query string).
async function loadFreshZprofile(home, tag) {
  process.env.HOME = home;
  const mod = await import(`../src/zprofile.js?tag=${tag}`);
  return mod;
}

function makeTempHome(prefix) {
  return mkdtempSync(join(tmpdir(), `zprofile-${prefix}-`));
}

const VALID_ENV = {
  AWS_REGION: 'us-east-1',
  AWS_BEARER_TOKEN_BEDROCK: 'sk-test-abcdef',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic.claude-opus-4-7',
};

test('planZprofileWrite: creates a new file when ~/.zprofile is absent', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('create');
  try {
    const { planZprofileWrite } = await loadFreshZprofile(home, 'create');
    const plan = planZprofileWrite(VALID_ENV);
    assert.equal(plan.mode, 'create');
    assert.equal(plan.existing, null);
    assert.match(plan.nextContent, /# >>> agent-sandbox bedrock config >>>/);
    assert.match(plan.nextContent, /export CLAUDE_CODE_USE_BEDROCK=1/);
    assert.match(plan.nextContent, new RegExp(`export AWS_REGION=${VALID_ENV.AWS_REGION}`));
    assert.match(plan.nextContent, /# <<< agent-sandbox bedrock config <<</);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('planZprofileWrite: appends when file exists without a Bedrock block', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('append');
  const zprofilePath = join(home, '.zprofile');
  writeFileSync(zprofilePath, 'export PATH="/usr/local/bin:$PATH"\n');
  try {
    const { planZprofileWrite } = await loadFreshZprofile(home, 'append');
    const plan = planZprofileWrite(VALID_ENV);
    assert.equal(plan.mode, 'append');
    assert.ok(plan.nextContent.startsWith('export PATH='));
    assert.match(plan.nextContent, /# >>> agent-sandbox bedrock config >>>/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('planZprofileWrite: replace-managed when block already exists with different values', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('replace');
  const zprofilePath = join(home, '.zprofile');
  const existingBlock = [
    '# >>> agent-sandbox bedrock config >>>',
    '# Added by @yale-dissc/create-agent-sandbox on 2025-01-01T00:00:00.000Z',
    'export CLAUDE_CODE_USE_BEDROCK=1',
    'export AWS_REGION=us-west-2', // different
    'export AWS_BEARER_TOKEN_BEDROCK=old-token',
    'export ANTHROPIC_DEFAULT_OPUS_MODEL=anthropic.claude-opus-4-5',
    '# <<< agent-sandbox bedrock config <<<',
    '',
  ].join('\n');
  writeFileSync(zprofilePath, existingBlock);
  try {
    const { planZprofileWrite } = await loadFreshZprofile(home, 'replace');
    const plan = planZprofileWrite(VALID_ENV);
    assert.equal(plan.mode, 'replace-managed');
    assert.match(plan.nextContent, /AWS_REGION=us-east-1/);
    assert.doesNotMatch(plan.nextContent, /AWS_REGION=us-west-2/);
    // Only one block, not appended duplicate
    const matches = plan.nextContent.match(/# >>> agent-sandbox bedrock config >>>/g);
    assert.equal(matches.length, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('planZprofileWrite: noop when managed block already matches requested env', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('noop');
  const zprofilePath = join(home, '.zprofile');
  const existingBlock = [
    '# >>> agent-sandbox bedrock config >>>',
    '# Added by @yale-dissc/create-agent-sandbox on 2025-06-15T00:00:00.000Z',
    'export CLAUDE_CODE_USE_BEDROCK=1',
    `export AWS_REGION=${VALID_ENV.AWS_REGION}`,
    `export AWS_BEARER_TOKEN_BEDROCK=${VALID_ENV.AWS_BEARER_TOKEN_BEDROCK}`,
    `export ANTHROPIC_DEFAULT_OPUS_MODEL=${VALID_ENV.ANTHROPIC_DEFAULT_OPUS_MODEL}`,
    '# <<< agent-sandbox bedrock config <<<',
    '',
  ].join('\n');
  writeFileSync(zprofilePath, existingBlock);
  try {
    const { planZprofileWrite } = await loadFreshZprofile(home, 'noop');
    const plan = planZprofileWrite(VALID_ENV);
    assert.equal(plan.mode, 'noop');
    assert.equal(plan.nextContent, plan.existing);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('planZprofileWrite: append-conflict when CLAUDE_CODE_USE_BEDROCK exists outside a managed block', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('conflict');
  const zprofilePath = join(home, '.zprofile');
  writeFileSync(zprofilePath, 'export CLAUDE_CODE_USE_BEDROCK=1\nexport AWS_REGION=eu-west-1\n');
  try {
    const { planZprofileWrite } = await loadFreshZprofile(home, 'conflict');
    const plan = planZprofileWrite(VALID_ENV);
    assert.equal(plan.mode, 'append-conflict');
    // Original content preserved
    assert.match(plan.nextContent, /AWS_REGION=eu-west-1/);
    // New managed block also present
    assert.match(plan.nextContent, /# >>> agent-sandbox bedrock config >>>/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('applyZprofileWrite: backs up existing file before overwriting', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('backup');
  const zprofilePath = join(home, '.zprofile');
  writeFileSync(zprofilePath, 'original-content\n');
  try {
    const { planZprofileWrite, applyZprofileWrite } = await loadFreshZprofile(home, 'backup');
    const plan = planZprofileWrite(VALID_ENV);
    const result = applyZprofileWrite(plan);
    assert.ok(result.backupPath, 'backup path should be set');
    assert.ok(existsSync(result.backupPath), 'backup file should exist on disk');
    assert.equal(readFileSync(result.backupPath, 'utf8'), 'original-content\n');
    assert.match(readFileSync(zprofilePath, 'utf8'), /# >>> agent-sandbox bedrock config >>>/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('applyZprofileWrite: sets 0600 permissions on created file', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('perms');
  try {
    const { planZprofileWrite, applyZprofileWrite } = await loadFreshZprofile(home, 'perms');
    const plan = planZprofileWrite(VALID_ENV);
    applyZprofileWrite(plan);
    const stat = statSync(join(home, '.zprofile'));
    // 0o777 mask; 0o600 = owner read/write only
    assert.equal(stat.mode & 0o777, 0o600);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('readExistingBedrockEnv: handles quoted and unquoted values', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('read');
  try {
    const { readExistingBedrockEnv } = await loadFreshZprofile(home, 'read');
    const content = [
      'export CLAUDE_CODE_USE_BEDROCK=1',
      'export AWS_REGION="us-east-1"',
      "export AWS_BEARER_TOKEN_BEDROCK='sk-test-abc'",
      '  export ANTHROPIC_DEFAULT_OPUS_MODEL=anthropic.claude-opus-4-7  ',
      'export UNRELATED=ignore-me',
    ].join('\n');
    const env = readExistingBedrockEnv(content);
    assert.deepEqual(env, {
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_REGION: 'us-east-1',
      AWS_BEARER_TOKEN_BEDROCK: 'sk-test-abc',
      ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic.claude-opus-4-7',
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('readExistingBedrockEnv: returns nulls for missing file / missing vars', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('read-empty');
  try {
    const { readExistingBedrockEnv } = await loadFreshZprofile(home, 'read-empty');
    const envFromEmpty = readExistingBedrockEnv();
    assert.equal(envFromEmpty.CLAUDE_CODE_USE_BEDROCK, null);
    assert.equal(envFromEmpty.AWS_REGION, null);
    const partial = readExistingBedrockEnv('export AWS_REGION=us-east-1\n');
    assert.equal(partial.AWS_REGION, 'us-east-1');
    assert.equal(partial.AWS_BEARER_TOKEN_BEDROCK, null);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('existingBedrockBlock: detects malformed block (missing closing sentinel)', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('malformed');
  try {
    const { existingBedrockBlock } = await loadFreshZprofile(home, 'malformed');
    const detected = existingBedrockBlock('# >>> agent-sandbox bedrock config >>>\nexport CLAUDE_CODE_USE_BEDROCK=1\n');
    assert.equal(detected.managed, true);
    assert.equal(detected.malformed, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------- preservation invariants ----------

const PRE_EXISTING_CONTENT = [
  '# User-specific shell config',
  'export PATH="/opt/homebrew/bin:$PATH"',
  'export EDITOR=nvim',
  'export GOPATH="$HOME/go"',
  'alias ll="ls -laG"',
  '[ -f "$HOME/.cargo/env" ] && source "$HOME/.cargo/env"',
  '',
].join('\n');

test('preservation: append mode keeps every byte of pre-existing content', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('preserve-append');
  const zprofilePath = join(home, '.zprofile');
  writeFileSync(zprofilePath, PRE_EXISTING_CONTENT);
  try {
    const { planZprofileWrite, applyZprofileWrite } = await loadFreshZprofile(home, 'preserve-append');
    const plan = planZprofileWrite(VALID_ENV);
    assert.equal(plan.mode, 'append');
    applyZprofileWrite(plan);
    const after = readFileSync(zprofilePath, 'utf8');
    // Every pre-existing line must still be there
    for (const line of PRE_EXISTING_CONTENT.split('\n').filter(Boolean)) {
      assert.ok(after.includes(line), `lost line: ${line}`);
    }
    // Content must START with the original (append, not prepend)
    assert.ok(after.startsWith(PRE_EXISTING_CONTENT), 'original content must lead the file');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('preservation: replace-managed keeps unrelated lines intact', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('preserve-replace');
  const zprofilePath = join(home, '.zprofile');
  const withManagedBlock =
    PRE_EXISTING_CONTENT +
    [
      '# >>> agent-sandbox bedrock config >>>',
      '# Added by @yale-dissc/create-agent-sandbox on 2025-01-01T00:00:00.000Z',
      'export CLAUDE_CODE_USE_BEDROCK=1',
      'export AWS_REGION=us-west-2',
      'export AWS_BEARER_TOKEN_BEDROCK=old-token',
      'export ANTHROPIC_DEFAULT_OPUS_MODEL=anthropic.claude-opus-4-5',
      '# <<< agent-sandbox bedrock config <<<',
      '',
    ].join('\n') +
    'export POSTAMBLE_VAR=preserved\n';
  writeFileSync(zprofilePath, withManagedBlock);
  try {
    const { planZprofileWrite, applyZprofileWrite } = await loadFreshZprofile(home, 'preserve-replace');
    const plan = planZprofileWrite(VALID_ENV);
    assert.equal(plan.mode, 'replace-managed');
    applyZprofileWrite(plan);
    const after = readFileSync(zprofilePath, 'utf8');
    // Pre-existing content before the block is intact
    for (const line of PRE_EXISTING_CONTENT.split('\n').filter(Boolean)) {
      assert.ok(after.includes(line), `lost pre-block line: ${line}`);
    }
    // Content after the block is intact
    assert.match(after, /export POSTAMBLE_VAR=preserved/);
    // New values are in
    assert.match(after, /AWS_REGION=us-east-1/);
    // Old values are gone
    assert.doesNotMatch(after, /AWS_REGION=us-west-2/);
    assert.doesNotMatch(after, /old-token/);
    // Exactly one managed block
    const count = (after.match(/# >>> agent-sandbox bedrock config >>>/g) || []).length;
    assert.equal(count, 1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('preservation: backup is created on disk before the new content lands', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('backup-before');
  const zprofilePath = join(home, '.zprofile');
  writeFileSync(zprofilePath, PRE_EXISTING_CONTENT);
  try {
    const { planZprofileWrite, applyZprofileWrite } = await loadFreshZprofile(home, 'backup-before');
    const plan = planZprofileWrite(VALID_ENV);
    const result = applyZprofileWrite(plan);
    assert.ok(result.backupPath, 'backup path must be set when existing file is present');
    assert.ok(existsSync(result.backupPath), 'backup file must exist on disk');
    // Backup contents exactly match original
    assert.equal(readFileSync(result.backupPath, 'utf8'), PRE_EXISTING_CONTENT);
    // Backup name follows timestamped pattern
    assert.match(result.backupPath, /\.backup-\d{8}-\d{6}$/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('preservation: applyZprofileWrite refuses to write if file changed between plan and apply (TOCTOU)', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('toctou');
  const zprofilePath = join(home, '.zprofile');
  writeFileSync(zprofilePath, PRE_EXISTING_CONTENT);
  try {
    const { planZprofileWrite, applyZprofileWrite } = await loadFreshZprofile(home, 'toctou');
    const plan = planZprofileWrite(VALID_ENV);
    // Simulate the user editing ~/.zprofile after the preview
    const mutation = PRE_EXISTING_CONTENT + 'export LATE_ADDITION=value\n';
    writeFileSync(zprofilePath, mutation);
    assert.throws(() => applyZprofileWrite(plan), /changed on disk between preview and apply/);
    // Original mutation is preserved; we did NOT overwrite
    assert.equal(readFileSync(zprofilePath, 'utf8'), mutation);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('preservation: append mode tightens permissions to 0600 even when file was 0644', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('perms-tighten');
  const zprofilePath = join(home, '.zprofile');
  writeFileSync(zprofilePath, PRE_EXISTING_CONTENT, { mode: 0o644 });
  try {
    const { planZprofileWrite, applyZprofileWrite } = await loadFreshZprofile(home, 'perms-tighten');
    const plan = planZprofileWrite(VALID_ENV);
    applyZprofileWrite(plan);
    const mode = statSync(zprofilePath).mode & 0o777;
    assert.equal(mode, 0o600, 'file must be 0600 after write, even if it was 0644 before');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// ---------- secret-masking invariants ----------

const TOKEN_LONG_ENV = {
  AWS_REGION: 'us-east-1',
  AWS_BEARER_TOKEN_BEDROCK: 'abcdEFGH1234IJKLmnop5678QRSTuvwx', // >8 chars → partial mask
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic.claude-opus-4-7',
};

test('masking: diffPreview never contains the raw bearer token (mode: create)', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('mask-create');
  try {
    const { planZprofileWrite, diffPreview } = await loadFreshZprofile(home, 'mask-create');
    const plan = planZprofileWrite(TOKEN_LONG_ENV);
    const preview = diffPreview(plan);
    assert.ok(
      !preview.includes(TOKEN_LONG_ENV.AWS_BEARER_TOKEN_BEDROCK),
      `diffPreview leaked raw token:\n${preview}`
    );
    assert.match(preview, /abcd\.\.\.uvwx/, 'preview must show masked token');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('masking: diffPreview never contains the raw bearer token (mode: append)', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('mask-append');
  writeFileSync(join(home, '.zprofile'), 'export PATH="/usr/local/bin:$PATH"\n');
  try {
    const { planZprofileWrite, diffPreview } = await loadFreshZprofile(home, 'mask-append');
    const plan = planZprofileWrite(TOKEN_LONG_ENV);
    const preview = diffPreview(plan);
    assert.ok(!preview.includes(TOKEN_LONG_ENV.AWS_BEARER_TOKEN_BEDROCK));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('masking: diffPreview never contains the raw bearer token (mode: replace-managed)', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('mask-replace');
  const zprofilePath = join(home, '.zprofile');
  writeFileSync(
    zprofilePath,
    [
      '# >>> agent-sandbox bedrock config >>>',
      '# Added by @yale-dissc/create-agent-sandbox on 2025-01-01T00:00:00.000Z',
      'export CLAUDE_CODE_USE_BEDROCK=1',
      'export AWS_REGION=us-west-2',
      'export AWS_BEARER_TOKEN_BEDROCK=STALE-OLD-TOKEN-11111111',
      'export ANTHROPIC_DEFAULT_OPUS_MODEL=anthropic.claude-opus-4-5',
      '# <<< agent-sandbox bedrock config <<<',
      '',
    ].join('\n')
  );
  try {
    const { planZprofileWrite, diffPreview } = await loadFreshZprofile(home, 'mask-replace');
    const plan = planZprofileWrite(TOKEN_LONG_ENV);
    const preview = diffPreview(plan);
    assert.ok(!preview.includes(TOKEN_LONG_ENV.AWS_BEARER_TOKEN_BEDROCK));
    // The STALE token from the old block should also not appear unmasked in preview
    assert.ok(!preview.includes('STALE-OLD-TOKEN-11111111'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('masking: diffPreview on noop plan masks the existing on-disk token', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('mask-noop');
  const zprofilePath = join(home, '.zprofile');
  writeFileSync(
    zprofilePath,
    [
      '# >>> agent-sandbox bedrock config >>>',
      '# Added by @yale-dissc/create-agent-sandbox on 2025-06-15T00:00:00.000Z',
      'export CLAUDE_CODE_USE_BEDROCK=1',
      `export AWS_REGION=${TOKEN_LONG_ENV.AWS_REGION}`,
      `export AWS_BEARER_TOKEN_BEDROCK=${TOKEN_LONG_ENV.AWS_BEARER_TOKEN_BEDROCK}`,
      `export ANTHROPIC_DEFAULT_OPUS_MODEL=${TOKEN_LONG_ENV.ANTHROPIC_DEFAULT_OPUS_MODEL}`,
      '# <<< agent-sandbox bedrock config <<<',
      '',
    ].join('\n')
  );
  try {
    const { planZprofileWrite, diffPreview } = await loadFreshZprofile(home, 'mask-noop');
    const plan = planZprofileWrite(TOKEN_LONG_ENV);
    assert.equal(plan.mode, 'noop');
    const preview = diffPreview(plan);
    assert.ok(!preview.includes(TOKEN_LONG_ENV.AWS_BEARER_TOKEN_BEDROCK));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('masking: the real (unmasked) token still lands in nextContent for the on-disk write', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('mask-write');
  try {
    const { planZprofileWrite, applyZprofileWrite } = await loadFreshZprofile(home, 'mask-write');
    const plan = planZprofileWrite(TOKEN_LONG_ENV);
    // nextContent must contain the real token — that's what we're writing to disk
    assert.ok(
      plan.nextContent.includes(TOKEN_LONG_ENV.AWS_BEARER_TOKEN_BEDROCK),
      'nextContent must contain the real token for the on-disk write'
    );
    applyZprofileWrite(plan);
    const written = readFileSync(join(home, '.zprofile'), 'utf8');
    assert.ok(
      written.includes(TOKEN_LONG_ENV.AWS_BEARER_TOKEN_BEDROCK),
      'the on-disk file must contain the real token (shell needs the actual value)'
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('preservation: applyZprofileWrite on noop plan does not create a backup or write', SKIP_ON_WINDOWS, async () => {
  const home = makeTempHome('apply-noop');
  const zprofilePath = join(home, '.zprofile');
  const existing = [
    PRE_EXISTING_CONTENT,
    '# >>> agent-sandbox bedrock config >>>',
    '# Added by @yale-dissc/create-agent-sandbox on 2025-06-15T00:00:00.000Z',
    'export CLAUDE_CODE_USE_BEDROCK=1',
    `export AWS_REGION=${VALID_ENV.AWS_REGION}`,
    `export AWS_BEARER_TOKEN_BEDROCK=${VALID_ENV.AWS_BEARER_TOKEN_BEDROCK}`,
    `export ANTHROPIC_DEFAULT_OPUS_MODEL=${VALID_ENV.ANTHROPIC_DEFAULT_OPUS_MODEL}`,
    '# <<< agent-sandbox bedrock config <<<',
    '',
  ].join('\n');
  writeFileSync(zprofilePath, existing);
  try {
    const { planZprofileWrite, applyZprofileWrite } = await loadFreshZprofile(home, 'apply-noop');
    const plan = planZprofileWrite(VALID_ENV);
    assert.equal(plan.mode, 'noop');
    const result = applyZprofileWrite(plan);
    assert.equal(result.backupPath, null);
    // File is byte-identical to what we started with
    assert.equal(readFileSync(zprofilePath, 'utf8'), existing);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
