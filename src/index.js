import * as p from '@clack/prompts';
import pc from 'picocolors';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { existsSync } from 'node:fs';

import { detectAll, summarize, IS_MAC, IS_WINDOWS } from './detect.js';
import { hyperlink, installInstruction, tryOpenInBrowser, tryStartDocker } from './install-links.js';
import { planZprofileWrite, applyZprofileWrite, diffPreview, readExistingBedrockEnv as readZprofileBedrockEnv } from './zprofile.js';
import { planWindowsWrite, applyWindowsWrite, diffPreviewWindows, readExistingBedrockEnv as readWindowsBedrockEnv } from './windows-env.js';
import { fetchTemplate, REPO } from './template.js';
import { initGit, createGithubRepo, manualInstructions } from './github.js';
import { planDockerfileEdit, applyDockerfileEdit, planDevcontainerEdit, applyDevcontainerEdit, summarizeChoice } from './languages.js';
import { printBanner } from './banner.js';

function bail(msg) {
  p.cancel(msg);
  process.exit(1);
}

function validateProjectName(name) {
  if (!name) return 'Required';
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return 'Letters, numbers, dot, dash, underscore only';
  if (existsSync(resolve(process.cwd(), name))) return `./${name} already exists`;
  return undefined;
}

async function waitForUser(message) {
  await p.text({
    message,
    placeholder: '(press Enter to continue)',
    validate: () => undefined,
  });
}

async function ensureRequiredHostDeps(report, { dryRun }) {
  const missing = [];
  if (!report.git.installed) missing.push('git');
  if (!report.docker.installed) missing.push('docker');
  if (!report.vscode.installed) missing.push('vscode');

  if (missing.length === 0 && report.docker.running) return report;

  for (const key of missing) {
    const info = installInstruction(key);
    p.log.warn(`${info.label} is not installed.`);
    p.log.message(`Install link: ${info.clickable}`);
    if (!dryRun) {
      const open = await p.confirm({ message: `Open the ${info.label} download page in your browser now?`, initialValue: true });
      if (open && !p.isCancel(open)) tryOpenInBrowser(info.url);
      await waitForUser(`Press Enter once ${info.label} is installed (and running, if applicable)...`);
    }
  }

  if (!report.docker.running) {
    p.log.info('Attempting to start Docker Desktop...');
    if (!dryRun) tryStartDocker();
    await waitForUser('Press Enter once Docker Desktop is running (whale icon steady in your menu/tray)...');
  }

  return detectAll();
}

async function ensureDevContainersExt(report, { dryRun }) {
  if (report.devContainersExt.installed) return report;
  const info = installInstruction('devContainersExt');
  p.log.warn(`Dev Containers VS Code extension is not installed.`);
  const auto = await p.confirm({
    message: 'Install it automatically via the `code` CLI?',
    initialValue: true,
  });
  if (auto && !p.isCancel(auto)) {
    if (!dryRun) {
      const r = spawnSync('code', ['--install-extension', 'ms-vscode-remote.remote-containers'], {
        stdio: 'inherit',
      });
      if (r.status !== 0) {
        p.log.warn(`Automatic install failed. Open this link to install manually: ${info.clickable}`);
        await waitForUser('Press Enter once the extension is installed...');
      }
    } else {
      p.log.message('[dry-run] would run: code --install-extension ms-vscode-remote.remote-containers');
    }
  } else {
    p.log.message(`Install link: ${info.clickable}`);
    await waitForUser('Press Enter once the extension is installed...');
  }
  return detectAll();
}

async function chooseAuthMode() {
  const choice = await p.select({
    message: 'Choose your Claude Code authentication mode',
    options: [
      { value: 'max', label: 'Anthropic via Claude.ai (Pro/Max subscription)', hint: 'OAuth /login inside the container; recommended for individuals' },
      { value: 'bedrock', label: 'Anthropic via AWS Bedrock', hint: 'For teams with AWS-managed billing' },
    ],
    initialValue: 'max',
  });
  if (p.isCancel(choice)) bail('Cancelled.');
  return choice;
}

function detectExistingBedrockEnv() {
  if (IS_MAC) return readZprofileBedrockEnv();
  if (IS_WINDOWS) return readWindowsBedrockEnv();
  return {
    CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK ?? null,
    AWS_REGION: process.env.AWS_REGION ?? null,
    AWS_BEARER_TOKEN_BEDROCK: process.env.AWS_BEARER_TOKEN_BEDROCK ?? null,
    ANTHROPIC_DEFAULT_OPUS_MODEL: process.env.ANTHROPIC_DEFAULT_OPUS_MODEL ?? null,
  };
}

const existingBedrockEnvCache = { snapshot: null };

function loadExistingBedrockEnv() {
  if (existingBedrockEnvCache.snapshot) return existingBedrockEnvCache.snapshot;
  existingBedrockEnvCache.snapshot = detectExistingBedrockEnv();
  return existingBedrockEnvCache.snapshot;
}

function maskToken(value) {
  if (!value) return '(unset)';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function maybeReuseExistingBedrockEnv(existing) {
  const hasAll = existing.AWS_REGION && existing.AWS_BEARER_TOKEN_BEDROCK && existing.ANTHROPIC_DEFAULT_OPUS_MODEL;
  if (!hasAll) return null;
  const profileLabel = IS_MAC ? '~/.zprofile' : IS_WINDOWS ? 'Windows User env' : 'current shell';
  p.log.info(`Found existing Bedrock config in ${profileLabel}:`);
  p.log.message([
    `  AWS_REGION=${existing.AWS_REGION}`,
    `  AWS_BEARER_TOKEN_BEDROCK=${maskToken(existing.AWS_BEARER_TOKEN_BEDROCK)}`,
    `  ANTHROPIC_DEFAULT_OPUS_MODEL=${existing.ANTHROPIC_DEFAULT_OPUS_MODEL}`,
  ].join('\n'));
  const reuse = await p.confirm({ message: 'Reuse these values?', initialValue: true });
  if (p.isCancel(reuse)) bail('Cancelled.');
  if (!reuse) return null;
  return {
    AWS_REGION: existing.AWS_REGION,
    AWS_BEARER_TOKEN_BEDROCK: existing.AWS_BEARER_TOKEN_BEDROCK,
    ANTHROPIC_DEFAULT_OPUS_MODEL: existing.ANTHROPIC_DEFAULT_OPUS_MODEL,
  };
}

async function gatherBedrockEnv(existing = {}) {
  const region = await p.text({
    message: 'AWS region',
    initialValue: existing.AWS_REGION || 'us-east-1',
    validate: (v) => (v.trim() ? undefined : 'Required'),
  });
  if (p.isCancel(region)) bail('Cancelled.');
  const tokenPrompt = existing.AWS_BEARER_TOKEN_BEDROCK
    ? `AWS Bedrock bearer token (press Enter to keep existing ${maskToken(existing.AWS_BEARER_TOKEN_BEDROCK)})`
    : 'AWS Bedrock bearer token (AWS_BEARER_TOKEN_BEDROCK)';
  const token = await p.password({
    message: tokenPrompt,
    validate: (v) => {
      if (v.trim()) return undefined;
      return existing.AWS_BEARER_TOKEN_BEDROCK ? undefined : 'Required';
    },
  });
  if (p.isCancel(token)) bail('Cancelled.');
  const model = await p.text({
    message: 'Default Opus model identifier',
    initialValue: existing.ANTHROPIC_DEFAULT_OPUS_MODEL || 'us.anthropic.claude-opus-4-1-20250805-v1:0',
  });
  if (p.isCancel(model)) bail('Cancelled.');
  const tokenValue = String(token).trim() || existing.AWS_BEARER_TOKEN_BEDROCK;
  return {
    AWS_REGION: String(region).trim(),
    AWS_BEARER_TOKEN_BEDROCK: tokenValue,
    ANTHROPIC_DEFAULT_OPUS_MODEL: String(model).trim(),
  };
}

async function writeBedrockEnv(env, { dryRun }) {
  if (IS_MAC) {
    const plan = planZprofileWrite(env);
    if (plan.mode === 'noop') {
      p.log.info(`${plan.path} already has the requested Bedrock config; nothing to write.`);
      return;
    }
    p.log.message(diffPreview(plan));
    if (dryRun) {
      p.log.info('[dry-run] no files written.');
      return;
    }
    const ok = await p.confirm({ message: `Write changes to ${plan.path}? (a timestamped backup will be created)`, initialValue: true });
    if (!ok || p.isCancel(ok)) {
      p.log.warn('Skipped writing ~/.zprofile. You can add the variables manually later.');
      return;
    }
    const result = applyZprofileWrite(plan);
    if (result.backupPath) p.log.success(`Backup saved to ${result.backupPath}`);
    p.log.success(`Wrote ${result.path}`);
    p.log.message(`To revert: ${result.revertHint}`);
  } else if (IS_WINDOWS) {
    const plan = planWindowsWrite(env, { snapshot: loadExistingBedrockEnv() });
    p.log.message(diffPreviewWindows(plan));
    if (dryRun) {
      p.log.info('[dry-run] no env vars set.');
      return;
    }
    if (plan.changes.length === 0) return;
    const ok = await p.confirm({ message: 'Apply these env var changes? (a JSON snapshot of current values will be saved first)', initialValue: true });
    if (!ok || p.isCancel(ok)) {
      p.log.warn('Skipped setting env vars. You can set them manually via PowerShell.');
      return;
    }
    const result = applyWindowsWrite(plan);
    p.log.success(`Snapshot saved to ${result.backupPath}`);
    if (result.failed.length) p.log.warn(`Failed to set: ${result.failed.join(', ')}`);
    else p.log.success('All env vars set at User scope.');
    p.log.message(`To revert, run:\n  ${result.revertHint}`);
  } else {
    p.log.warn('Linux host detected. Add these lines to your shell profile manually:');
    p.log.message([
      `export CLAUDE_CODE_USE_BEDROCK=1`,
      `export AWS_REGION=${env.AWS_REGION}`,
      `export AWS_BEARER_TOKEN_BEDROCK=${env.AWS_BEARER_TOKEN_BEDROCK}`,
      `export ANTHROPIC_DEFAULT_OPUS_MODEL=${env.ANTHROPIC_DEFAULT_OPUS_MODEL}`,
    ].join('\n'));
  }
}

async function chooseLanguages() {
  const choice = await p.multiselect({
    message: 'Which languages should be pre-installed in the container?',
    options: [
      { value: 'python', label: 'Python 3 (+ pip, venv)', hint: 'adds ~2-5 min to first build' },
      { value: 'r', label: 'R + tidyverse + languageserver', hint: 'adds ~15-30 min to first build' },
    ],
    initialValues: [],
    required: false,
  });
  if (p.isCancel(choice)) bail('Cancelled.');
  return Array.isArray(choice) ? choice : [];
}

async function applyLanguageChoice({ projectDir, languages, dryRun }) {
  const dockerPlan = planDockerfileEdit({ projectDir, languages });
  if (!dockerPlan.applicable) {
    p.log.warn(dockerPlan.reason + '. Skipping language toggle.');
    return;
  }
  const devcontainerPlan = planDevcontainerEdit({ projectDir, languages });
  if (!devcontainerPlan.applicable) {
    p.log.warn(devcontainerPlan.reason + '. VS Code extensions will not be updated.');
  }

  p.log.message(summarizeChoice(languages));

  const willEdit = [];
  if (dockerPlan.changed) willEdit.push(dockerPlan.path);
  if (devcontainerPlan.applicable && devcontainerPlan.changed) {
    const parts = [];
    if (devcontainerPlan.added?.length) parts.push(`+ ${devcontainerPlan.added.join(', ')}`);
    if (devcontainerPlan.removed?.length) parts.push(`- ${devcontainerPlan.removed.join(', ')}`);
    willEdit.push(`${devcontainerPlan.path} (${parts.join('; ')})`);
  }
  if (willEdit.length === 0) {
    p.log.info('Dockerfile and devcontainer.json already match your selection; no edits needed.');
    return;
  }
  if (dryRun) {
    p.log.info(`[dry-run] would edit:\n  ${willEdit.join('\n  ')}`);
    return;
  }

  const dockerResult = applyDockerfileEdit(dockerPlan);
  const devResult = devcontainerPlan.applicable ? applyDevcontainerEdit(devcontainerPlan) : { written: false };
  const written = [];
  if (dockerResult.written) written.push(dockerResult.path);
  if (devResult.written) written.push(devResult.path);
  if (written.length) p.log.success(`Updated:\n  ${written.join('\n  ')}`);
}

async function maybeCreateGithubRepo({ projectDir, projectName, ghReport, dryRun }) {
  const wantRepo = await p.confirm({
    message: 'Initialize a git repo and push to GitHub?',
    initialValue: true,
  });
  if (!wantRepo || p.isCancel(wantRepo)) return;

  const workspacePath = join(projectDir, 'workspace');
  if (!existsSync(workspacePath)) {
    p.log.warn(`No workspace/ folder found in ${projectDir}; skipping git init.`);
    return;
  }

  if (dryRun) {
    p.log.info(`[dry-run] would run: git init && git add . && git commit -m "Initial commit" in ${workspacePath}`);
  } else {
    const init = initGit(workspacePath);
    if (init.alreadyRepo) p.log.info('workspace/ is already a git repo; skipping init.');
    else if (init.initialized) p.log.success(`Initialized git repo in ${workspacePath}`);
    else { p.log.warn(`git init failed: ${init.error || 'unknown'}`); return; }
  }

  if (!ghReport.installed) {
    p.log.message(`GitHub CLI not installed. Install it from ${hyperlink('https://cli.github.com/', 'cli.github.com')} or run:\n${manualInstructions({ name: projectName })}`);
    return;
  }
  if (!ghReport.authed) {
    p.log.warn('gh is installed but not authenticated.');
    const login = await p.confirm({ message: 'Run `gh auth login` now?', initialValue: true });
    if (login && !p.isCancel(login) && !dryRun) {
      spawnSync('gh', ['auth', 'login'], { stdio: 'inherit' });
    } else if (dryRun) {
      p.log.info('[dry-run] would run: gh auth login');
    }
  }

  const visibility = await p.select({
    message: 'Repository visibility',
    options: [
      { value: 'private', label: 'Private (recommended)' },
      { value: 'internal', label: 'Internal (org-only)' },
      { value: 'public', label: 'Public' },
    ],
    initialValue: 'private',
  });
  if (p.isCancel(visibility)) return;

  if (dryRun) {
    p.log.info(`[dry-run] would run: gh repo create ${projectName} --${visibility} --source=. --push (in ${workspacePath})`);
    return;
  }
  const r = createGithubRepo({ workspacePath, name: projectName, visibility, push: true });
  if (r.ok) p.log.success(`Created GitHub repo and pushed initial commit.`);
  else p.log.warn(`gh repo create failed. Manual steps:\n${manualInstructions({ name: projectName })}`);
}

async function maybeLaunchVSCode(projectDir, { dryRun }) {
  const launch = await p.confirm({ message: 'Open the project in VS Code now?', initialValue: true });
  if (!launch || p.isCancel(launch)) return;
  if (dryRun) {
    p.log.info(`[dry-run] would run: code "${projectDir}"`);
    return;
  }
  const r = spawnSync('code', [projectDir], { stdio: 'inherit' });
  if (r.status !== 0) p.log.warn(`Could not launch VS Code. Run manually: code "${projectDir}"`);
}

export async function runWizard(flags) {
  printBanner();
  p.intro(pc.bgCyan(pc.black(' create-agent-sandbox ')));

  if (flags.check) {
    const report = detectAll();
    p.log.message(summarize(report));
    p.outro('Detection complete.');
    return;
  }

  const initial = detectAll();
  p.log.message(summarize(initial));

  let projectName = flags.projectName;
  if (projectName) {
    const err = validateProjectName(projectName);
    if (err) bail(`Invalid project name "${projectName}": ${err}`);
  } else {
    const v = await p.text({
      message: 'Project name (will be created as ./<name>/)',
      placeholder: 'my-research-project',
      validate: (s) => validateProjectName(String(s).trim()),
    });
    if (p.isCancel(v)) bail('Cancelled.');
    projectName = String(v).trim();
  }
  const projectDir = resolve(process.cwd(), projectName);

  const afterRequired = await ensureRequiredHostDeps(initial, { dryRun: flags.dryRun });
  await ensureDevContainersExt(afterRequired, { dryRun: flags.dryRun });

  const auth = await chooseAuthMode();
  let bedrockEnv = null;
  if (auth === 'bedrock') {
    const existing = loadExistingBedrockEnv();
    const reused = await maybeReuseExistingBedrockEnv(existing);
    bedrockEnv = reused || await gatherBedrockEnv(existing);
    await writeBedrockEnv(bedrockEnv, { dryRun: flags.dryRun });
  }

  const languages = await chooseLanguages();

  const ref = flags.ref || 'main';
  if (flags.dryRun) {
    p.log.info(`[dry-run] would fetch ${REPO}#${ref} into ${projectDir}`);
  } else {
    const s = p.spinner();
    s.start(`Fetching ${REPO}#${ref}...`);
    try {
      const r = fetchTemplate({ targetDir: projectDir, ref });
      s.stop(`Fetched template via ${r.method} into ${r.path}`);
    } catch (err) {
      s.stop(`Failed: ${err.message}`);
      bail(err.message);
    }
  }

  await applyLanguageChoice({ projectDir, languages, dryRun: flags.dryRun });

  await maybeCreateGithubRepo({
    projectDir,
    projectName,
    ghReport: detectAll().gh,
    dryRun: flags.dryRun,
  });

  await maybeLaunchVSCode(projectDir, { dryRun: flags.dryRun });

  p.outro(
    [
      `Done. Next steps:`,
      `  1. Open ${projectDir} in VS Code (if not already open).`,
      `  2. When prompted "Reopen in Container?", click Yes.`,
      `  3. Once the container builds, open a terminal and run: claude`,
      auth === 'max' ? `  4. Inside Claude, run /login and follow the OAuth flow.` : `  4. Verify Bedrock auth: inside Claude, run /model.`,
    ].join('\n')
  );
}
