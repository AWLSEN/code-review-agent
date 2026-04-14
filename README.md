# Orb Code Reviewer

AI code review agents that sleep when idle and wake when PRs arrive.

Each agent is assigned to one open source repository. It monitors for open pull requests, reviews the code, and posts comments. When there's nothing to review, it checkpoints to disk and costs nothing.

**Live dashboard:** [review.orbcloud.dev](https://review.orbcloud.dev)

## How it works

```
1. PR opened on github.com/facebook/react
2. Agent wakes from checkpoint (~1s)
3. Fetches diff, reviews code using GLM 5.1
4. Posts review comment on the PR
5. Checks for more PRs
6. No more work? Goes back to sleep. Zero cost.
```

Each agent runs on [Orb Cloud](https://orbcloud.dev) as a persistent, stateful process. Orb checkpoints the entire process to NVMe when idle and restores it on demand.

## Architecture

- **Runtime:** [OpenHands](https://github.com/All-Hands-AI/OpenHands) CLI in headless mode
- **LLM:** GLM 5.1 via [Zhipu Coding Plan](https://docs.z.ai/devpack/tool/claude) (Anthropic-compatible API)
- **Infrastructure:** [Orb Cloud](https://orbcloud.dev) - process-level checkpoint/restore
- **Deployment:** One Orb computer per repo, 10 repos

## Cost

| 10 agents | Monthly |
|-----------|---------|
| Orb compute (5% active) | ~$7 |
| Orb disk | ~$0.10 |
| GLM 5.1 API | ~$3 |
| **Total** | **~$10/mo** |

Sleeping agents cost $0 compute. You only pay when they're reviewing.

## Deploy your own

```bash
# Clone
git clone https://github.com/awlsen/code-review-agent
cd code-review-agent

# Configure
cp .env.example .env
# Edit .env with your keys

# Deploy 10 agents
python3 scripts/deploy.py

# Or deploy for one repo
python3 scripts/deploy.py your-org/your-repo
```

## Configuration

Create a `.env` file:

```bash
GITHUB_TOKEN=ghp_...          # GitHub PAT with public_repo scope
GLM_API_KEY=your-key.here     # Zhipu GLM Coding Plan API key
ORB_API_KEY=orb_...           # Orb Cloud API key
ORB_API_URL=https://api.orbcloud.dev/v1
```

## Monitored repos

| Repo | Status |
|------|--------|
| NousResearch/hermes-agent | Active |
| All-Hands-AI/OpenHands | Active |
| langchain-ai/langchain | Active |
| vercel/next.js | Active |
| facebook/react | Active |
| nodejs/node | Active |
| fastapi/fastapi | Active |
| anthropics/anthropic-cookbook | Active |
| huggingface/transformers | Active |
| microsoft/autogen | Active |

## License

MIT
