import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { formTimingToken } from '../antispam/index.js';
import * as antispamSchema from '../antispam/schema.js';
import type { AdminContext } from '../contracts/index.js';
import { testDb } from '../db/__fixtures__/pglite.js';
import type { Db } from '../db/index.js';
import { runDue } from '../jobs/index.js';
import * as jobsSchema from '../jobs/schema.js';
import { docFromText } from '../rich-text/index.js';
import { newsletterRoutes } from './adapters/hono.js';
import { unsubscribeRoute } from './adapters/next.js';
import * as schema from './schema.js';
import {
  BATCH_SIZE,
  campaignSends,
  campaigns,
  campaignsAdminResource,
  confirmSubscription,
  confirmUrl,
  createCampaign,
  deleteSubscriber,
  markUndeliverable,
  type NewsletterMessage,
  NewsletterError,
  renderCampaign,
  resendSender,
  sendCampaign,
  setNewsletterMessages,
  setNewsletterSender,
  subscribe,
  subscribers,
  unsubscribe,
  unsubscribeUrl,
} from './index.js';

let db: Db;
const sent: NewsletterMessage[] = [];
const ctx = async () => ({ headers: new Headers({ 'x-forwarded-for': `192.0.2.${Math.floor(Math.random() * 250)}` }), fields: { _ts: await formTimingToken(Date.now() - 5000) } });
const tokenFrom = (url: string) => new URL(url).searchParams.get('token');
const code = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof NewsletterError ? e.code : Promise.reject(e)));

beforeEach(async () => {
  db = await testDb(antispamSchema, jobsSchema, schema);
  sent.length = 0;
  setNewsletterSender({ name: 'test', send: async (m) => void sent.push(m) });
  setNewsletterMessages(() => ({}));
  Object.assign(process.env, {
    ANTISPAM_SECRET: 'a'.repeat(40),
    NEWSLETTER_SECRET: 'n'.repeat(40),
    NEWSLETTER_FROM: 'News <news@site.test>',
    NEWSLETTER_POSTAL_ADDRESS: 'Calle Mayor 1, 46001 Valencia, Spain',
    SITE_URL: 'https://site.test',
  });
});

async function activeSubscriber(email: string, tags: string[] = []) {
  await subscribe({ email, tags }, await ctx());
  const [s] = await db.select().from(subscribers).where(eq(subscribers.email, email.toLowerCase()));
  return confirmSubscription(tokenFrom(await confirmUrl(s!.id)));
}

describe('double opt-in', () => {
  it('stores pending, emails a confirmation link and activates on confirm', async () => {
    setNewsletterMessages((l) => (l === 'es' ? { confirmSubject: 'Confirma tu suscripción' } : {}));
    await subscribe({ email: ' Ana@Site.TEST ', tags: ['blog'], source: 'footer', locale: 'es', consentVersion: 'v1' }, await ctx());
    const [s] = await db.select().from(subscribers);
    expect(s).toMatchObject({ email: 'ana@site.test', status: 'pending', tags: ['blog'], consentVersion: 'v1' });
    await runDue();
    expect(sent[0]).toMatchObject({ to: 'ana@site.test', subject: 'Confirma tu suscripción' });
    const link = sent[0]!.text.match(/https:\/\/\S+/)![0];
    expect((await confirmSubscription(tokenFrom(link))).status).toBe('active');
    expect(await code(confirmSubscription('bad.token.0.x'))).toBe('invalid_token');
  });

  it('does not reveal existing subscribers and merges tags; complainers are never mailed again', async () => {
    await activeSubscriber('b@site.test', ['blog']);
    await subscribe({ email: 'b@site.test', tags: ['shop'] }, await ctx());
    const [s] = await db.select().from(subscribers);
    expect(s).toMatchObject({ status: 'active', tags: ['blog', 'shop'] });
    await markUndeliverable('B@site.test', 'complained');
    await subscribe({ email: 'b@site.test' }, await ctx());
    expect((await db.select().from(subscribers))[0]!.status).toBe('complained');
  });

  it('rejects invalid emails and bots', async () => {
    expect(await code(subscribe({ email: 'nope' }, await ctx()))).toBe('invalid');
    expect(await code(subscribe({ email: 'x@site.test' }, { headers: new Headers(), fields: {} }))).toBe('spam');
  });

  it('unsubscribe tokens never expire and confirm tokens cannot unsubscribe', async () => {
    const s = await activeSubscriber('c@site.test');
    expect(await code(unsubscribe(tokenFrom(await confirmUrl(s.id))))).toBe('invalid_token');
    await unsubscribe(tokenFrom(await unsubscribeUrl(s.id)));
    expect((await db.select().from(subscribers))[0]!.status).toBe('unsubscribed');
    expect(await deleteSubscriber('C@site.test')).toBe(true);
  });
});

describe('campaigns', () => {
  it('renders footer, postal address and RFC 8058 headers', async () => {
    const m = await renderCampaign({ subject: 'Hi', preheader: 'News inside', body: docFromText('Hello <friends>') }, { id: 'nsb_1', email: 'x@y.z', locale: null });
    expect(m.headers['List-Unsubscribe']).toMatch(/^<https:\/\/site\.test\/newsletter\/unsubscribe\?token=nsb_1\.unsubscribe\.0\..+>$/);
    expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(m.html).toContain('Hello &lt;friends&gt;');
    expect(m.html).toContain('Calle Mayor 1');
    expect(m.text).toContain('Unsubscribe: https://site.test/newsletter/unsubscribe?token=');
  });

  it('sends to active, tagged subscribers in resumable batches without duplicates', async () => {
    for (let i = 0; i < BATCH_SIZE + 5; i++) await db.insert(subscribers).values({ email: `s${i}@site.test`, status: 'active', tags: i % 2 ? ['shop'] : ['blog'] });
    await db.insert(subscribers).values({ email: 'gone@site.test', status: 'unsubscribed', tags: ['shop'] });
    const c = await createCampaign({ subject: 'Sale', body: docFromText('Big sale'), tags: ['shop'] });
    await sendCampaign(c.id);
    await expect(sendCampaign(c.id)).rejects.toMatchObject({ code: 'invalid_state' });
    const target = Math.floor((BATCH_SIZE + 5) / 2);
    await runDue({ limit: 1 });
    expect(sent).toHaveLength(target); // < BATCH_SIZE: un solo lote
    expect((await db.select().from(campaigns))[0]).toMatchObject({ status: 'sent', sentCount: target, failedCount: 0 });
    expect(new Set(sent.map((m) => m.to)).size).toBe(target);
    expect(sent.some((m) => m.to === 'gone@site.test')).toBe(false);
  });

  it('continues across batches and records failures', async () => {
    for (let i = 0; i < BATCH_SIZE + 3; i++) await db.insert(subscribers).values({ email: `t${i}@site.test`, status: 'active' });
    setNewsletterSender({ name: 'flaky', send: async (m) => { if (m.to === 't7@site.test') throw new Error('mailbox full'); sent.push(m); } });
    const c = await createCampaign({ subject: 'All', body: docFromText('Hi') });
    await sendCampaign(c.id);
    await runDue({ limit: 1 });
    expect((await db.select().from(campaigns))[0]!.status).toBe('sending');
    await runDue({ limit: 1 });
    expect((await db.select().from(campaigns))[0]).toMatchObject({ status: 'sent', sentCount: BATCH_SIZE + 2, failedCount: 1 });
    const failed = await db.select().from(campaignSends).where(eq(campaignSends.status, 'failed'));
    expect(failed[0]!.error).toBe('mailbox full');
  });

  it('admin: permissions, scheduling in the future, cancel', async () => {
    const admin = (perms: string[]): AdminContext => ({ user: { id: 'u', email: null, name: null }, can: async (p) => perms.includes(p) });
    const all = admin(['campaigns:create', 'campaigns:send', 'campaigns:read']);
    const c = await campaignsAdminResource.create!({ subject: 'Later', body: docFromText('x') }, all);
    await expect(campaignsAdminResource.create!({ subject: 'x', body: docFromText('x') }, admin([]))).rejects.toMatchObject({ code: 'forbidden' });
    const schedule = campaignsAdminResource.actions!.find((a) => a.name === 'schedule')!;
    await expect(schedule.run(c.id, { at: new Date(Date.now() - 1000).toISOString() }, all)).rejects.toMatchObject({ code: 'invalid' });
    expect((await schedule.run(c.id, { at: new Date(Date.now() + 3_600_000).toISOString() }, all)).status).toBe('scheduled');
    expect((await campaignsAdminResource.actions!.find((a) => a.name === 'cancel')!.run(c.id, {}, all)).status).toBe('cancelled');
  });
});

describe('sender and routes', () => {
  it('Resend sender passes List-Unsubscribe headers', async () => {
    let body: Record<string, unknown> = {};
    const fakeFetch = (async (_u: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await resendSender('re_key', fakeFetch).send({ from: 'a@b.c', to: 'd@e.f', subject: 's', html: 'h', text: 't', headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
    expect(body).toMatchObject({ to: ['d@e.f'], headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
    const failing = (async () => new Response('bad', { status: 422 })) as unknown as typeof fetch;
    await expect(resendSender('k', failing).send({ from: 'a', to: 'b', subject: 's', html: 'h', text: 't', headers: {} })).rejects.toThrow(/422/);
  });

  it('subscribe, confirm and one-click unsubscribe over HTTP', async () => {
    const app = new Hono().route('/newsletter', newsletterRoutes());
    const fields = (await ctx()).fields;
    const res = await app.request('/newsletter/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '192.0.2.200' }, body: JSON.stringify({ ...fields, email: 'h@site.test' }) });
    expect(res.status).toBe(202);
    await runDue();
    const confirm = new URL(sent[0]!.text.match(/https:\/\/\S+/)![0]);
    const c = await app.request(`${confirm.pathname}${confirm.search}`);
    expect(c.headers.get('location')).toBe('/newsletter/confirmed');
    const [s] = await db.select().from(subscribers);
    const unsub = new URL(await unsubscribeUrl(s!.id));
    const one = await unsubscribeRoute(new Request(unsub, { method: 'POST', body: 'List-Unsubscribe=One-Click' }));
    expect(one.status).toBe(200);
    expect((await db.select().from(subscribers))[0]!.status).toBe('unsubscribed');
    expect((await app.request('/newsletter/unsubscribe?token=bad')).headers.get('location')).toBe('/newsletter/invalid');
  });
});
