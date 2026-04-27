import { spawnSync } from 'node:child_process';
import { IS_MAC, IS_WINDOWS } from './detect.js';

const OSC8 = '\x1b]8;;';
const ST = '\x1b\\';

export function hyperlink(url, label = url) {
  if (process.env.NO_HYPERLINKS || !process.stdout.isTTY) return `${label} (${url})`;
  return `${OSC8}${url}${ST}${label}${OSC8}${ST}`;
}

export const INSTALL_URLS = {
  docker: {
    macos: 'https://www.docker.com/products/docker-desktop/',
    windows: 'https://www.docker.com/products/docker-desktop/',
    label: 'Docker Desktop',
  },
  vscode: {
    macos: 'https://code.visualstudio.com/download',
    windows: 'https://code.visualstudio.com/download',
    label: 'Visual Studio Code',
  },
  git: {
    macos: 'https://git-scm.com/download/mac',
    windows: 'https://git-scm.com/download/win',
    label: 'Git',
  },
  gh: {
    macos: 'https://cli.github.com/',
    windows: 'https://cli.github.com/',
    label: 'GitHub CLI (optional)',
  },
  devContainersExt: {
    macos: 'vscode:extension/ms-vscode-remote.remote-containers',
    windows: 'vscode:extension/ms-vscode-remote.remote-containers',
    label: 'Dev Containers extension',
  },
};

export function urlFor(key) {
  const entry = INSTALL_URLS[key];
  if (!entry) return null;
  if (IS_MAC) return entry.macos;
  if (IS_WINDOWS) return entry.windows;
  return entry.macos;
}

export function installInstruction(key) {
  const entry = INSTALL_URLS[key];
  if (!entry) return null;
  const url = urlFor(key);
  return {
    label: entry.label,
    url,
    clickable: hyperlink(url, entry.label),
  };
}

export function tryOpenInBrowser(url) {
  if (IS_MAC) return spawnSync('open', [url], { stdio: 'ignore' }).status === 0;
  if (IS_WINDOWS) return spawnSync('cmd', ['/c', 'start', '', url], { stdio: 'ignore' }).status === 0;
  return spawnSync('xdg-open', [url], { stdio: 'ignore' }).status === 0;
}

export function tryStartDocker() {
  if (IS_MAC) return spawnSync('open', ['-a', 'Docker'], { stdio: 'ignore' }).status === 0;
  if (IS_WINDOWS) {
    return spawnSync('cmd', ['/c', 'start', '', 'Docker Desktop.exe'], { stdio: 'ignore' }).status === 0;
  }
  return false;
}
