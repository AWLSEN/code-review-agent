# AI Code Reviewer

An autonomous AI agent that continuously reviews pull requests on open source repositories.

## What it does

1. Claims open source repositories from a pool
2. Clones each repo, understands the codebase structure
3. Monitors for open pull requests
4. Reviews each PR with full context — reads the diff, explores surrounding code, checks cross-file impact
5. Posts a detailed review comment on the PR
6. Moves on to the next repo, claims more when idle
7. Runs forever

## How it works

The agent uses the [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) as its harness, driving the `claude` CLI (Claude Code) in a persistent loop. Each cycle:

- Call a claim API to get assigned repositories
- For each repo: `git clone`, check open PRs, fetch diffs
- For unreviewed PRs: read the diff + surrounding code, analyze for bugs, security, performance, architecture
- Post a review comment via GitHub API
- Report back to the claim API
- Sleep 30 seconds, repeat

The agent maintains state across cycles via session resume. It remembers which PRs it already reviewed and which repos it monitors.

## Review format

Each review comment includes:

- **Summary** — what the PR does
- **Architecture** — how it fits the codebase
- **Issues** — file, severity (critical/warning/suggestion), explanation, fix
- **Cross-file impact** — anything in other files affected
- **Assessment** — approve / request-changes / comment

## Tech stack

- **Agent harness:** [Claude Agent SDK](https://docs.anthropic.com/en/docs/claude-code/sdk) (Python) spawning the [`claude` CLI](https://github.com/anthropics/claude-code)
- **LLM:** Anthropic-compatible endpoint (Anthropic, z.ai GLM, etc.) — swap by pointing `ANTHROPIC_BASE_URL` at a different provider
- **GitHub API:** For reading PRs and posting comments
- **Claim API:** Central coordination so multiple agents don't review the same repos

## Requirements

- Node.js (for `@anthropic-ai/claude-code`)
- Python 3.12+ (for `claude_agent_sdk`)
- GitHub PAT with `public_repo` scope
- An Anthropic-compatible LLM key (Anthropic OAuth, z.ai, etc.)

## Configuration

Set these environment variables:

```bash
GITHUB_TOKEN=ghp_...                            # GitHub PAT for reading PRs and posting comments
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic   # Or https://api.anthropic.com for Anthropic direct
ANTHROPIC_AUTH_TOKEN=...                        # z.ai API key, or use CLAUDE_CODE_OAUTH_TOKEN for Anthropic OAuth
```

## Running

Install the harness:

```bash
npm install -g @anthropic-ai/claude-code
pip install claude_agent_sdk
```

Run the watchdog (which starts and supervises the agent loop):

```bash
./src/watchdog.sh
```

## License

MIT
