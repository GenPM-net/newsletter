// Panel: suscriptores (lista, etiquetas, borrado) y campañas (editar borradores, enviar, programar, cancelar).
import { and, count, desc, eq, ilike, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AdminContext, AdminResource } from '../contracts/index.js';
import { getDb } from '../db/index.js';
import { cancelCampaign, createCampaign, NewsletterError, sendCampaign, updateCampaign } from './newsletter.js';
import { type Campaign, campaigns, type Subscriber, subscribers } from './schema.js';

async function need(ctx: AdminContext, perm: string) {
  if (!(await ctx.can(perm))) throw new NewsletterError('forbidden', `forbidden: ${perm}`);
}
const page = <T>(q: { page: number; pageSize: number }) => ({ limit: q.pageSize, offset: (Math.max(q.page, 1) - 1) * q.pageSize }) as T & { limit: number; offset: number };

export const subscribersAdminResource: AdminResource<Subscriber> = {
  name: 'subscribers',
  label: { singular: 'Subscriber', plural: 'Subscribers' },
  group: 'Newsletter',
  fields: [
    { name: 'email', label: 'Email', type: 'email', readOnly: true, list: true },
    { name: 'status', label: 'Status', type: 'select', readOnly: true, list: true, options: ['pending', 'active', 'unsubscribed', 'bounced', 'complained'].map((v) => ({ value: v, label: v })) },
    { name: 'tags', label: 'Tags', type: 'json', list: true },
    { name: 'source', label: 'Source', type: 'text', readOnly: true },
    { name: 'consentAt', label: 'Consent', type: 'datetime', readOnly: true },
  ],
  input: z.object({ tags: z.array(z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/)).max(20) }),
  title: (s) => s.email,
  async list(q, ctx) {
    await need(ctx, 'subscribers:read');
    const conds: SQL[] = [];
    if (q.filters?.status) conds.push(sql`${subscribers.status} = ${q.filters.status}`);
    if (q.filters?.tag) conds.push(sql`${subscribers.tags} @> ${JSON.stringify([q.filters.tag])}::jsonb`);
    if (q.search) conds.push(ilike(subscribers.email, `%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`));
    const where = conds.length ? and(...conds) : undefined;
    const [total] = await getDb().select({ n: count() }).from(subscribers).where(where);
    const { limit, offset } = page(q);
    const rows = await getDb().select().from(subscribers).where(where).orderBy(desc(subscribers.createdAt)).limit(limit).offset(offset);
    return { rows, total: total?.n ?? 0 };
  },
  async get(id, ctx) {
    await need(ctx, 'subscribers:read');
    const [row] = await getDb().select().from(subscribers).where(eq(subscribers.id, id));
    return row ?? null;
  },
  async update(id, input, ctx) {
    await need(ctx, 'subscribers:update');
    const { tags } = subscribersAdminResource.input.parse(input) as { tags: string[] };
    const [row] = await getDb().update(subscribers).set({ tags }).where(eq(subscribers.id, id)).returning();
    if (!row) throw new NewsletterError('not_found');
    return row;
  },
  async delete(id, ctx) {
    await need(ctx, 'subscribers:delete');
    await getDb().delete(subscribers).where(eq(subscribers.id, id));
  },
};

const CampaignForm = z.object({ subject: z.string(), preheader: z.string().optional(), body: z.unknown(), tags: z.array(z.string()).optional() });

export const campaignsAdminResource: AdminResource<Campaign> = {
  name: 'campaigns',
  label: { singular: 'Campaign', plural: 'Campaigns' },
  group: 'Newsletter',
  fields: [
    { name: 'subject', label: 'Subject', type: 'text', required: true, list: true },
    { name: 'preheader', label: 'Preview text', type: 'text' },
    { name: 'body', label: 'Content', type: 'richText', required: true },
    { name: 'tags', label: 'Only subscribers tagged', type: 'json' },
    { name: 'status', label: 'Status', type: 'select', readOnly: true, list: true, options: ['draft', 'scheduled', 'sending', 'sent', 'cancelled'].map((v) => ({ value: v, label: v })) },
    { name: 'sentCount', label: 'Sent', type: 'number', readOnly: true, list: true },
    { name: 'failedCount', label: 'Failed', type: 'number', readOnly: true },
  ],
  input: CampaignForm,
  title: (c) => c.subject,
  async list(q, ctx) {
    await need(ctx, 'campaigns:read');
    const [total] = await getDb().select({ n: count() }).from(campaigns);
    const { limit, offset } = page(q);
    return { rows: await getDb().select().from(campaigns).orderBy(desc(campaigns.createdAt)).limit(limit).offset(offset), total: total?.n ?? 0 };
  },
  async get(id, ctx) {
    await need(ctx, 'campaigns:read');
    const [row] = await getDb().select().from(campaigns).where(eq(campaigns.id, id));
    return row ?? null;
  },
  async create(input, ctx) {
    await need(ctx, 'campaigns:create');
    return createCampaign(input as Parameters<typeof createCampaign>[0]);
  },
  async update(id, input, ctx) {
    await need(ctx, 'campaigns:update');
    return updateCampaign(id, input as Parameters<typeof updateCampaign>[1]);
  },
  actions: [
    {
      name: 'send',
      label: 'Send now',
      permission: 'campaigns:send',
      confirm: true,
      available: (c) => c.status === 'draft' || c.status === 'scheduled',
      async run(id, _i, ctx) {
        await need(ctx, 'campaigns:send');
        return sendCampaign(id);
      },
    },
    {
      name: 'schedule',
      label: 'Schedule',
      permission: 'campaigns:send',
      input: z.object({ at: z.coerce.date() }),
      available: (c) => c.status === 'draft',
      async run(id, input, ctx) {
        await need(ctx, 'campaigns:send');
        const { at } = z.object({ at: z.coerce.date() }).parse(input);
        if (at.getTime() <= Date.now()) throw new NewsletterError('invalid', 'date must be in the future');
        return sendCampaign(id, at);
      },
    },
    {
      name: 'cancel',
      label: 'Cancel',
      permission: 'campaigns:send',
      confirm: true,
      available: (c) => c.status === 'scheduled' || c.status === 'sending',
      async run(id, _i, ctx) {
        await need(ctx, 'campaigns:send');
        await cancelCampaign(id);
        const [row] = await getDb().select().from(campaigns).where(eq(campaigns.id, id));
        return row!;
      },
    },
  ],
};

export const newsletterAdminResources = () => [subscribersAdminResource, campaignsAdminResource];
