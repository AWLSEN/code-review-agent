import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const REPOS_FILE = join("/opt/review-dashboard/data", "repos.json");

export async function GET() {
  try {
    if (!existsSync(REPOS_FILE)) {
      return NextResponse.json({ total: 0, claimed: 0, unclaimed: 0, repos: [] });
    }

    const data = JSON.parse(readFileSync(REPOS_FILE, "utf-8"));
    const repos = data.repos || [];

    const claimed = repos.filter((r: any) => r.assigned_to).length;
    const unclaimed = repos.filter((r: any) => !r.assigned_to).length;
    const active = repos.filter((r: any) => r.status === "active").length;
    const idle = repos.filter((r: any) => r.status === "idle").length;
    const totalReviewed = repos.reduce((sum: number, r: any) => sum + (r.total_prs_reviewed || 0), 0);

    // Group by agent
    const byAgent: Record<string, string[]> = {};
    for (const r of repos) {
      if (r.assigned_to) {
        if (!byAgent[r.assigned_to]) byAgent[r.assigned_to] = [];
        byAgent[r.assigned_to].push(r.repo);
      }
    }

    return NextResponse.json({
      total: repos.length,
      claimed,
      unclaimed,
      active,
      idle,
      total_prs_reviewed: totalReviewed,
      by_agent: byAgent,
      last_discovery: data.last_discovery,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
