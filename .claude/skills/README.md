# Superpowers skills (vendored)

These are the **Superpowers** workflow skills, vendored into this repository so every
teammate and every fresh workspace gets them without depending on anyone's personal
global Claude Code config.

- **Upstream:** [`obra/superpowers`](https://github.com/obra/superpowers) by Jesse Vincent
- **License:** MIT (see [`LICENSE-superpowers`](./LICENSE-superpowers))
- **Snapshot taken:** 2026-07-25
- **Note:** these are the maintainer's actively-used copies, which include small local
  customizations, so they may differ from any given upstream release tag.

## Skills included (14)

| Skill | Use it for |
| --- | --- |
| `using-superpowers` | Entry point — how to find and use skills before responding |
| `brainstorming` | Explore intent, requirements, and design before implementation |
| `writing-plans` | Turn a spec into a multi-step implementation plan |
| `executing-plans` | Execute a written plan with review checkpoints |
| `subagent-driven-development` | Execute plan tasks via subagents in one session |
| `dispatching-parallel-agents` | Fan out 2+ independent tasks to parallel agents |
| `test-driven-development` | Write tests before implementation |
| `systematic-debugging` | Diagnose bugs and failures before proposing fixes |
| `writing-skills` | Create, edit, and verify skills |
| `requesting-code-review` | Request review before merging major work |
| `receiving-code-review` | Handle review feedback with technical rigor |
| `verification-before-completion` | Verify work before claiming it's done |
| `using-git-worktrees` | Isolate feature work in a git worktree |
| `finishing-a-development-branch` | Decide how to integrate completed work |

## How to update

These skills are a snapshot, not a live dependency. To refresh them from upstream:

1. Update your local copies (e.g. via your skills manager, or `claude plugin update
   superpowers@claude-plugins-official`).
2. Re-copy the 14 directories above from your local skills dir (e.g. `~/.agents/skills/`)
   into this `.claude/skills/` folder.
3. Update the **Snapshot taken** date above and commit.

## Known duplication

If you also have Superpowers installed globally (as a user-scope plugin or via a personal
`~/.claude/skills` skills-dir), the same-named skills will exist in more than one place on
your machine. This is harmless — project-local skills in `.claude/skills/` generally take
precedence — but it means your own skill list may show duplicates. Teammates who don't have
a personal install get these skills solely from this folder.
