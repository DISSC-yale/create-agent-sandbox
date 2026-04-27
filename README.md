# create-agent-sandbox

Interactive setup wizard for the [DISSC agent-sandbox](https://github.com/DISSC-yale/agent-sandbox), a secure, sandboxed Docker container for running Claude Code (and other coding agents) on faculty research workloads.

The wizard checks your machine for the required tools, opens install pages for anything missing, scaffolds a new sandbox project, configures your Claude authentication mode, and (optionally) initializes git and pushes to GitHub.

```
npm create @yale-dissc/agent-sandbox@latest my-research-project
```

> Requires Node.js 18+. No global install needed; `npx` / `npm create` runs the latest version on demand.

## What it does

1. **Detects** Git, Docker (installed *and* running), VS Code, the Dev Containers extension, and the GitHub CLI on your machine.
2. **Opens install pages** in your browser for anything missing, so you install via the official download (no auto-install of system software).
3. **Asks for a project name** and copies the [`agent-sandbox`](https://github.com/DISSC-yale/agent-sandbox) template into `./<name>/`.
4. **Asks how you want to authenticate Claude:**
   - **Anthropic via Claude.ai** (Pro/Max subscription): nothing to configure, you'll `/login` inside the container.
   - **Anthropic via AWS Bedrock**: collects your region, bearer token, and default Opus model, then writes them to `~/.zprofile` (macOS) or to User-scope environment variables (Windows). **Always backs up your existing config first** with a timestamped copy.
5. **Asks which languages to pre-install** in the container: Python 3, R + tidyverse, both, or neither. Edits the fetched `Dockerfile` accordingly.
6. **Initializes git** in the project's `workspace/` folder and (optionally) creates and pushes a GitHub repo via `gh`.
7. **Launches VS Code** on the project so you can click "Reopen in Container".

## Usage

```bash
# Interactive setup (recommended)
npm create @yale-dissc/agent-sandbox@latest my-project

# Just check what's installed on your machine; change nothing
npx @yale-dissc/create-agent-sandbox --check

# Show every action that would be taken without making changes
npx @yale-dissc/create-agent-sandbox my-project --dry-run

# Pin to a specific tagged release of the agent-sandbox template
npx @yale-dissc/create-agent-sandbox my-project --ref v1.0.0
```

### Flags

| Flag | Effect |
|---|---|
| `--check` | Run host detection and exit. Makes no changes. |
| `--dry-run` | Show every action that would be taken; make no changes. |
| `--ref <git-ref>` | Pin the `agent-sandbox` template to a specific tag, branch, or commit. |
| `-y, --yes` | Accept defaults non-interactively (fails if any required answer is missing). |
| `-h, --help` | Show help. |
| `-v, --version` | Show version. |

## Safety guarantees

This tool is built for a faculty audience running research workloads. It is conservative about touching your system:

- **Never installs system software automatically.** When a dependency is missing, the wizard prints a clickable install link and waits for you to install it through the official channel.
- **Always backs up before modifying shell config.** On macOS, `~/.zprofile` is copied to `~/.zprofile.backup-YYYYMMDD-HHMMSS` before any append. On Windows, the existing User-scope env var values are snapshotted to a JSON file in `%USERPROFILE%\.agent-sandbox\backups\` before any change.
- **Sentinel-marked blocks.** Bedrock config added to `~/.zprofile` is wrapped in `# >>> agent-sandbox bedrock config >>>` / `# <<< ... <<<` markers so future runs can find and update the block in place rather than appending duplicates.
- **Diff preview before write.** You see the exact lines (with the bearer token masked) and confirm `Y` before anything is written.
- **Revert one-liner printed.** Every write step prints the command to undo itself.
- **`--dry-run` for IT review.** Faculty IT departments can run the wizard end to end with `--dry-run` to audit every action before approving it.

## Bedrock environment variables

When you choose AWS Bedrock authentication, the wizard sets these four variables:

```bash
export CLAUDE_CODE_USE_BEDROCK=1
export AWS_REGION=us-east-1
export AWS_BEARER_TOKEN_BEDROCK=<your-token>
export ANTHROPIC_DEFAULT_OPUS_MODEL=us.anthropic.claude-opus-4-6-v1
```

These are read by the dev container at startup (see [`agent-sandbox/.devcontainer/devcontainer.json`](https://github.com/DISSC-yale/agent-sandbox/blob/main/.devcontainer/devcontainer.json)). They live on your *host* machine, not in the container or the repo, and never leave your machine.

## Language selection

The default sandbox `Dockerfile` installs Python 3 and R + tidyverse, which adds 20-40 minutes to the first build. The wizard's language prompt lets you remove either or both:

| Selection | First build time |
|---|---|
| Neither (Node only) | ~2-5 min |
| Python only | ~5-10 min |
| R only | ~15-30 min |
| Python + R (default upstream) | ~20-40 min |

The locale configuration (`en_US.UTF-8`) stays regardless; it's needed for any workload handling non-ASCII text.

## Troubleshooting

**"Docker is installed but not running."** Open Docker Desktop manually, wait for the whale icon to stop animating, then re-run the wizard or press Enter to retry.

**"`code` command not found" on macOS.** Open VS Code, press `Cmd+Shift+P`, type "shell command", select **Shell Command: Install 'code' command in PATH**, then re-run the wizard.

**The wizard wrote to `~/.zprofile` but my shell still doesn't see the variables.** `~/.zprofile` is loaded only by login shells. Open a new terminal window (not just a new tab) or run `source ~/.zprofile`.

**I want to remove the Bedrock config the wizard added.** On macOS: `mv ~/.zprofile.backup-<timestamp> ~/.zprofile`. On Windows: re-import the snapshot JSON via the revert one-liner the wizard printed.

**Hyperlinks in the terminal aren't clickable.** Most modern terminals (macOS Terminal, iTerm2, Windows Terminal, VS Code's integrated terminal) auto-detect them. For older terminals, copy the URL shown in parentheses after the label.
