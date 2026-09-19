---
name: no-edits-outside-worktree
enabled: true
event: file
conditions:
  - field: file_path
    operator: not_contains
    pattern: .worktrees/
action: block
---

**BLOCKED: Editing files outside a worktree.**

Use the `/using-git-worktrees` skill to create an isolated workspace before making any changes.
