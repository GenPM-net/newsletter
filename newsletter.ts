// Altas con doble opt-in, bajas en un clic y campañas enviadas por lotes reanudables con @core/jobs.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { verifyHuman } from '../antispam/index.ts';
import { type Executor, getDb } from '../db/index.ts';
import { defineJob, jobs } from '../jobs/index.ts';
import { type Doc, toHtml, toPlainText } from '../rich-text/index.ts';
import { type Campaign, campaignSends, campaigns, type Subscriber, subscribers } from './schema.ts';
import { getNewsletterSender } from './sender.ts';
import { makeToken, readToken } from './tokens.ts';

export class NewsletterError extends Error {
  constructor(
    readonly code: 'invalid' | 'spam' | 'rate_limited' | 'not_found' | 'invalid_state' | 'invalid_token' | 'forbidden' | 'consent_required',
    message: string = code,
  ) {
    super(message);
    this.name = 'NewsletterError';
  }
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
const Tag = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/** Textos de los emails del sistema por idioma (por defecto inglés). Sustitúyelos con `setNewsletterMessages`. */
export type NewsletterMessages = {
  confirmSubject: string;
  confirmText: (link: string) => string;
  unsubscribeLabel: string;
};
const EN: NewsletterMessages = {
  confirmSubject: 'Confirm your subscription',
  confirmText: (link) => `Please confirm your subscription by opening this link:\n\n${link}\n\nIf you didn't ask for it, ignore this email.`,
  unsubscribeLabel: 'Unsubscribe',
};
let messagesFor: (locale: string | null) => NewsletterMessages = () => EN;
export const setNewsletterMessages = (fn: (locale: string | null) => Partial<NewsletterMessages>) => {
  messagesFor = (l) => ({ ...EN, ...fn(l) });
};

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

const siteUrl = (path: string) => new URL(path, env('SITE_URL')).toString();
export const unsubscribeUrl = async (id: string) => siteUrl(`/newsletter/unsubscribe?token=${await makeToken(id, 'unsubscribe')}`);
export const confirmUrl = async (id: string) => siteUrl(`/newsletter/confirm?token=${await makeToken(id, 'confirm')}`);

/**
 * Alta (o reactivación) en estado `pending` y email de confirmación. Si ya está activo no hace nada; la respuesta
 * es la misma en todos los casos para no revelar quién está suscrito.
 */
export async function subscribe(
  input: { email: string; tags?: string[]; source?: string; locale?: string; consentVersion?: string },
  ctx: { headers: Headers; fields: FormData | Record<string, unknown>; skipAntispam?: boolean },
  db: Executor = getDb(),
): Promise<void> {
  if (!ctx.skipAntispam) {
    const human = await verifyHuman(ctx.headers, ctx.fields, { scope: 'newsletter', limit: 5, windowMs: 3_600_000 }, db);
    if (!human.ok) throw new NewsletterError(human.reason === 'rate_limited' ? 'rate_limited' : 'spam');
  }
  const email = z.email().max(254).safeParse(normalizeEmail(input.email));
  const tags = z.array(Tag).max(20).safeParse(input.tags ?? []);
  if (!email.success || !tags.success) throw new NewsletterError('invalid');
  const [existing] = await db.select().from(subscribers).where(eq(subscribers.email, email.data));
  if (existing?.status === 'active') {
    const merged = [...new Set([...existing.tags, ...tags.data])];
    if (merged.length !== existing.tags.length) await db.update(subscribers).set({ tags: merged }).where(eq(subscribers.id, existing.id));
    return;
  }
  if (existing?.status === 'complained') return; // marcó como spam: no se le vuelve a escribir
  const values = {
    status: 'pending' as const,
    tags: [...new Set([...(existing?.tags ?? []), ...tags.data])],
    locale: input.locale ?? existing?.locale ?? null,
    source: (input.source ?? existing?.source ?? null)?.slice(0, 80) ?? null,
    consentVersion: input.consentVersion ?? null,
    consentAt: new Date(),
    unsubscribedAt: null,
  };
  const [row] = existing
    ? await db.update(subscribers).set(values).where(eq(subscribers.id, existing.id)).returning()
    : await db.insert(subscribers).values({ email: email.data, ...values }).returning();
  await sendConfirmationJob.enqueue({ subscriberId: row!.id }, { dedupeKey: `newsletter.confirm:${row!.id}` }, db);
}

export const sendConfirmationJob = defineJob('newsletter.confirm', z.object({ subscriberId: z.string() }), async ({ subscriberId }) => {
  const [s] = await getDb().select().from(subscribers).where(eq(subscribers.id, subscriberId));
  if (!s || s.status !== 'pending') return;
  const msg = messagesFor(s.locale);
  const link = await confirmUrl(s.id);
  const text = msg.confirmText(link);
  await getNewsletterSender().send({
    from: env('NEWSLETTER_FROM'),
    to: s.email,
    subject: msg.confirmSubject,
    text,
    html: `<p>${esc(text).replaceAll('\n', '<br>').replace(esc(link), `<a href="${esc(link)}">${esc(link)}</a>`)}</p>`,
    headers: {},
  });
});

export async function confirmSubscription(token: string | null, db: Executor = getDb()): Promise<Subscriber> {
  const id = await readToken(token, 'confirm');
  if (!id) throw new NewsletterError('invalid_token');
  const [row] = await db
    .update(subscribers)
    .set({ status: 'active', confirmedAt: new Date() })
    .where(and(eq(subscribers.id, id), inArray(subscribers.status, ['pending', 'active'])))
    .returning();
  if (!row) throw new NewsletterError('invalid_state');
  return row;
}

export async function unsubscribe(token: string | null, db: Executor = getDb()): Promise<void> {
  const id = await readToken(token, 'unsubscribe');
  if (!id) throw new NewsletterError('invalid_token');
  await db
    .update(subscribers)
    .set({ status: 'unsubscribed', unsubscribedAt: new Date() })
    .where(and(eq(subscribers.id, id), inArray(subscribers.status, ['pending', 'active'])));
}

/** Rebotes y quejas del proveedor (desde su webhook): no se vuelve a enviar a esa dirección. */
export async function markUndeliverable(email: string, kind: 'bounced' | 'complained', db: Executor = getDb()): Promise<void> {
  await db.update(subscribers).set({ status: kind }).where(eq(subscribers.email, normalizeEmail(email)));
}

/** Derecho de supresión. */
export async function deleteSubscriber(email: string, db: Executor = getDb()): Promise<boolean> {
  const rows = await db.delete(subscribers).where(eq(subscribers.email, normalizeEmail(email))).returning({ id: subscribers.id });
  return rows.length > 0;
}

const esc = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Email de una campaña para un suscriptor: cuerpo, pie con dirección postal y baja, y cabeceras RFC 8058. */
export async function renderCampaign(c: Pick<Campaign, 'subject' | 'preheader' | 'body'>, s: Pick<Subscriber, 'id' | 'email' | 'locale'>) {
  const unsub = await unsubscribeUrl(s.id);
  const address = env('NEWSLETTER_POSTAL_ADDRESS');
  const label = messagesFor(s.locale).unsubscribeLabel;
  const host = new URL(env('SITE_URL')).host;
  const preheader = c.preheader ? `<div style="display:none;max-height:0;overflow:hidden">${esc(c.preheader)}</div>` : '';
  return {
    subject: c.subject,
    html: `${preheader}${toHtml(c.body as Doc, { siteHost: host })}<hr><p style="font-size:12px;color:#666">${esc(address)}<br><a href="${esc(unsub)}">${esc(label)}</a></p>`,
    text: `${toPlainText(c.body as Doc)}\n\n--\n${address}\n${label}: ${unsub}`,
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

const CampaignInput = z.object({
  subject: z.string().min(1).max(200),
  preheader: z.string().max(200).optional(),
  body: z.custom<Doc>((v) => typeof v === 'object' && v !== null && (v as Doc).type === 'doc'),
  tags: z.array(Tag).max(20).default([]),
});

export async function createCampaign(input: z.input<typeof CampaignInput>, db: Executor = getDb()): Promise<Campaign> {
  const data = CampaignInput.parse(input);
  const [row] = await db.insert(campaigns).values({ ...data, preheader: data.preheader ?? null }).returning();
  return row!;
}

export async function updateCampaign(id: string, input: z.input<typeof CampaignInput>, db: Executor = getDb()): Promise<Campaign> {
  const data = CampaignInput.parse(input);
  const [row] = await db.update(campaigns).set({ ...data, preheader: data.preheader ?? null }).where(and(eq(campaigns.id, id), eq(campaigns.status, 'draft'))).returning();
  if (!row) throw new NewsletterError('invalid_state', 'only draft campaigns can be edited');
  return row;
}

/** Empieza a enviar (o programa para `at`). Solo desde borrador o programada. */
export async function sendCampaign(id: string, at?: Date, db: Executor = getDb()): Promise<Campaign> {
  const [row] = await db
    .update(campaigns)
    .set({ status: at ? 'scheduled' : 'sending', scheduledAt: at ?? null })
    .where(and(eq(campaigns.id, id), inArray(campaigns.status, ['draft', 'scheduled'])))
    .returning();
  if (!row) throw new NewsletterError('invalid_state', 'campaign is not a draft');
  const dedupeKey = `newsletter.batch:${id}`;
  // Si ya estaba programada, la tarea pendiente tiene la misma clave y ganaría con su fecha antigua: se mueve a la nueva
  // (ahora, con "Enviar ya").
  await db.update(jobs).set({ runAt: at ?? new Date() }).where(and(eq(jobs.dedupeKey, dedupeKey), eq(jobs.status, 'queued')));
  await sendBatchJob.enqueue({ campaignId: id }, { runAt: at, dedupeKey }, db);
  return row;
}

export async function cancelCampaign(id: string, db: Executor = getDb()): Promise<void> {
  await db.update(campaigns).set({ status: 'cancelled' }).where(and(eq(campaigns.id, id), inArray(campaigns.status, ['scheduled', 'sending'])));
}

export const BATCH_SIZE = 100;
/** Una reserva `sending` más vieja que esto es de un lote que murió (el job dura como mucho 10 min): se reintenta. */
export const STALE_CLAIM_MS = 15 * 60_000;

/**
 * Lote: prepara destinatarios la primera vez, reserva hasta BATCH_SIZE de forma atómica (dos lotes a la vez nunca toman
 * el mismo destinatario), envía y se reencola si quedan. El siguiente lote usa una clave estable (`…:<n>`): si dos
 * lotes del mismo turno acaban a la vez, solo se encola uno.
 */
export const sendBatchJob = defineJob(
  'newsletter.send-batch',
  z.object({ campaignId: z.string(), seq: z.number().int().min(0).optional() }),
  async ({ campaignId, seq = 0 }, { signal }) => {
    const db = getDb();
    const [c] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c || c.status === 'cancelled' || c.status === 'sent' || c.status === 'draft') return;
    if (c.status === 'scheduled') await db.update(campaigns).set({ status: 'sending' }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'scheduled')));
    // Destinatarios: activos (con alguna de las etiquetas, si hay). INSERT … SELECT idempotente.
    const tagFilter = c.tags.length ? sql` and s.tags ?| ${sql.raw(`array[${c.tags.map((t) => `'${t.replace(/[^a-z0-9-]/g, '')}'`).join(',')}]`)}` : sql``;
    await db.execute(
      sql`insert into newsletter_sends (campaign_id, subscriber_id) select ${campaignId}, s.id from subscribers s where s.status = 'active'${tagFilter} on conflict do nothing`,
    );
    const stale = new Date(Date.now() - STALE_CLAIM_MS);
    const claimed = await db
      .update(campaignSends)
      .set({ status: 'sending', claimedAt: new Date() })
      .where(
        and(
          eq(campaignSends.campaignId, campaignId),
          sql`${campaignSends.subscriberId} in (select subscriber_id from newsletter_sends where campaign_id = ${campaignId} and (status = 'queued' or (status = 'sending' and claimed_at < ${stale.toISOString()}::timestamptz)) limit ${BATCH_SIZE} for update skip locked)`,
        ),
      )
      .returning({ subscriberId: campaignSends.subscriberId });
    const batch = claimed.length
      ? await db
          .select({ subscriberId: subscribers.id, email: subscribers.email, locale: subscribers.locale, status: subscribers.status })
          .from(subscribers)
          .where(inArray(subscribers.id, claimed.map((r) => r.subscriberId)))
      : [];
    const from = env('NEWSLETTER_FROM');
    let sent = 0;
    let failed = 0;
    const done = new Set<string>();
    for (const r of batch) {
      if (signal.aborted) break;
      let status: 'sent' | 'failed' = 'sent';
      let error: string | null = null;
      if (r.status !== 'active') {
        status = 'failed';
        error = `subscriber ${r.status}`;
      } else {
        try {
          const m = await renderCampaign(c, { id: r.subscriberId, email: r.email, locale: r.locale });
          await getNewsletterSender().send({ from, to: r.email, ...m });
        } catch (e) {
          status = 'failed';
          error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        }
      }
      status === 'sent' ? sent++ : failed++;
      done.add(r.subscriberId);
      await db
        .update(campaignSends)
        .set({ status, error, sentAt: status === 'sent' ? new Date() : null })
        .where(and(eq(campaignSends.campaignId, campaignId), eq(campaignSends.subscriberId, r.subscriberId)));
    }
    // Reservas que no se llegaron a enviar (tarea abortada): vuelven a la cola.
    const undone = claimed.map((r) => r.subscriberId).filter((id) => !done.has(id));
    if (undone.length)
      await db
        .update(campaignSends)
        .set({ status: 'queued', claimedAt: null })
        .where(and(eq(campaignSends.campaignId, campaignId), eq(campaignSends.status, 'sending'), inArray(campaignSends.subscriberId, undone)));
    if (sent || failed)
      await db
        .update(campaigns)
        .set({ sentCount: sql`${campaigns.sentCount} + ${sent}`, failedCount: sql`${campaigns.failedCount} + ${failed}` })
        .where(eq(campaigns.id, campaignId));
    const left = await db
      .select({ status: campaignSends.status, n: sql<number>`count(*)`.mapWith(Number) })
      .from(campaignSends)
      .where(and(eq(campaignSends.campaignId, campaignId), inArray(campaignSends.status, ['queued', 'sending'])))
      .groupBy(campaignSends.status);
    const queued = left.find((l) => l.status === 'queued')?.n ?? 0;
    const sending = left.find((l) => l.status === 'sending')?.n ?? 0;
    const next = { campaignId, seq: seq + 1 };
    const dedupeKey = `newsletter.batch:${campaignId}:${seq + 1}`;
    if (queued > 0) await sendBatchJob.enqueue(next, { dedupeKey });
    // Solo quedan reservas de otro lote en curso: él terminará; por si murió, se vuelve a mirar cuando caduquen.
    else if (sending > 0) await sendBatchJob.enqueue(next, { dedupeKey, runAt: new Date(Date.now() + STALE_CLAIM_MS) });
    // `where status = 'sending'`: no pisa una campaña cancelada mientras tanto.
    else await db.update(campaigns).set({ status: 'sent', sentAt: new Date() }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'sending')));
  },
  { timeoutMs: 10 * 60_000, maxAttempts: 10 },
);
