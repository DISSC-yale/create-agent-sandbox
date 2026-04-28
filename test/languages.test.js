import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  planDockerfileEdit,
  applyDockerfileEdit,
  planDevcontainerEdit,
  applyDevcontainerEdit,
  summarizeChoice,
} from '../src/languages.js';

const MINIMAL_DOCKERFILE = [
  'FROM node:20',
  'RUN apt-get update && apt-get install -y \\',
  '    build-essential \\',
  '    python3 \\',
  '    python3-pip \\',
  '    python3-venv \\',
  '    r-base \\',
  '    r-base-dev \\',
  '    curl',
  '',
  "RUN R -e 'install.packages(c(\"tidyverse\",\"languageserver\"))'",
  '',
  '# Generate locale for R',
  "RUN sed -i 's/# en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen",
  'ENV LANG=en_US.UTF-8',
  'ENV LC_ALL=en_US.UTF-8',
  '',
].join('\n');

const MINIMAL_DEVCONTAINER = {
  name: 'Agent Sandbox',
  customizations: {
    vscode: {
      extensions: [
        'anthropic.claude-code',
        'dbaeumer.vscode-eslint',
        'esbenp.prettier-vscode',
        'eamodio.gitlens',
      ],
    },
  },
};

function makeProject(prefix, { devcontainer = MINIMAL_DEVCONTAINER, dockerfile = MINIMAL_DOCKERFILE } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `lang-${prefix}-`));
  const devDir = join(dir, '.devcontainer');
  mkdirSync(devDir, { recursive: true });
  if (dockerfile !== null) writeFileSync(join(devDir, 'Dockerfile'), dockerfile);
  if (devcontainer !== null) writeFileSync(join(devDir, 'devcontainer.json'), JSON.stringify(devcontainer, null, 2) + '\n');
  return dir;
}

// ---------- Dockerfile edits ----------

test('planDockerfileEdit: [] removes python and R apt lines and the R install', () => {
  const dir = makeProject('docker-none');
  try {
    const plan = planDockerfileEdit({ projectDir: dir, languages: [] });
    assert.equal(plan.applicable, true);
    assert.equal(plan.changed, true);
    assert.doesNotMatch(plan.after, /python3-pip/);
    assert.doesNotMatch(plan.after, /r-base-dev/);
    assert.doesNotMatch(plan.after, /install\.packages/);
    assert.match(plan.after, /# Generate locale \(en_US\.UTF-8\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planDockerfileEdit: ['python'] keeps python, drops R", () => {
  const dir = makeProject('docker-py');
  try {
    const plan = planDockerfileEdit({ projectDir: dir, languages: ['python'] });
    assert.match(plan.after, /python3-pip/);
    assert.doesNotMatch(plan.after, /r-base-dev/);
    assert.doesNotMatch(plan.after, /install\.packages/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planDockerfileEdit: ['r'] keeps R, drops python", () => {
  const dir = makeProject('docker-r');
  try {
    const plan = planDockerfileEdit({ projectDir: dir, languages: ['r'] });
    assert.doesNotMatch(plan.after, /python3-pip/);
    assert.match(plan.after, /r-base-dev/);
    assert.match(plan.after, /install\.packages/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planDockerfileEdit: ['python','r'] is a no-op against default template", () => {
  const dir = makeProject('docker-both');
  try {
    const plan = planDockerfileEdit({ projectDir: dir, languages: ['python', 'r'] });
    // The only change relabelLocaleBlock does should trigger `changed:true`.
    assert.equal(plan.changed, true);
    assert.match(plan.after, /python3-pip/);
    assert.match(plan.after, /r-base-dev/);
    assert.match(plan.after, /install\.packages/);
    assert.match(plan.after, /# Generate locale \(en_US\.UTF-8\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planDockerfileEdit: returns applicable:false when Dockerfile is missing', () => {
  const dir = makeProject('docker-missing', { dockerfile: null });
  try {
    const plan = planDockerfileEdit({ projectDir: dir, languages: ['python'] });
    assert.equal(plan.applicable, false);
    assert.match(plan.reason, /No Dockerfile found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('applyDockerfileEdit: writes to disk and is idempotent on second plan', () => {
  const dir = makeProject('docker-idem');
  try {
    const plan1 = planDockerfileEdit({ projectDir: dir, languages: ['python'] });
    applyDockerfileEdit(plan1);
    const plan2 = planDockerfileEdit({ projectDir: dir, languages: ['python'] });
    assert.equal(plan2.changed, false, 'second plan should report no change');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- devcontainer edits ----------

test('planDevcontainerEdit: [] is a no-op on a clean template', () => {
  const dir = makeProject('dc-none');
  try {
    const plan = planDevcontainerEdit({ projectDir: dir, languages: [] });
    assert.equal(plan.applicable, true);
    assert.equal(plan.changed, false);
    assert.deepEqual(plan.added, []);
    assert.deepEqual(plan.removed, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planDevcontainerEdit: ['r'] adds reditorsupport.r and quarto.quarto to the end", () => {
  const dir = makeProject('dc-r');
  try {
    const plan = planDevcontainerEdit({ projectDir: dir, languages: ['r'] });
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.added, ['reditorsupport.r', 'quarto.quarto']);
    const next = JSON.parse(plan.after);
    const exts = next.customizations.vscode.extensions;
    // Originals preserved in order
    assert.equal(exts[0], 'anthropic.claude-code');
    assert.equal(exts[1], 'dbaeumer.vscode-eslint');
    assert.equal(exts[2], 'esbenp.prettier-vscode');
    assert.equal(exts[3], 'eamodio.gitlens');
    // New IDs appended
    assert.deepEqual(exts.slice(-2), ['reditorsupport.r', 'quarto.quarto']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planDevcontainerEdit: ['python'] adds only ms-python.python", () => {
  const dir = makeProject('dc-py');
  try {
    const plan = planDevcontainerEdit({ projectDir: dir, languages: ['python'] });
    assert.deepEqual(plan.added, ['ms-python.python']);
    const exts = JSON.parse(plan.after).customizations.vscode.extensions;
    assert.ok(exts.includes('ms-python.python'));
    assert.ok(!exts.includes('reditorsupport.r'));
    assert.ok(!exts.includes('quarto.quarto'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planDevcontainerEdit: is idempotent on a second run', () => {
  const dir = makeProject('dc-idem');
  try {
    const first = planDevcontainerEdit({ projectDir: dir, languages: ['r'] });
    applyDevcontainerEdit(first);
    const second = planDevcontainerEdit({ projectDir: dir, languages: ['r'] });
    assert.equal(second.changed, false);
    assert.deepEqual(second.added, []);
    // No duplicates
    const exts = JSON.parse(readFileSync(join(dir, '.devcontainer', 'devcontainer.json'), 'utf8')).customizations.vscode.extensions;
    assert.equal(exts.filter((e) => e === 'reditorsupport.r').length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planDevcontainerEdit: toggling off removes previously added managed extensions', () => {
  const dir = makeProject('dc-toggle');
  try {
    const withR = planDevcontainerEdit({ projectDir: dir, languages: ['r'] });
    applyDevcontainerEdit(withR);
    const toggleOff = planDevcontainerEdit({ projectDir: dir, languages: [] });
    assert.equal(toggleOff.changed, true);
    assert.deepEqual(toggleOff.removed, ['reditorsupport.r', 'quarto.quarto']);
    const exts = JSON.parse(toggleOff.after).customizations.vscode.extensions;
    assert.ok(!exts.includes('reditorsupport.r'));
    assert.ok(!exts.includes('quarto.quarto'));
    // Originals still present
    assert.ok(exts.includes('anthropic.claude-code'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planDevcontainerEdit: does NOT remove non-managed extensions the user added', () => {
  const dir = makeProject('dc-user-ext', {
    devcontainer: {
      ...MINIMAL_DEVCONTAINER,
      customizations: {
        vscode: {
          extensions: [
            ...MINIMAL_DEVCONTAINER.customizations.vscode.extensions,
            'redhat.vscode-yaml', // user-added, non-managed
          ],
        },
      },
    },
  });
  try {
    const plan = planDevcontainerEdit({ projectDir: dir, languages: [] });
    assert.equal(plan.changed, false, 'no managed IDs → no change');
    const exts = JSON.parse(plan.after).customizations.vscode.extensions;
    assert.ok(exts.includes('redhat.vscode-yaml'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planDevcontainerEdit: applicable:false on missing devcontainer.json', () => {
  const dir = makeProject('dc-missing', { devcontainer: null });
  try {
    const plan = planDevcontainerEdit({ projectDir: dir, languages: ['r'] });
    assert.equal(plan.applicable, false);
    assert.match(plan.reason, /No devcontainer\.json found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planDevcontainerEdit: applicable:false on malformed JSON', () => {
  const dir = makeProject('dc-bad');
  writeFileSync(join(dir, '.devcontainer', 'devcontainer.json'), '{ not valid json');
  try {
    const plan = planDevcontainerEdit({ projectDir: dir, languages: ['r'] });
    assert.equal(plan.applicable, false);
    assert.match(plan.reason, /not valid JSON/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planDevcontainerEdit: applicable:false when extensions array is missing', () => {
  const dir = makeProject('dc-noext', {
    devcontainer: { name: 'x', customizations: { vscode: {} } },
  });
  try {
    const plan = planDevcontainerEdit({ projectDir: dir, languages: ['r'] });
    assert.equal(plan.applicable, false);
    assert.match(plan.reason, /customizations\.vscode\.extensions/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('planDevcontainerEdit: preserves trailing newline and does not scramble other keys', () => {
  const dir = makeProject('dc-struct');
  try {
    const before = readFileSync(join(dir, '.devcontainer', 'devcontainer.json'), 'utf8');
    assert.ok(before.endsWith('\n'));
    const plan = planDevcontainerEdit({ projectDir: dir, languages: ['r'] });
    assert.ok(plan.after.endsWith('\n'));
    // The unrelated `name` field is untouched
    assert.match(plan.after, /"name": "Agent Sandbox"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- summary helper ----------

test('summarizeChoice: reports build times correctly', () => {
  assert.match(summarizeChoice([]), /Node only/);
  assert.match(summarizeChoice(['python']), /~5-10 min/);
  assert.match(summarizeChoice(['r']), /~20-40 min/);
  assert.match(summarizeChoice(['python', 'r']), /~20-40 min/);
});
