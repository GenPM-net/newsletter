// Adaptador Hono: `app.route('/newsletter', newsletterRoutes())`.
import { Hono } from 'hono';
import { handleConfirm, handleSubscribe, handleUnsubscribe, type NewsletterPages, type NewsletterPageTexts } from './http.ts';

export function newsletterRoutes(opts: { pages?: Partial<NewsletterPages>; texts?: Partial<NewsletterPageTexts>; tags?: string[] } = {}) {
  return new Hono()
    .post('/subscribe', (c) => handleSubscribe(c.req.raw, { tags: opts.tags }))
    .get('/confirm', (c) => handleConfirm(c.req.raw, opts.pages, opts.texts))
    .post('/confirm', (c) => handleConfirm(c.req.raw, opts.pages, opts.texts))
    .get('/unsubscribe', (c) => handleUnsubscribe(c.req.raw, opts.pages, opts.texts))
    .post('/unsubscribe', (c) => handleUnsubscribe(c.req.raw, opts.pages, opts.texts));
}
