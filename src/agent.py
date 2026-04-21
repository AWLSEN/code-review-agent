#!/usr/bin/env python3
"""
Code Review Agent -- runs forever on Orb Cloud.
Uses Claude Agent SDK.

Design notes:
- Repo list comes from the claim API, fetched in Python each cycle, and
  substituted into the prompt as facts (not instructions). This blocks
  the model from hallucinating repos.
- Always starts a fresh SDK session per cycle. Resume was causing the
  model to re-review PRs from previous cycles.
- reviewed_prs.txt is deduped (`sort -u`) at the start of every cycle.
"""

import asyncio
import json
import os
import subprocess
import time
import traceback
import urllib.request
from pathlib import Path
from claude_agent_sdk import (
    query, ClaudeAgentOptions,
    AssistantMessage, ResultMessage, SystemMessage,
    TextBlock, ToolUseBlock,
)

DATA_DIR = Path("/root/data")
LOGS_DIR = DATA_DIR / "logs"
PROMPT_FILE = Path("/root/src/agent-prompt.md")
REVIEWED_FILE = DATA_DIR / "reviewed_prs.txt"

AGENT_ID = os.environ.get("ORB_COMPUTER_ID", "unknown")
AGENT_INDEX = os.environ.get("AGENT_INDEX", "0")
AGENT_TOTAL = os.environ.get("AGENT_TOTAL", "1")
CLAIM_API = "https://claim-api-five.vercel.app/api/claim"

LOGS_DIR.mkdir(parents=True, exist_ok=True)
(DATA_DIR / "repos").mkdir(parents=True, exist_ok=True)


def log(msg):
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [agent] {msg}"
    print(line, flush=True)
    with open(LOGS_DIR / "agent.log", "a") as f:
        f.write(line + "\n")


def fetch_assigned_repos():
    """Call the claim API and return the authoritative repo list for this agent."""
    url = f"{CLAIM_API}?agent={AGENT_ID}&idx={AGENT_INDEX}&total={AGENT_TOTAL}"
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            data = json.loads(resp.read().decode())
        repos = data.get("repos", [])
        if not repos:
            raise RuntimeError(f"claim API returned no repos: {data}")
        return repos
    except Exception as e:
        log(f"claim API fetch failed: {e}")
        raise


def dedupe_reviewed_prs():
    """sort -u the reviewed_prs.txt to drop duplicate entries."""
    if not REVIEWED_FILE.exists():
        return 0
    try:
        subprocess.run(
            ["sort", "-u", "-o", str(REVIEWED_FILE), str(REVIEWED_FILE)],
            check=True,
        )
        lines = REVIEWED_FILE.read_text().splitlines()
        return len([l for l in lines if l.strip()])
    except Exception as e:
        log(f"dedupe failed: {e}")
        return 0


def build_prompt(repos, reviewed_count, run_num):
    """Inject the authoritative repo list into the prompt template as facts."""
    template = PROMPT_FILE.read_text()
    repo_block = "\n".join(f"- {r}" for r in repos)
    return (
        f"You are a code review agent. Run #{run_num}. Agent ID: {AGENT_ID}. "
        f"You have reviewed {reviewed_count} PRs so far.\n\n"
        f"YOUR ASSIGNED REPOS (authoritative — do not review anything not in this list):\n"
        f"{repo_block}\n\n"
        f"{template}"
    )


async def run_agent():
    run_num = 0

    while True:
        run_num += 1
        try:
            reviewed_count = dedupe_reviewed_prs()
            log(f"=== RUN #{run_num} | reviewed_prs: {reviewed_count} | Agent: {AGENT_ID} idx={AGENT_INDEX}/{AGENT_TOTAL} ===")

            repos = fetch_assigned_repos()
            log(f"Assigned repos: {', '.join(repos)}")

            prompt = build_prompt(repos, reviewed_count, run_num)

            options = ClaudeAgentOptions(
                allowed_tools=[
                    "Bash", "Edit", "Read", "Write", "Glob", "Grep",
                    "WebFetch", "WebSearch"
                ],
                permission_mode="bypassPermissions",
                model="claude-sonnet-4-20250514",
                system_prompt=(
                    "You are a code review agent running on Orb Cloud. "
                    "Your assigned repos are given to you at the start of each cycle. "
                    "NEVER review a PR whose repo is not in that list. "
                    "NEVER invent repo names. "
                    "NEVER mark a PR as reviewed in reviewed_prs.txt unless the GitHub POST returned 201."
                ),
                cwd=str(DATA_DIR),
            )

            log("Starting FRESH session...")
            log_file = LOGS_DIR / f"run_{run_num}.log"
            msg_count = 0
            with open(log_file, "a") as lf:
                async for message in query(prompt=prompt, options=options):
                    msg_count += 1
                    lf.write(f"[msg#{msg_count}] {type(message).__name__}: {repr(message)[:500]}\n")
                    lf.flush()
                    if msg_count <= 5:
                        log(f"msg#{msg_count} type={type(message).__name__}")
                    if isinstance(message, ResultMessage):
                        log(f"Run complete. Session: {message.session_id}, "
                            f"Turns: {message.num_turns}, "
                            f"Cost: ${message.total_cost_usd or 0:.2f}")
                    elif isinstance(message, AssistantMessage):
                        for block in message.content:
                            if isinstance(block, ToolUseBlock):
                                lf.write(f"[tool] {block.name}: {repr(block.input)[:150]}\n")
                                lf.flush()

        except KeyboardInterrupt:
            log("Interrupted")
            raise
        except Exception as e:
            log(f"Error: {e}")
            traceback.print_exc()

        log(f"Run #{run_num} ended. Restarting in 5s...")
        await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(run_agent())
