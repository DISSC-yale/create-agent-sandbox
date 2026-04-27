import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PYTHON_APT_LINES = ['python3', 'python3-pip', 'python3-venv'];
const R_APT_LINES = ['r-base', 'r-base-dev'];
const R_INSTALL_RE = /^RUN R -e 'install\.packages\([^']*\)'\s*$/m;
const LOCALE_BLOCK_RE = /# Generate locale for R\s*\nRUN sed -i.*\nENV LANG=en_US\.UTF-8\s*\nENV LC_ALL=en_US\.UTF-8/m;

function dropAptLine(content, pkg) {
  const re = new RegExp(`^[ \\t]*${pkg}[ \\t]*\\\\?[ \\t]*\\r?\\n`, 'm');
  return content.replace(re, '');
}

function dropAllAptLines(content, pkgs) {
  let out = content;
  for (const p of pkgs) out = dropAptLine(out, p);
  return out;
}

function dropRInstall(content) {
  return content.replace(R_INSTALL_RE, '').replace(/\n{3,}/g, '\n\n');
}

function relabelLocaleBlock(content) {
  return content.replace(
    '# Generate locale for R',
    '# Generate locale (en_US.UTF-8)'
  );
}

export function planDockerfileEdit({ projectDir, languages }) {
  const dockerfilePath = join(projectDir, '.devcontainer', 'Dockerfile');
  if (!existsSync(dockerfilePath)) {
    return { applicable: false, reason: `No Dockerfile found at ${dockerfilePath}` };
  }
  const before = readFileSync(dockerfilePath, 'utf8');
  let after = before;

  const includePython = languages.includes('python');
  const includeR = languages.includes('r');

  if (!includePython) after = dropAllAptLines(after, PYTHON_APT_LINES);
  if (!includeR) {
    after = dropAllAptLines(after, R_APT_LINES);
    after = dropRInstall(after);
  }
  after = relabelLocaleBlock(after);

  return {
    applicable: true,
    path: dockerfilePath,
    before,
    after,
    changed: before !== after,
    languages,
  };
}

export function applyDockerfileEdit(plan) {
  if (!plan.applicable || !plan.changed) return { written: false, path: plan.path };
  writeFileSync(plan.path, plan.after, 'utf8');
  return { written: true, path: plan.path };
}

const LANGUAGE_EXTENSIONS = {
  python: ['ms-python.python'],
  r: ['reditorsupport.r', 'quarto.quarto'],
};

const ALL_MANAGED_EXTENSIONS = Object.values(LANGUAGE_EXTENSIONS).flat();

function extensionsForLanguages(languages) {
  const out = [];
  for (const lang of ['python', 'r']) {
    if (languages.includes(lang)) out.push(...LANGUAGE_EXTENSIONS[lang]);
  }
  return out;
}

function detectIndent(source) {
  const match = source.match(/\n([ \t]+)\S/);
  if (!match) return 2;
  const lead = match[1];
  if (lead.startsWith('\t')) return '\t';
  return lead.length;
}

function detectTrailingNewline(source) {
  return source.endsWith('\n') ? '\n' : '';
}

export function planDevcontainerEdit({ projectDir, languages }) {
  const devcontainerPath = join(projectDir, '.devcontainer', 'devcontainer.json');
  if (!existsSync(devcontainerPath)) {
    return { applicable: false, reason: `No devcontainer.json found at ${devcontainerPath}` };
  }
  const before = readFileSync(devcontainerPath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(before);
  } catch (err) {
    return { applicable: false, reason: `devcontainer.json is not valid JSON (${err.message})` };
  }
  const extensions = parsed?.customizations?.vscode?.extensions;
  if (!Array.isArray(extensions)) {
    return { applicable: false, reason: 'devcontainer.json is missing customizations.vscode.extensions array' };
  }

  const desired = extensionsForLanguages(languages);
  const desiredSet = new Set(desired);
  const managedSet = new Set(ALL_MANAGED_EXTENSIONS);

  const kept = extensions.filter((id) => !managedSet.has(id) || desiredSet.has(id));
  const removed = extensions.filter((id) => managedSet.has(id) && !desiredSet.has(id));
  const added = desired.filter((id) => !extensions.includes(id));
  const nextExtensions = [...kept];
  for (const id of added) if (!nextExtensions.includes(id)) nextExtensions.push(id);

  if (added.length === 0 && removed.length === 0) {
    return {
      applicable: true,
      path: devcontainerPath,
      before,
      after: before,
      changed: false,
      added,
      removed,
      languages,
    };
  }

  parsed.customizations.vscode.extensions = nextExtensions;
  const indent = detectIndent(before);
  const trailing = detectTrailingNewline(before);
  const after = JSON.stringify(parsed, null, indent) + trailing;
  return {
    applicable: true,
    path: devcontainerPath,
    before,
    after,
    changed: before !== after,
    added,
    removed,
    languages,
  };
}

export function applyDevcontainerEdit(plan) {
  if (!plan.applicable || !plan.changed) return { written: false, path: plan.path };
  writeFileSync(plan.path, plan.after, 'utf8');
  return { written: true, path: plan.path };
}

export function summarizeChoice(languages) {
  if (languages.length === 0) return 'No extra languages: Node only (fastest build, ~2-5 min).';
  const parts = [];
  if (languages.includes('python')) parts.push('Python 3 (+ pip, venv)');
  if (languages.includes('r')) parts.push('R + tidyverse + languageserver');
  const time = languages.includes('r') ? '~20-40 min' : '~5-10 min';
  return `Including: ${parts.join(', ')}. First build: ${time}.`;
}
