#!/usr/bin/env python3
"""SessionStart hook: orient Claude with repo state and the previous handoff."""
import json
import os
import subprocess
import sys
import time


def git(cwd, *args):
    try:
        r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True, timeout=10)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    cwd = os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd()
    source = payload.get("source", "startup")
    session_id = payload.get("session_id", "unknown")

    state_dir = os.path.join(cwd, ".git", "hackkit")
    try:
        os.makedirs(state_dir, exist_ok=True)
        if source in ("startup", "clear"):
            with open(os.path.join(state_dir, f"session-{session_id}.start"), "w") as fh:
                fh.write(str(time.time()))
            nudge = os.path.join(state_dir, f"session-{session_id}.nudged")
            if os.path.exists(nudge):
                os.remove(nudge)
    except OSError:
        pass

    if not git(cwd, "rev-parse", "--git-dir"):
        sys.exit(0)

    branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD") or "unknown"
    dirty = len([l for l in git(cwd, "status", "--porcelain").splitlines() if l.strip()])
    recent = git(cwd, "log", "--oneline", "-5") or "no commits yet"

    parts = [
        f"Branch: {branch}",
        f"Uncommitted files: {dirty}",
        "",
        "Recent commits:",
        recent,
    ]

    handoff = os.path.join(cwd, "docs", "HANDOFF.md")
    if os.path.isfile(handoff):
        try:
            with open(handoff) as fh:
                text = "".join(fh.readlines()[:40])
            parts += ["", "Handoff note from the previous session:", text]
        except OSError:
            pass

    parts += [
        "",
        "Workflow for this repo: one feature per session. Build it, run /quality-gate, then "
        "/ship-feature to commit, push, and open a PR. Then /new-session. Pushes to main and "
        "pushes that skip the quality gate are blocked by hooks.",
    ]

    if dirty and source == "startup":
        parts.append(
            "There is uncommitted work in the tree from a previous session. Establish what it is "
            "before starting anything new."
        )

    json.dump({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": "\n".join(parts),
        }
    }, sys.stdout)


if __name__ == "__main__":
    main()
