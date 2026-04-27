import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = 'DISSC-yale/agent-sandbox';
const DEFAULT_REF = 'main';

function hasNpx() {
  return spawnSync('npx', ['--version'], { encoding: 'utf8' }).status === 0;
}

function hasGit() {
  return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0;
}

function fetchWithDegit(targetDir, ref) {
  const source = `${REPO}${ref ? `#${ref}` : ''}`;
  const result = spawnSync('npx', ['--yes', 'degit', source, targetDir, '--force'], {
    encoding: 'utf8',
    stdio: 'inherit',
  });
  return result.status === 0;
}

function fetchWithGitClone(targetDir, ref) {
  const args = ['clone', '--depth', '1'];
  if (ref) args.push('--branch', ref);
  args.push(`https://github.com/${REPO}.git`, targetDir);
  const result = spawnSync('git', args, { encoding: 'utf8', stdio: 'inherit' });
  if (result.status !== 0) return false;
  rmSync(resolve(targetDir, '.git'), { recursive: true, force: true });
  return true;
}

export function fetchTemplate({ targetDir, ref = DEFAULT_REF, allowOverwrite = false }) {
  const absolute = resolve(targetDir);
  if (existsSync(absolute) && readdirSync(absolute).length > 0 && !allowOverwrite) {
    throw new Error(`Target directory ${absolute} already exists and is not empty. Pass allowOverwrite to proceed.`);
  }

  if (hasNpx() && fetchWithDegit(absolute, ref)) {
    return { method: 'degit', path: absolute, ref };
  }
  if (hasGit() && fetchWithGitClone(absolute, ref)) {
    return { method: 'git', path: absolute, ref };
  }
  throw new Error('Could not fetch template. Neither degit (via npx) nor git clone succeeded.');
}

export { REPO, DEFAULT_REF };
