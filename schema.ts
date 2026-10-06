// Tablas de @core/newsletter. Las recoge drizzle-kit vía src/lib/db/drizzle.config.ts.
import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { primaryId, timestamps } from '../db/index.js';
import type { Doc } from '../rich-text/index.js';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const subscribers = pgTable(
  'subscribers',
  {
    id: primaryId('nsb'),
    /** Normalizado (minúsculas, sin espacios). Necesario para enviar; protégelo como dato personal. */
    email: text('email').notNull().unique(),
    status: text('status', { enum: ['pending', 'active', 'unsubscribed', 'bounced', 'complained'] })
      .notNull()
      .default('pending'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    locale: text('locale'),
    /** Dónde se suscribió (`footer`, `blog-post`, `landing:spring`). */
    source: text('source'),
    /** Versión del texto de consentimiento aceptado y fechas (prueba RGPD). */
    consentVersion: text('consent_version'),
    consentAt: ts('consent_at'),
    confirmedAt: ts('confirmed_at'),
    unsubscribedAt: ts('unsubscribed_at'),
    ...timestamps,
  },
  (t) => [index('subscribers_status_idx').on(t.status)],
);

export const campaigns = pgTable('newsletter_campaigns', {
  id: primaryId('cmp'),
  subject: text('subject').notNull(),
  preheader: text('preheader'),
  body: jsonb('body').$type<Doc>().notNull(),
  /** Solo suscriptores con alguna de estas etiquetas; vacío = todos los activos. */
  tags: jsonb('tags').$type<string[]>().notNull().default([]),
  status: text('status', { enum: ['draft', 'scheduled', 'sending', 'sent', 'cancelled'] })
    .notNull()
    .default('draft'),
  scheduledAt: ts('scheduled_at'),
  sentAt: ts('sent_at'),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  ...timestamps,
});

/** Un envío por (campaña, suscriptor): hace los lotes reanudables e impide duplicados. */
export const campaignSends = pgTable(
  'newsletter_sends',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id, { onDelete: 'cascade' }),
    subscriberId: text('subscriber_id')
      .notNull()
      .references(() => subscribers.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['queued', 'sent', 'failed'] })
      .notNull()
      .default('queued'),
    error: text('error'),
    sentAt: ts('sent_at'),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.subscriberId] }), index('newsletter_sends_status_idx').on(t.campaignId, t.status)],
);

export type Subscriber = typeof subscribers.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
