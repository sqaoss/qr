---
name: require-worktree
enabled: true
event: bash
pattern: git\s+(checkout\s+-b|switch\s+-c)\s+
action: block
---

**BLOCKED: Creating branches directly instead of using worktrees.**

Use the `/using-git-worktrees` skill to create an isolated workspace before making any changes.
