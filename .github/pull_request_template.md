<!--
Thanks for contributing to @sqaoss/qr! Please fill in the sections below.
Keep the PR focused — one logical change per PR is easiest to review.
-->

## What & why

<!-- What does this change do, and what problem does it solve? -->

## Type of change

- [ ] `feat` — new option, command, or MCP tool
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `refactor` / `chore` / `ci` / `test` — no user-facing behavior change
- [ ] Other (describe):

## Checklist

- [ ] Commits follow [conventional commits](https://www.conventionalcommits.org/) (enforced by commitlint).
- [ ] `bun run check` passes (Biome lint + format).
- [ ] `bun run typecheck` passes.
- [ ] `bun run test` passes; new behavior has tests written first.
- [ ] `bun run test:e2e` passes if the build output, the `bin`, the published
      files or the MCP stdio server changed.
- [ ] Docs updated (`README.md`, `skills/qr/SKILL.md`, `AGENTS.md`,
      `CONTRIBUTING.md`) where relevant.
- [ ] Public signatures still avoid leaking `qrcode` types.
- [ ] No secrets, API keys, or tokens committed.

## Related issues

<!-- e.g. Closes #123 -->
