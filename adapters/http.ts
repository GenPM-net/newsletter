// Rutas públicas: POST /subscribe, GET /confirm?token=, GET y POST /unsubscribe?token= (POST = baja en un clic).
import { confirmSubscription, NewsletterError, subscribe, unsubscribe } from '../index.js';

export type NewsletterPages = { confirmed: string; unsubscribed: string; invalid: string };
const DEFAULT_PAGES: NewsletterPages = { confirmed: '/newsletter/confirmed', unsubscribed: '/newsletter/unsubscribed', invalid: '/newsletter/invalid' };
const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to } });

export async function handleSubscribe(req: Request, opts: { tags?: string[]; source?: string } = {}): Promise<Response> {
  const isJson = (req.headers.get('content-type') ?? '').includes('application/json');
  const fields: Record<string, unknown> = {};
  if (isJson) Object.assign(fields, await req.json().catch(() => ({})));
  else (await req.formData()).forEach((v, k) => typeof v === 'string' && (fields[k] = v));
  try {
    await subscribe(
      { email: String(fields.email ?? ''), tags: opts.tags, source: String(fields.source ?? opts.source ?? '') || undefined, locale: typeof fields.locale === 'string' ? fields.locale : undefined, consentVersion: typeof fields.consentVersion === 'string' ? fields.consentVersion : undefined },
      { headers: req.headers, fields },
    );
    // Misma respuesta para altas nuevas y existentes.
    return Response.json({ ok: true }, { status: 202 });
  } catch (e) {
    if (e instanceof NewsletterError) return Response.json({ error: e.code }, { status: e.code === 'rate_limited' ? 429 : 400 });
    throw e;
  }
}

export async function handleConfirm(req: Request, pages: Partial<NewsletterPages> = {}): Promise<Response> {
  const p = { ...DEFAULT_PAGES, ...pages };
  try {
    await confirmSubscription(new URL(req.url).searchParams.get('token'));
    return redirect(p.confirmed);
  } catch (e) {
    if (e instanceof NewsletterError) return redirect(p.invalid);
    throw e;
  }
}

/** GET muestra la página de baja hecha; POST (RFC 8058, desde el cliente de correo) responde 200 sin redirigir. */
export async function handleUnsubscribe(req: Request, pages: Partial<NewsletterPages> = {}): Promise<Response> {
  const p = { ...DEFAULT_PAGES, ...pages };
  try {
    await unsubscribe(new URL(req.url).searchParams.get('token'));
    return req.method === 'POST' ? new Response(null, { status: 200 }) : redirect(p.unsubscribed);
  } catch (e) {
    if (e instanceof NewsletterError) return req.method === 'POST' ? new Response(null, { status: 400 }) : redirect(p.invalid);
    throw e;
  }
}
