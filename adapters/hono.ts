// Adaptador Hono: `app.route('/newsletter', newsletterRoutes())`.
import { Hono } from 'hono';
import { handleConfirm, handleSubscribe, handleUnsubscribe, type NewsletterPages } from './http.js';

export function newsletterRoutes(opts: { pages?: Partial<NewsletterPages>; tags?: string[] } = {}) {
  return new Hono()
    .post('/subscribe', (c) => handleSubscribe(c.req.raw, { tags: opts.tags }))
    .get('/confirm', (c) => handleConfirm(c.req.raw, opts.pages))
    .get('/unsubscribe', (c) => handleUnsubscribe(c.req.raw, opts.pages))
    .post('/unsubscribe', (c) => handleUnsubscribe(c.req.raw, opts.pages));
}
