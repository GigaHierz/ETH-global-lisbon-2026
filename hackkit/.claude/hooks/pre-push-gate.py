#!/usr/bin/env python3
"""PreToolUse hook: block `git push` unless the quality gate passed for HEAD.

Fails CLOSED. If this script cannot determine that the gate passed, it denies.
Override deliberately with:  OVERRIDE_GATE=1 git push ...
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone


def deny(reason):
    json.dump({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }, sys.stdout)
    sys.exit(0)


def allow():
    sys.exit(0)


def git(project_dir, *args):
    try:
        out = subprocess.run(
            ["git", "-C", project_dir, *args],
            capture_output=True, text=True, timeout=10,
        )
        return out.stdout.strip() if out.returncode == 0 else ""
    except Exception:
        return ""


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        deny("Could not read hook input. The quality gate cannot be verified, so the push is blocked.")

    command = (payload.get("tool_input") or {}).get("command", "")
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or payload.get("cwd") or os.getcwd()
    stamp_dir = os.path.join(project_dir, ".git", "hackkit")

    # Deliberate, logged escape hatch.
    if re.search(r"(^|\s)OVERRIDE_GATE=1(\s|$)", command):
        try:
            os.makedirs(stamp_dir, exist_ok=True)
            with open(os.path.join(stamp_dir, "override.log"), "a") as fh:
                fh.write(f"{datetime.now(timezone.utc).isoformat()}\t{command}\n")
        except OSError:
            pass
        print("Quality gate overridden. Logged to .git/hackkit/override.log", file=sys.stderr)
        allow()

    branch = git(project_dir, "rev-parse", "--abbrev-ref", "HEAD")
    if branch in ("main", "master"):
        deny(
            f"Pushing directly to '{branch}' is blocked. Create a feature branch first:\n"
            "  git checkout -b feat/<short-name>\n"
            "then push that branch and open a PR."
        )

    head = git(project_dir, "rev-parse", "HEAD")
    if not head:
        deny("No commits found on this branch. Commit your work before pushing.")

    pass_file = os.path.join(stamp_dir, "gate-pass")
    if not os.path.isfile(pass_file):
        deny(
            "The quality gate has not run for this commit.\n"
            "Run the /quality-gate skill before pushing.\n"
            "To bypass deliberately: OVERRIDE_GATE=1 git push ..."
        )

    try:
        with open(pass_file) as fh:
            stamped = fh.readline().strip()
    except OSError:
        deny("Could not read the quality gate stamp. Re-run /quality-gate.")

    if stamped != head:
        deny(
            f"The quality gate passed for a different commit.\n"
            f"  gate passed for: {stamped[:12]}\n"
            f"  HEAD is now:     {head[:12]}\n"
            "Re-run /quality-gate so it covers the current commit.\n"
            "To bypass deliberately: OVERRIDE_GATE=1 git push ..."
        )

    allow()


if __name__ == "__main__":
    main()
