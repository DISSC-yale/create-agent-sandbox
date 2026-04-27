import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const VARS = [
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_REGION',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
];

const BACKUP_DIR = join(homedir(), '.agent-sandbox', 'backups');

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function readUserEnv(name) {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `[System.Environment]::GetEnvironmentVariable('${name}','User')`],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) return null;
  const value = result.stdout.trim();
  return value === '' ? null : value;
}

function writeUserEnv(name, value) {
  const escaped = String(value).replace(/'/g, "''");
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `[System.Environment]::SetEnvironmentVariable('${name}','${escaped}','User')`,
    ],
    { encoding: 'utf8' }
  );
  return result.status === 0;
}

export function snapshotCurrent() {
  const snapshot = {};
  for (const name of VARS) snapshot[name] = readUserEnv(name);
  return snapshot;
}

export function planWindowsWrite(env) {
  const before = snapshotCurrent();
  const after = {
    CLAUDE_CODE_USE_BEDROCK: '1',
    AWS_REGION: env.AWS_REGION,
    AWS_BEARER_TOKEN_BEDROCK: env.AWS_BEARER_TOKEN_BEDROCK,
    ANTHROPIC_DEFAULT_OPUS_MODEL: env.ANTHROPIC_DEFAULT_OPUS_MODEL,
  };
  const changes = VARS.filter((k) => before[k] !== after[k]).map((k) => ({
    name: k,
    from: before[k],
    to: after[k],
  }));
  return { before, after, changes };
}

export function applyWindowsWrite(plan) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = join(BACKUP_DIR, `env-snapshot-${timestamp()}.json`);
  writeFileSync(backupPath, JSON.stringify(plan.before, null, 2), 'utf8');

  const failed = [];
  for (const [name, value] of Object.entries(plan.after)) {
    if (!writeUserEnv(name, value)) failed.push(name);
  }

  return {
    backupPath,
    failed,
    revertHint: `powershell -NoProfile -Command "$snap = Get-Content '${backupPath}' | ConvertFrom-Json; foreach ($p in $snap.PSObject.Properties) { [Environment]::SetEnvironmentVariable($p.Name, $p.Value, 'User') }"`,
  };
}

export function diffPreviewWindows(plan) {
  if (plan.changes.length === 0) return 'No changes. User env vars already match the requested values.';
  const lines = ['The following User-scope environment variables will be set:'];
  for (const c of plan.changes) {
    const from = c.from === null ? '(unset)' : c.from;
    const masked = c.name === 'AWS_BEARER_TOKEN_BEDROCK' ? maskToken(c.to) : c.to;
    lines.push(`  ${c.name}: ${from} -> ${masked}`);
  }
  lines.push('');
  lines.push(`A snapshot of the current values will be saved to ${BACKUP_DIR} before any changes.`);
  return lines.join('\n');
}

function maskToken(value) {
  if (!value || value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

export { BACKUP_DIR };
