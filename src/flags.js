export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = {
    dryRun: false,
    check: false,
    help: false,
    version: false,
    yes: false,
    ref: null,
    projectName: null,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--check') flags.check = true;
    else if (a === '--help' || a === '-h') flags.help = true;
    else if (a === '--version' || a === '-v') flags.version = true;
    else if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--ref') flags.ref = args[++i];
    else if (a.startsWith('--ref=')) flags.ref = a.slice('--ref='.length);
    else if (!a.startsWith('-') && !flags.projectName) flags.projectName = a;
  }
  return flags;
}

export const HELP_TEXT = `
create-agent-sandbox: interactive setup for the DISSC agent-sandbox

USAGE
  npx @yale-dissc/create-agent-sandbox [project-name] [options]

OPTIONS
  --check         Run host detection and exit (no install, no file changes)
  --dry-run       Show every action that would be taken; make no changes
  --ref <git-ref> Pin the agent-sandbox template to a specific tag/branch/SHA
  -y, --yes       Accept default answers (non-interactive); fails if any answer is required
  -h, --help      Show this help
  -v, --version   Show version

DOCS
  https://github.com/DISSC-yale/agent-sandbox
`.trim();
