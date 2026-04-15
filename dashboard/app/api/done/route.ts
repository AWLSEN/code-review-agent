import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = "/opt/review-dashboard/data";
const REPOS_FILE = join(DATA_DIR, "repos.json");

interface RepoEntry {
  repo: string;
  assigned_to: string | null;
  assigned_at: string | null;
  last_checked: string | null;
  total_prs_reviewed: number;
  status: "unclaimed" | "active" | "idle";
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
  writeFileSync(REPOS_FILE, JSON.stringify(data, null, 2));
}

// POST /api/done
// Agent reports: finished checking a repo
// Body: { agent: "ID", repo: "owner/repo", prs_reviewed: 3, has_new_prs: false }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { agent, repo, prs_reviewed, has_new_prs } = body;

    if (!agent || !repo) {
      return NextResponse.json({ error: "agent and repo required" }, { status: 400 });
    }

    const data = loadRepos();
    const entry = data.repos.find(r => r.repo === repo && r.assigned_to === agent);

    if (entry) {
      entry.last_checked = new Date().toISOString();
      entry.total_prs_reviewed += prs_reviewed || 0;

      // If no new PRs, mark as idle (agent can claim a new repo)
      if (!has_new_prs) {
        entry.status = "idle";
      }

      saveRepos(data);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
