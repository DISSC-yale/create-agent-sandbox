import { readFileSync, writeFileSync, existsSync, copyFileSync, chmodSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SENTINEL_START = '# >>> agent-sandbox bedrock config >>>';
const SENTINEL_END = '# <<< agent-sandbox bedrock config <<<';
const ZPROFILE_PATH = join(homedir(), '.zprofile');

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function readZprofile() {
  if (!existsSync(ZPROFILE_PATH)) return null;
  return readFileSync(ZPROFILE_PATH, 'utf8');
}

const BEDROCK_VAR_NAMES = [
  'CLAUDE_CODE_USE_BEDROCK',
  'AWS_REGION',
  'AWS_BEARER_TOKEN_BEDROCK',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
];

function parseExportValue(line) {
  const match = line.match(/^\s*export\s+([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!match) return null;
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  return { name: match[1], value };
}

export function readExistingBedrockEnv(content = readZprofile()) {
  const env = Object.fromEntries(BEDROCK_VAR_NAMES.map((k) => [k, null]));
  if (!content) return env;
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseExportValue(line);
    if (parsed && BEDROCK_VAR_NAMES.includes(parsed.name)) {
      env[parsed.name] = parsed.value;
    }
  }
  return env;
}

export function existingBedrockBlock(content = readZprofile()) {
  if (!content) return null;
  const start = content.indexOf(SENTINEL_START);
  if (start === -1) {
    if (/\bCLAUDE_CODE_USE_BEDROCK\b/.test(content)) {
      return { managed: false };
    }
    return null;
  }
  const end = content.indexOf(SENTINEL_END, start);
  if (end === -1) return { managed: true, malformed: true };
  return { managed: true, block: content.slice(start, end + SENTINEL_END.length) };
}

function buildBlock(env) {
  const lines = [
    SENTINEL_START,
    `# Added by @yale-dissc/create-agent-sandbox on ${new Date().toISOString()}`,
    `export CLAUDE_CODE_USE_BEDROCK=1`,
    `export AWS_REGION=${env.AWS_REGION}`,
    `export AWS_BEARER_TOKEN_BEDROCK=${env.AWS_BEARER_TOKEN_BEDROCK}`,
    `export ANTHROPIC_DEFAULT_OPUS_MODEL=${env.ANTHROPIC_DEFAULT_OPUS_MODEL}`,
    SENTINEL_END,
  ];
  return lines.join('\n');
}

function maskToken(value) {
  if (!value) return '(unset)';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function maskBedrockBlock(block) {
  return block.replace(
    /^(export AWS_BEARER_TOKEN_BEDROCK=)(.*)$/m,
    (_m, prefix, value) => `${prefix}${maskToken(value)}`
  );
}

function envValuesMatch(vars, env) {
  return (
    vars.CLAUDE_CODE_USE_BEDROCK === '1' &&
    vars.AWS_REGION === env.AWS_REGION &&
    vars.AWS_BEARER_TOKEN_BEDROCK === env.AWS_BEARER_TOKEN_BEDROCK &&
    vars.ANTHROPIC_DEFAULT_OPUS_MODEL === env.ANTHROPIC_DEFAULT_OPUS_MODEL
  );
}

function blockValuesMatch(block, env) {
  if (!block) return false;
  return envValuesMatch(readExistingBedrockEnv(block), env);
}

export function planZprofileWrite(env) {
  const existing = readZprofile();
  const newBlock = buildBlock(env);
  const detected = existingBedrockBlock(existing);

  let nextContent;
  let mode;
  if (detected?.managed && detected.block && blockValuesMatch(detected.block, env)) {
    return {
      path: ZPROFILE_PATH,
      mode: 'noop',
      existing,
      nextContent: existing,
      block: maskBedrockBlock(detected.block),
      detected,
    };
  }
  // Pre-sentinel era: the four vars are already exported somewhere in the file
  // with the requested values. Nothing to do, even though no managed block exists.
  if (existing !== null && envValuesMatch(readExistingBedrockEnv(existing), env)) {
    return {
      path: ZPROFILE_PATH,
      mode: 'noop',
      existing,
      nextContent: existing,
      block: maskBedrockBlock(newBlock),
      detected,
    };
  }
  if (existing === null) {
    nextContent = newBlock + '\n';
    mode = 'create';
  } else if (!detected) {
    const sep = existing.endsWith('\n') ? '\n' : '\n\n';
    nextContent = existing + sep + newBlock + '\n';
    mode = 'append';
  } else if (detected.managed && detected.block) {
    nextContent = existing.replace(detected.block, newBlock);
    mode = 'replace-managed';
  } else {
    const sep = existing.endsWith('\n') ? '\n' : '\n\n';
    nextContent = existing + sep + newBlock + '\n';
    mode = 'append-conflict';
  }

  return {
    path: ZPROFILE_PATH,
    mode,
    existing,
    nextContent,
    block: maskBedrockBlock(newBlock),
    detected,
  };
}

export function applyZprofileWrite(plan) {
  const { path, existing, nextContent } = plan;
  if (plan.mode === 'noop') {
    return { backupPath: null, path, revertHint: '(no changes written)' };
  }

  let backupPath = null;
  if (existing !== null) {
    const currentOnDisk = readFileSync(path, 'utf8');
    if (currentOnDisk !== existing) {
      throw new Error(
        `Refusing to write: ${path} changed on disk between preview and apply. No changes were made. Re-run the wizard to pick up the new contents.`
      );
    }
    backupPath = `${path}.backup-${timestamp()}`;
    copyFileSync(path, backupPath);
    if (!existsSync(backupPath) || readFileSync(backupPath, 'utf8') !== existing) {
      throw new Error(`Backup at ${backupPath} did not match source; aborting without modifying ${path}.`);
    }
  }

  const tmpPath = `${path}.tmp-${timestamp()}-${process.pid}`;
  writeFileSync(tmpPath, nextContent, { mode: 0o600 });
  try {
    chmodSync(tmpPath, 0o600);
    renameSync(tmpPath, path);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch {}
    throw err;
  }
  chmodSync(path, 0o600);

  return {
    backupPath,
    path,
    revertHint: backupPath
      ? `mv "${backupPath}" "${path}"`
      : `rm "${path}"`,
  };
}

export function diffPreview(plan) {
  const { mode, block, detected } = plan;
  const headers = {
    create: `Create ${plan.path} with:`,
    append: `Append to ${plan.path}:`,
    'replace-managed': `Replace existing managed block in ${plan.path} with:`,
    'append-conflict': `WARNING: ${plan.path} already defines CLAUDE_CODE_USE_BEDROCK outside a managed block. Appending the new block; you may want to remove the duplicate manually.\n\nAppending:`,
    noop: `${plan.path} already has the requested Bedrock config:`,
  };
  return `${headers[mode]}\n\n${block}\n${detected?.malformed ? '\n(note: existing managed block found but missing closing sentinel; appending instead of replacing)' : ''}`;
}

export { ZPROFILE_PATH, SENTINEL_START, SENTINEL_END };
