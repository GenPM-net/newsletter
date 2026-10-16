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

## Setup

After `genpm add`, follow these steps (your AI agent finds the same steps in `src/lib/newsletter/AGENTS.md` and can do them for you):

1. Env: `NEWSLETTER_FROM`, `NEWSLETTER_POSTAL_ADDRESS` (legal requirement), `NEWSLETTER_SECRET` (≥ 32 chars), `SITE_URL`,
   and `RESEND_API_KEY` in production (other providers: implement `NewsletterSender` and call `setNewsletterSender`).
   Verify the sending domain (SPF, DKIM, DMARC) with the provider — tell the user how; you can't do it for them.
2. Migrations as in `src/lib/db/AGENTS.md`; the @core/jobs cron must run.
3. Routes under `/newsletter` (Hono `app.route('/newsletter', newsletterRoutes())`, or the Next handlers) and three
   simple pages: `/newsletter/confirmed`, `/newsletter/unsubscribed`, `/newsletter/invalid`. `confirm` and `unsubscribe`
   need GET and POST: GET only renders a minimal page with a button (mail link scanners open every URL), the button
   POSTs and acts; any other POST to `unsubscribe` is the RFC 8058 one-click (200, no redirect). Translate the page
   with `texts` (`newsletterRoutes({ texts })` or the handlers' third argument).
4. Sign-up form: `POST /newsletter/subscribe` with `email`, the @core/antispam fields and an unchecked, required consent
   checkbox `consent` whose text version goes in a hidden `consentVersion` (with `consentVersion`, the server rejects
   the sign-up unless `consent` is checked: `consent_required`). Always show the same "check your inbox" message.
   A plain HTML form posted from the same site (`Accept: text/html` and a same-host `Referer`, what browsers send) is
   redirected back with `?newsletter=<status>#newsletter`; other clients get JSON (202, or 400/429 with `error`).
5. Translate system emails with `setNewsletterMessages((locale) => ({ confirmSubject, confirmText, unsubscribeLabel }))`.
6. Add `...newsletterAdminResources()` to `src/genpm/admin.ts`; wire the provider's bounce/complaint webhook to `markUndeliverable`.
7. Verify: subscribe, open the confirmation link, send a campaign to yourself and unsubscribe with one click.

## What's inside

Paths are relative to `src/lib/newsletter`.

- `index.ts` — public API: `subscribe`, `confirmSubscription`, `unsubscribe`, `createCampaign`, `sendCampaign`, `markUndeliverable`, `deleteSubscriber`, `newsletterAdminResources`, `setNewsletterMessages`.
- `newsletter.ts` — logic and jobs. `sender.ts` — sending (Resend API with headers, or @core/email in dev). `tokens.ts` — signed links.
- `adapters/hono.ts` — `newsletterRoutes()`. `adapters/next.ts` — `subscribeRoute`, `confirmRoute`, `unsubscribeRoute`.

## At a glance

- **GenPM dependencies** (installed with it): [@core/db](https://genpm.net/p/@core/db), [@core/antispam](https://genpm.net/p/@core/antispam), [@core/email](https://genpm.net/p/@core/email), [@core/jobs](https://genpm.net/p/@core/jobs), [@core/rich-text](https://genpm.net/p/@core/rich-text), [@core/contracts](https://genpm.net/p/@core/contracts)
- **npm dependencies** (proposed, never installed without asking): `zod`
- **Environment variables** (added to `.env.example`): `NEWSLETTER_FROM`, `NEWSLETTER_POSTAL_ADDRESS`, `NEWSLETTER_SECRET`, `SITE_URL`
- **AI rules**: [`AGENTS.md`](AGENTS.md), loaded by your agent only when it works in `src/lib/newsletter`

## Security

GenPM installs a 40-character commit SHA (never a branch), verifies an Ed25519-signed manifest, never runs install scripts and scans AI rules for prompt injection. Details: [genpm.net/docs/security](https://genpm.net/docs/security).

## License

MIT — see [LICENSE](LICENSE). Browse the full catalog at [genpm.net](https://genpm.net).
