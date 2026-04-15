import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = "/opt/review-dashboard/data";
const REPOS_FILE = join(DATA_DIR, "repos.json");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;

interface RepoEntry {
  repo: string;
  assigned_to: string | null;
  assigned_at: string | null;
  last_checked: string | null;
  total_prs_reviewed: number;
  status: "unclaimed" | "active" | "idle"; // idle = all PRs reviewed, watching
}

interface ReposData {
  repos: RepoEntry[];
  last_discovery: string | null;
}

function loadRepos(): ReposData {
  try {
    if (existsSync(REPOS_FILE)) {
      return JSON.parse(readFileSync(REPOS_FILE, "utf-8"));
    }
  } catch {}
  return { repos: [], last_discovery: null };
}

function saveRepos(data: ReposData) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(REPOS_FILE, JSON.stringify(data, null, 2));
}

// Seed with handpicked 100
const SEED_REPOS = [
  "NousResearch/hermes-agent","All-Hands-AI/OpenHands","langchain-ai/langchain",
  "vercel/next.js","facebook/react","nodejs/node","fastapi/fastapi",
  "anthropics/anthropic-cookbook","huggingface/transformers","microsoft/autogen",
  "vllm-project/vllm","langchain-ai/langgraph","agno-agi/agno",
  "Significant-Gravitas/AutoGPT","PrefectHQ/fastmcp","kyegomez/swarms",
  "Skyvern-AI/skyvern","getzep/graphiti","sgl-project/sglang",
  "unslothai/unsloth","llamastack/llama-stack","Comfy-Org/ComfyUI",
  "langflow-ai/langflow","chroma-core/chroma","ollama/ollama",
  "openai/codex","huggingface/lerobot","vercel/ai","astral-sh/ruff",
  "zed-industries/zed","biomejs/biome","google-gemini/gemini-cli",
  "promptfoo/promptfoo","microsoft/vscode","cypress-io/cypress",
  "directus/directus","twentyhq/twenty","actualbudget/actual",
  "RocketChat/Rocket.Chat","streamlit/streamlit","apache/airflow",
  "dagster-io/dagster","PrefectHQ/prefect","grafana/grafana",
  "elastic/kibana","PostHog/posthog","getsentry/sentry",
  "temporalio/temporal","dolthub/dolt","vitessio/vitess",
  "hashicorp/terraform-provider-aws","tailscale/tailscale",
  "AdguardTeam/AdGuardHome","home-assistant/core","kubescape/kubescape",
  "pytorch/pytorch","numpy/numpy","jax-ml/jax","tinygrad/tinygrad",
  "goauthentik/authentik","servo/servo","bytecodealliance/wasmtime",
  "uutils/coreutils","clockworklabs/SpacetimeDB","paradedb/paradedb",
  "onyx-dot-app/onyx","OpenBB-finance/OpenBB","paperless-ngx/paperless-ngx",
  "zulip/zulip","arc53/DocsGPT","mattermost/mattermost",
  "element-hq/element-web","instantdb/instant","slint-ui/slint",
  "jaegertracing/jaeger","CopilotKit/CopilotKit","mastra-ai/mastra",
  "elizaOS/eliza","aaif-goose/goose","aptos-labs/aptos-core",
  "MystenLabs/sui","ethereum-optimism/optimism","ray-project/ray",
  "apache/spark","docker/compose","kubernetes/kubernetes",
  "prometheus/prometheus","istio/istio","traefik/traefik",
  "minio/minio","cockroachdb/cockroach","tikv/tikv",
  "pingcap/tidb","dagger/dagger","pulumi/pulumi",
  "supabase/supabase","appwrite/appwrite","nhost/nhost",
  "pocketbase/pocketbase","directus/directus","strapi/strapi",
  "payloadcms/payload","medusajs/medusa","calcom/cal.com",
  "n8n-io/n8n","activepieces/activepieces","windmill-labs/windmill",
];

function ensureSeeded(data: ReposData): ReposData {
  const existing = new Set(data.repos.map(r => r.repo));
  for (const repo of SEED_REPOS) {
    if (!existing.has(repo)) {
      data.repos.push({
        repo,
        assigned_to: null,
        assigned_at: null,
        last_checked: null,
        total_prs_reviewed: 0,
        status: "unclaimed",
      });
    }
  }
  return data;
}

// Auto-discovery: find popular repos with active PRs
async function discoverRepos(data: ReposData): Promise<number> {
  const now = new Date();
  const lastDisc = data.last_discovery ? new Date(data.last_discovery) : null;

  // Only discover once per hour
  if (lastDisc && now.getTime() - lastDisc.getTime() < 3600000) {
    return 0;
  }

  const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const existing = new Set(data.repos.map(r => r.repo));
  let added = 0;

  // Search for active repos with PRs
  for (const lang of ["python", "typescript", "rust", "go"]) {
    try {
      const res = await fetch(
        `https://api.github.com/search/repositories?q=stars:>3000+language:${lang}+pushed:>${weekAgo}&sort=updated&per_page=20`,
        {
          headers: {
            Authorization: `token ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github.v3+json",
          },
        }
      );
      if (!res.ok) continue;
      const result = await res.json();
      for (const item of result.items || []) {
        const repo = item.full_name;
        if (!existing.has(repo) && item.open_issues_count > 5) {
          data.repos.push({
            repo,
            assigned_to: null,
            assigned_at: null,
            last_checked: null,
            total_prs_reviewed: 0,
            status: "unclaimed",
          });
          existing.add(repo);
          added++;
        }
      }
    } catch {}
  }

  data.last_discovery = now.toISOString();
  return added;
}

// GET /api/claim?agent=COMPUTER_ID
// Returns a repo for the agent to work on
export async function GET(req: NextRequest) {
  const agent = req.nextUrl.searchParams.get("agent");
  if (!agent) {
    return NextResponse.json({ error: "agent param required" }, { status: 400 });
  }

  let data = loadRepos();
  data = ensureSeeded(data);

  // Auto-discover new repos
  const discovered = await discoverRepos(data);

  // Get agent's current repos
  const agentRepos = data.repos.filter(r => r.assigned_to === agent);

  // Check if agent has any active (not idle) repos - if so, return those
  const activeRepos = agentRepos.filter(r => r.status === "active");
  if (activeRepos.length > 0) {
    saveRepos(data);
    return NextResponse.json({
      action: "review",
      repos: agentRepos.map(r => r.repo),
      discovered,
    });
  }

  // All agent's repos are idle (fully reviewed). Claim a new one.
  const unclaimed = data.repos.find(r => r.status === "unclaimed");
  if (unclaimed) {
    unclaimed.assigned_to = agent;
    unclaimed.assigned_at = new Date().toISOString();
    unclaimed.status = "active";
    saveRepos(data);
    return NextResponse.json({
      action: "review",
      repos: [...agentRepos.map(r => r.repo), unclaimed.repo],
      new_repo: unclaimed.repo,
      discovered,
    });
  }

  // No unclaimed repos left - just keep monitoring existing ones
  saveRepos(data);
  return NextResponse.json({
    action: "monitor",
    repos: agentRepos.map(r => r.repo),
    discovered,
  });
}
