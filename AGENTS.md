# @core/newsletter — rules for AI agents

## Purpose
Own-list newsletter: sign-ups with double opt-in and consent record, tags, one-click unsubscribe (RFC 8058 headers,
required by Gmail/Yahoo for bulk senders) plus a visible link and postal address in every email, rich-text campaigns
sent in resumable batches by @core/jobs (no duplicates), bounce/complaint suppression and GDPR erasure.
Tables: `subscribers`, `newsletter_campaigns`, `newsletter_sends`. No open-tracking pixels, no automations.

## Map
- `index.ts` — public API: `subscribe`, `confirmSubscription`, `unsubscribe`, `createCampaign`, `sendCampaign`, `markUndeliverable`, `deleteSubscriber`, `newsletterAdminResources`, `setNewsletterMessages`.
- `newsletter.ts` — logic and jobs. `sender.ts` — sending (Resend API with headers, or @core/email in dev). `tokens.ts` — signed links.
- `adapters/hono.ts` — `newsletterRoutes()`. `adapters/next.ts` — `subscribeRoute`, `confirmRoute`, `unsubscribeRoute`.

## Integration
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

## Conventions
- Only `active` (confirmed) subscribers receive campaigns; tags segment them.
- Batches claim recipients atomically (`newsletter_sends.status = 'sending'`, `FOR UPDATE SKIP LOCKED`), so concurrent
  batch jobs never mail the same subscriber twice; claims older than 15 min (a dead worker) are retried.
- Permissions: `subscribers:read|update|delete`, `campaigns:read|create|update|send`.

## Don't
- Don't import contacts without documented consent, and never pre-check the consent box.
- Don't send campaigns from a request handler or remove the unsubscribe link/headers.
- Don't reveal whether an email is already subscribed.
