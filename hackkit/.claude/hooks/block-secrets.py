#!/usr/bin/env python3
"""PreToolUse hook: stop Claude reading, writing, or printing secret files."""
import json
import re
import sys

SECRET_PATH = re.compile(
    r"(^|/)\.env($|\.[A-Za-z0-9_-]+$)"
    r"|(^|/)(id_rsa|id_ecdsa|id_ed25519)$"
    r"|\.pem$|\.p12$|\.keystore$"
    r"|(^|/)secrets?\.(json|ya?ml|toml)$"
    r"|(^|/)\.hedera/",
    re.IGNORECASE,
)

PRINT_ENV = re.compile(
    r"\b(cat|less|more|head|tail|bat|strings|xxd|od|type)\b[^|;&]*\.env", re.IGNORECASE
)
STAGE_SECRET = re.compile(
    r"\bgit\s+add\b[^|;&]*(\.env|\.pem|id_rsa|id_ecdsa)", re.IGNORECASE
)


def deny(reason):
    json.dump({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }, sys.stdout)
    sys.exit(0)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        sys.exit(0)  # malformed input: let normal permission flow handle it

    tool = payload.get("tool_name", "")
    ti = payload.get("tool_input") or {}

    if tool in ("Read", "Edit", "Write", "NotebookEdit"):
        path = ti.get("file_path") or ti.get("notebook_path") or ""
        if path and SECRET_PATH.search(path):
            deny(
                f"Blocked: '{path}' holds credentials.\n"
                "Claude does not read or write secret files. Edit it yourself in a normal editor.\n"
                "Document the required variables in .env.example instead."
            )

    elif tool == "Bash":
        cmd = ti.get("command", "")
        if PRINT_ENV.search(cmd):
            deny(
                "Blocked: that command would print the contents of a secret file.\n"
                "To check whether a variable is set without revealing it:\n"
                '  [ -n "$VAR_NAME" ] && echo set || echo missing'
            )
        if STAGE_SECRET.search(cmd):
            deny("Blocked: never stage secret files. Confirm .env is listed in .gitignore.")

    sys.exit(0)


if __name__ == "__main__":
    main()
