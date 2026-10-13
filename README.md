# @core/newsletter

[![genpm](https://api.genpm.net/v1/badge/@core/newsletter.svg)](https://genpm.net/p/@core/newsletter) ![license](https://img.shields.io/badge/license-MIT-blue)

> Newsletter: double opt-in, one-click unsubscribe (RFC 8058), tags, rich-text campaigns sent in resumable batches

A [GenPM](https://genpm.net) module: **source code + AI rules + MCP config**, injected into your project instead of hidden in `node_modules`. The code lands in `src/lib/newsletter`, pinned to a verified commit, and you own it.

## Install

```bash
genpm add @core/newsletter
```

No genpm yet? `curl -fsSL https://genpm.net/install.sh | sh` (macOS/Linux), `irm https://genpm.net/install.ps1 | iex` (Windows), or one-off with `npx @genpm-net/cli add @core/newsletter`.

Or let your AI agent do it: run `genpm mcp setup` once, then ask *"add @core/newsletter with genpm"* in Claude Code, Cursor, VS Code, Windsurf, Codex or Gemini CLI. It shows you a dry-run plan before writing anything.

## What it does

Own-list newsletter: sign-ups with double opt-in and consent record, tags, one-click unsubscribe (RFC 8058 headers,
required by Gmail/Yahoo for bulk senders) plus a visible link and postal address in every email, rich-text campaigns
sent in resumable batches by @core/jobs (no duplicates), bounce/complaint suppression and GDPR erasure.
Tables: `subscribers`, `newsletter_campaigns`, `newsletter_sends`. No open-tracking pixels, no automations.

## At a glance

- **GenPM dependencies** (installed with it): [@core/db](https://genpm.net/p/@core/db), [@core/antispam](https://genpm.net/p/@core/antispam), [@core/email](https://genpm.net/p/@core/email), [@core/jobs](https://genpm.net/p/@core/jobs), [@core/rich-text](https://genpm.net/p/@core/rich-text), [@core/contracts](https://genpm.net/p/@core/contracts)
- **npm dependencies** (proposed, never installed without asking): `zod`
- **Environment variables** (added to `.env.example`): `NEWSLETTER_FROM`, `NEWSLETTER_POSTAL_ADDRESS`, `NEWSLETTER_SECRET`, `SITE_URL`
- **AI rules**: [`AGENTS.md`](AGENTS.md), loaded by your agent only when it works in `src/lib/newsletter`

## Security

GenPM installs a 40-character commit SHA (never a branch), verifies an Ed25519-signed manifest, never runs install scripts and scans AI rules for prompt injection. Details: [genpm.net/docs/security](https://genpm.net/docs/security).

## License

MIT — see [LICENSE](LICENSE). Browse the full catalog at [genpm.net](https://genpm.net).
