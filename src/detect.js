import { execSync, spawnSync } from 'node:child_process';
import { platform } from 'node:os';

const PLATFORM = platform();
export const IS_MAC = PLATFORM === 'darwin';
export const IS_WINDOWS = PLATFORM === 'win32';
export const IS_LINUX = PLATFORM === 'linux';

// On Windows, many CLIs we probe (code, gh, git, docker) are .cmd/.bat shims,
// which Node's spawnSync cannot execute directly without shell: true. Arguments
// here are hard-coded so shell: true does not introduce an injection risk.
const SPAWN_OPTS = { encoding: 'utf8', timeout: 5000, shell: IS_WINDOWS };

function which(cmd) {
  const probe = IS_WINDOWS ? 'where' : 'which';
  const result = spawnSync(probe, [cmd], SPAWN_OPTS);
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/)[0].trim() || null;
}

function tryVersion(cmd, args = ['--version']) {
  const result = spawnSync(cmd, args, SPAWN_OPTS);
  if (result.status !== 0) return null;
  const first = (result.stdout || result.stderr).trim().split(/\r?\n/)[0];
  const match = first.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : first;
}

function detectGit() {
  const path = which('git');
  if (!path) return { installed: false };
  return { installed: true, path, version: tryVersion('git') };
}

function detectDocker() {
  const path = which('docker');
  if (!path) return { installed: false, running: false };
  const version = tryVersion('docker');
  // `docker info` blocks waiting for the daemon when Docker Desktop is not
  // running, so cap it tightly.
  const info = spawnSync('docker', ['info'], { ...SPAWN_OPTS, timeout: 3000 });
  const running = info.status === 0;
  return { installed: true, running, path, version };
}

function detectVSCode() {
  const path = which('code');
  if (!path) return { installed: false, onPath: false };
  return { installed: true, onPath: true, path, version: tryVersion('code') };
}

function detectDevContainersExt() {
  if (!which('code')) return { installed: false };
  const result = spawnSync('code', ['--list-extensions'], SPAWN_OPTS);
  if (result.status !== 0) return { installed: false, error: result.stderr?.trim() };
  const lines = result.stdout.split(/\r?\n/).map((l) => l.trim().toLowerCase());
  return { installed: lines.includes('ms-vscode-remote.remote-containers') };
}

function detectGh() {
  const path = which('gh');
  if (!path) return { installed: false, authed: false };
  const version = tryVersion('gh');
  const auth = spawnSync('gh', ['auth', 'status'], SPAWN_OPTS);
  const authed = auth.status === 0;
  let user = null;
  if (authed) {
    const match = (auth.stderr || auth.stdout).match(/account\s+(\S+)/i) ||
                  (auth.stderr || auth.stdout).match(/Logged in to \S+ as (\S+)/);
    if (match) user = match[1];
  }
  return { installed: true, authed, user, path, version };
}

function detectNode() {
  return { installed: true, version: process.version };
}

function detectHomebrew() {
  if (!IS_MAC) return { applicable: false };
  const path = which('brew');
  return { applicable: true, installed: !!path, path };
}

function detectWinget() {
  if (!IS_WINDOWS) return { applicable: false };
  const path = which('winget');
  return { applicable: true, installed: !!path, path };
}

export function detectAll() {
  return {
    platform: PLATFORM,
    node: detectNode(),
    git: detectGit(),
    docker: detectDocker(),
    vscode: detectVSCode(),
    devContainersExt: detectDevContainersExt(),
    gh: detectGh(),
    homebrew: detectHomebrew(),
    winget: detectWinget(),
  };
}

export function summarize(report) {
  const lines = [];
  const mark = (ok) => (ok ? '✓' : '✗');
  lines.push(`${mark(true)} Node.js ${report.node.version}`);
  lines.push(`${mark(report.git.installed)} Git${report.git.installed ? ` ${report.git.version || ''}` : ': not found'}`);
  if (report.docker.installed) {
    lines.push(`${mark(report.docker.running)} Docker${report.docker.running ? ' (running)' : ' (installed but not running)'}`);
  } else {
    lines.push(`${mark(false)} Docker Desktop: not found`);
  }
  if (report.vscode.installed) {
    lines.push(`${mark(true)} VS Code ${report.vscode.version || ''}`);
    lines.push(`${mark(report.devContainersExt.installed)} Dev Containers extension${report.devContainersExt.installed ? '' : ': not installed'}`);
  } else {
    lines.push(`${mark(false)} VS Code: not found${IS_MAC ? " (or 'code' command not on PATH)" : ''}`);
  }
  if (report.gh.installed) {
    const status = report.gh.authed
      ? `(authed${report.gh.user ? ` as ${report.gh.user}` : ''})`
      : '(not authed; optional)';
    lines.push(`${mark(true)} GitHub CLI ${report.gh.version || ''} ${status}`);
  } else {
    lines.push(`○ GitHub CLI: not installed (optional)`);
  }
  return lines.join('\n');
}
