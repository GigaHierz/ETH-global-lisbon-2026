#!/usr/bin/env python3
"""Stop hook: surface commit/push/session reminders as context for the next turn.

Never blocks. Never loops.
"""
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


def churn(cwd, *args):
    """Total lines added+removed from a numstat-style diff."""
    total = 0
    for line in git(cwd, *args).splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            for n in parts[:2]:
                if n.isdigit():
                    total += int(n)
    return total


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    cwd = os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd()
    session_id = payload.get("session_id", "unknown")

    if not git(cwd, "rev-parse", "--git-dir"):
        sys.exit(0)

    state_dir = os.path.join(cwd, ".git", "hackkit")
    try:
        os.makedirs(state_dir, exist_ok=True)
    except OSError:
        sys.exit(0)

    notes = []

    branch = git(cwd, "rev-parse", "--abbrev-ref", "HEAD")
    dirty_files = [l for l in git(cwd, "status", "--porcelain").splitlines() if l.strip()]
    dirty = len(dirty_files)
    total_lines = churn(cwd, "diff", "--numstat") + churn(cwd, "diff", "--cached", "--numstat")

    # 1. Working on main
    if branch in ("main", "master") and dirty:
        notes.append(
            f"On branch '{branch}' with {dirty} modified file(s). Pushes from {branch} are blocked. "
            "Move this work onto a feature branch: git checkout -b feat/<name>"
        )

    # 2. Uncommitted work accumulating
    if total_lines > 250:
        notes.append(
            f"{total_lines} uncommitted lines across {dirty} file(s). That exceeds the size of a "
            "single feature. Commit the part that is finished before continuing."
        )
    elif dirty and total_lines > 60:
        notes.append(
            f"{dirty} file(s) modified, {total_lines} lines uncommitted. "
            "If a feature is complete, run /ship-feature."
        )

    # 3. Unpushed commits
    upstream = git(cwd, "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}")
    if upstream:
        ahead = git(cwd, "rev-list", "--count", "@{u}..HEAD")
        if ahead.isdigit() and int(ahead) >= 2:
            notes.append(f"{ahead} commit(s) not pushed. Run /ship-feature to gate and push.")
    elif branch and branch not in ("main", "master"):
        local = git(cwd, "rev-list", "--count", "main..HEAD")
        if local.isdigit() and int(local) >= 2:
            notes.append(
                f"Branch '{branch}' has {local} commit(s) and no remote yet. "
                f"Push it: git push -u origin {branch}"
            )

    # 4. Session length
    start_file = os.path.join(state_dir, f"session-{session_id}.start")
    nudge_file = os.path.join(state_dir, f"session-{session_id}.nudged")
    now = time.time()
    try:
        if not os.path.exists(start_file):
            with open(start_file, "w") as fh:
                fh.write(str(now))
        with open(start_file) as fh:
            started = float(fh.read().strip() or now)
    except (OSError, ValueError):
        started = now

    elapsed = int((now - started) / 60)
    try:
        with open(nudge_file) as fh:
            last = int(fh.read().strip() or 0)
    except (OSError, ValueError):
        last = 0

    for threshold, text in ((90, "quality"), (45, "checkpoint")):
        if elapsed >= threshold > last:
            if text == "quality":
                notes.append(
                    f"This session has been running {elapsed} minutes. Context quality degrades "
                    "past this point. Finish the current feature, ship it, run /new-session, "
                    "and start fresh."
                )
            else:
                notes.append(
                    f"Session at {elapsed} minutes. Good point to ship what is done and start a "
                    "clean session for the next feature."
                )
            try:
                with open(nudge_file, "w") as fh:
                    fh.write(str(threshold))
            except OSError:
                pass
            break

    # 5. Gate stamp stale
    head = git(cwd, "rev-parse", "HEAD")
    pass_file = os.path.join(state_dir, "gate-pass")
    if head and os.path.isfile(pass_file):
        try:
            with open(pass_file) as fh:
                stamped = fh.readline().strip()
            if stamped != head:
                notes.append(
                    "There are new commits since the last quality gate run. "
                    "Re-run /quality-gate before pushing."
                )
        except OSError:
            pass

    if not notes:
        sys.exit(0)

    json.dump({
        "hookSpecificOutput": {
            "hookEventName": "Stop",
            "additionalContext": "Repository state:\n" + "\n".join(f"- {n}" for n in notes),
        }
    }, sys.stdout)


if __name__ == "__main__":
    main()
