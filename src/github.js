import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

function run(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'inherit' });
}

function runQuiet(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf8' });
}

export function initGit(workspacePath) {
  const cwd = resolve(workspacePath);
  if (runQuiet('git', ['rev-parse', '--git-dir'], cwd).status === 0) {
    return { initialized: false, alreadyRepo: true };
  }
  if (run('git', ['init', '-b', 'main'], cwd).status !== 0) {
    return { initialized: false, error: 'git init failed' };
  }
  run('git', ['add', '.'], cwd);
  run('git', ['commit', '-m', 'Initial commit from agent-sandbox'], cwd);
  return { initialized: true, alreadyRepo: false };
}

export function createGithubRepo({ workspacePath, name, visibility = 'private', push = true }) {
  const cwd = resolve(workspacePath);
  const args = ['repo', 'create', name, `--${visibility}`, '--source=.'];
  if (push) args.push('--push');
  const result = run('gh', args, cwd);
  return { ok: result.status === 0 };
}

export function manualInstructions({ name }) {
  return [
    `# To push this project to GitHub manually:`,
    `gh repo create ${name} --private --source=. --push`,
    `# or, without gh:`,
    `git remote add origin https://github.com/<your-user-or-org>/${name}.git`,
    `git push -u origin main`,
  ].join('\n');
}
