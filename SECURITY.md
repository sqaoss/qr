# Security Policy

We take the security of `@sqaoss/qr` seriously. Thank you for helping keep it
and its users safe.

## Supported versions

`@sqaoss/qr` is released continuously from `main` via semantic-release, and only
the **latest published version** on npm is supported with security fixes.
Please upgrade before reporting:

```bash
npm i -g @sqaoss/qr@latest
```

| Version | Supported |
| ------- | --------- |
| latest  | ✅        |
| older   | ❌        |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately through **GitHub Security Advisories**: open a private report
at <https://github.com/sqaoss/qr/security/advisories/new>. This is the only
reporting channel. It keeps the discussion confidential until a fix is
released, and lets us collaborate on a patch with you directly. If you cannot
use GitHub Security Advisories, open a minimal public issue asking a maintainer
to contact you privately — without disclosing any vulnerability details.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.
- The version (`qr --version`) and how it was reached: the library, the CLI, or
  the MCP server, and which MCP client if that matters.
- Any relevant logs or output, with **API keys and tokens redacted**.

## What to expect

- **Acknowledgement** within 3 business days.
- An initial assessment and severity triage within 7 business days.
- We aim to ship a fix for confirmed, high-severity issues in the latest
  release as quickly as practical, and will keep you updated on progress.
- With your permission, we'll credit you in the release notes once a fix is
  published. We support coordinated disclosure and ask that you give us a
  reasonable window to remediate before any public disclosure.

## Scope

This policy covers the `@sqaoss/qr` package in this repository: the library,
the `qr` CLI, the MCP server, and the published skill and Claude Code plugin.
There is no hosted service.

## Filesystem writes from the MCP server

This is behavior, not a vulnerability, and it is worth stating plainly before
you install the server.

`qr_save` and `qr_save_batch` **write files wherever the MCP client points
them**. They take a `path` and an `outDir` from the caller, create missing
parent directories, and write there with the permissions of the process running
the server. **The output directory is not a sandbox.** Nothing in this package
confines writes to a project directory, a temp directory, or any other root.

What the tools do enforce is narrow, and is about predictable output rather
than containment:

- `qr_save` never overwrites an existing file. A clash comes back as an
  `isError` result with code `FILE_EXISTS`, so the agent picks another path.
- In `qr_save_batch`, an item's `out` must be relative and must stay inside the
  given `outDir`; otherwise that item fails with `INVALID_BATCH`. This keeps
  the output layout predictable. **It is not a security boundary** — `outDir`
  itself is whatever the caller passed.
- If `process.cwd()` is the filesystem root, as it is under some desktop MCP
  clients, a relative `path` is rejected and an absolute one is required, so
  files don't land in `/`.

Run the server with an account that only has access to what you're willing to
have written to, and treat the `path` and `outDir` arguments as trusted input
from whoever controls the agent.

The CLI has the same property, as any file-writing CLI does: `-o` writes where
you tell it to, and `--force` overwrites.
