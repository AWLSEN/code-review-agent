import { NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const ORB_API = "https://api.orbcloud.dev/v1";
const ORB_KEY = process.env.ORB_API_KEY!;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN!;

// The 10 deployed computers (review@orbcloud.dev org)
const COMPUTER_REPOS: Record<string, string> = {
  "ee6d4af4-bbc8-4a1a-a4b5-61998ef41e1b": "NousResearch/hermes-agent",
  "8efbc7da-6b8e-48cd-8fcf-01bde43e2fd6": "All-Hands-AI/OpenHands",
  "4091a5bb-8d59-4fec-89da-0aa13d29eca0": "langchain-ai/langchain",
  "19220448-931b-483e-80c5-b63ab399072d": "vercel/next.js",
  "e84f2c00-49b4-4acb-8fd8-096c446695b2": "facebook/react",
  "a98a2934-9b8b-4edd-96ac-77b14b78a2df": "nodejs/node",
  "249e1bb1-096e-4514-88e8-c573af9a7109": "fastapi/fastapi",
  "4d21fd91-cd48-4907-ae3d-4bfe73fe1904": "anthropics/anthropic-cookbook",
  "385d6961-78a8-4b6c-8374-c2f51918e5d1": "huggingface/transformers",
  "8a493dc0-db5e-402f-83ca-39ffea5c0d60": "microsoft/autogen",
};

const STARTED_AT = "2026-04-14T22:10:00Z";
const DATA_DIR = "/opt/review-dashboard/data";
const STATS_FILE = join(DATA_DIR, "stats.json");

interface Stats {
  total_samples: number;
  sleeping_samples: number;
  running_samples: number;
  total_reviews: number;
  started_at: string;
}

function loadStats(): Stats {
  try {
    if (existsSync(STATS_FILE)) {
      return JSON.parse(readFileSync(STATS_FILE, "utf-8"));
    }
  } catch {}
  return {
    total_samples: 0,
    sleeping_samples: 0,
    running_samples: 0,
    total_reviews: 0,
    started_at: STARTED_AT,
  };
}

function saveStats(stats: Stats) {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch {}
}

async function orbFetch(path: string) {
  const res = await fetch(`${ORB_API}${path}`, {
    headers: { Authorization: `Bearer ${ORB_KEY}` },
    next: { revalidate: 0 },
  });
  return res.json();
}

async function fetchRecentReviews() {
  const res = await fetch(
    "https://api.github.com/search/issues?q=commenter:nidhishgajjar+%22Orb+Code+Review%22&sort=updated&order=desc&per_page=10",
    {
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
      next: { revalidate: 0 },
    }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).slice(0, 10).map((item: any) => ({
    repo: item.repository_url?.split("/repos/")[1] || "",
    title: item.title,
    number: item.number,
    url: item.html_url,
    updated: item.updated_at,
  }));
}

export async function GET() {
  try {
    const agents: Array<{
      computer_id: string;
      short_id: string;
      repo: string;
      state: string;
    }> = [];

    let running = 0;
    let sleeping = 0;
    let failed = 0;

    for (const [cid, repo] of Object.entries(COMPUTER_REPOS)) {
      try {
        const agentData = await orbFetch(`/computers/${cid}/agents`);
        const agentList = agentData.agents || [];
        const active =
          agentList.find((a: any) => a.state !== "failed") || agentList[0];
        const state = active?.state || "unknown";

        if (state === "running") running++;
        else if (state === "checkpointed") sleeping++;
        else if (state === "failed") failed++;

        agents.push({
          computer_id: cid,
          short_id: cid.slice(0, 8),
          repo,
          state,
        });
      } catch {
        agents.push({
          computer_id: cid,
          short_id: cid.slice(0, 8),
          repo,
          state: "unknown",
        });
      }
    }

    const stats = loadStats();
    stats.total_samples++;
    stats.sleeping_samples += sleeping;
    stats.running_samples += running;
    saveStats(stats);

    const totalAgentSamples = stats.total_samples * 10;
    const sleepingPct =
      totalAgentSamples > 0
        ? Math.round((stats.sleeping_samples / totalAgentSamples) * 100)
        : 0;
    const activePct = 100 - sleepingPct;

    const usage = await orbFetch("/usage");
    const runtimeGbHours = usage.runtime_gb_hours || 0;
    const diskGbHours = usage.disk_gb_hours || 0;
    const costRuntime = runtimeGbHours * 0.005;
    const costDisk = (diskGbHours / 720) * 0.05;
    const totalCost = costRuntime + costDisk;

    const uptimeMs = Date.now() - new Date(STARTED_AT).getTime();
    const uptimeHours = Math.round((uptimeMs / 3600000) * 10) / 10;

    const reviews = await fetchRecentReviews();

    return NextResponse.json({
      agents,
      stats: {
        total: agents.length,
        running,
        sleeping,
        failed,
        sleeping_pct: sleepingPct,
        active_pct: activePct,
        samples: stats.total_samples,
      },
      usage: {
        runtime_gb_hours: Math.round(runtimeGbHours * 100) / 100,
        cost_total: Math.round(totalCost * 100) / 100,
        uptime_hours: uptimeHours,
      },
      reviews,
      started_at: STARTED_AT,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to fetch status" },
      { status: 500 }
    );
  }
}
