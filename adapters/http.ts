// Rutas públicas: POST /subscribe; GET y POST /confirm?token=; GET y POST /unsubscribe?token=.
// Los GET solo pintan una página con un botón que hace POST: los escáneres de enlaces del correo (que abren cada URL)
// no confirman ni dan de baja a nadie. El POST de un clic de RFC 8058 (`List-Unsubscribe=One-Click`) sigue funcionando.
import { confirmSubscription, NewsletterError, subscribe, unsubscribe } from '../index.ts';
import { readToken, type TokenKind } from '../tokens.ts';

export type NewsletterPages = { confirmed: string; unsubscribed: string; invalid: string };
const DEFAULT_PAGES: NewsletterPages = { confirmed: '/newsletter/confirmed', unsubscribed: '/newsletter/unsubscribed', invalid: '/newsletter/invalid' };
/** Vuelve a la página con `?newsletter=pending|<error>#newsletter` (el formulario muestra el aviso). */
function backWith(back: URL, result: string): Response {
  back.searchParams.set('newsletter', result);
  back.hash = 'newsletter';
  return new Response(null, { status: 303, headers: { location: back.toString() } });
}

/** Textos de las páginas intermedias (traducibles con la opción `texts`). */
export type NewsletterPageTexts = { confirmTitle: string; confirmButton: string; unsubscribeTitle: string; unsubscribeButton: string };
const DEFAULT_TEXTS: NewsletterPageTexts = {
  confirmTitle: 'Confirm your subscription',
  confirmButton: 'Confirm subscription',
  unsubscribeTitle: 'Unsubscribe from the newsletter',
  unsubscribeButton: 'Unsubscribe',
};
const escHtml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/** Página mínima con un botón que repite la petición como POST (con el mismo token). */
function actionPage(req: Request, kind: TokenKind, texts: Partial<NewsletterPageTexts>): Response {
  const t = { ...DEFAULT_TEXTS, ...texts };
  const [title, button] = kind === 'confirm' ? [t.confirmTitle, t.confirmButton] : [t.unsubscribeTitle, t.unsubscribeButton];
  const action = `?token=${encodeURIComponent(new URL(req.url).searchParams.get('token') ?? '')}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escHtml(title)}</title></head><body><main><h1>${escHtml(title)}</h1><form method="post" action="${escHtml(action)}"><input type="hidden" name="via" value="page"><button type="submit">${escHtml(button)}</button></form></main></body></html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
      'content-security-policy': "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
    },
  });
}

const redirect = (to: string) => new Response(null, { status: 303, headers: { location: to } });

/** Envío HTML clásico (sin JavaScript) desde una página del mismo sitio: URL a la que volver, o null. */
function backUrl(req: Request, isJson: boolean): URL | null {
  if (isJson || !(req.headers.get('accept') ?? '').includes('text/html')) return null;
  const ref = req.headers.get('referer');
  if (!ref) return null;
  try {
    const u = new URL(ref);
    return u.host === new URL(req.url).host ? u : null;
  } catch {
    return null;
  }
}

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
    const back = backUrl(req, isJson);
    if (back) return backWith(back, 'pending');
    return Response.json({ ok: true }, { status: 202 });
  } catch (e) {
    if (e instanceof NewsletterError) {
      const back = backUrl(req, isJson);
      return back ? backWith(back, e.code) : Response.json({ error: e.code }, { status: e.code === 'rate_limited' ? 429 : 400 });
    }
    throw e;
  }
}

/** GET: página con el botón (si el token es válido). POST: confirma y redirige a `pages.confirmed`. */
export async function handleConfirm(req: Request, pages: Partial<NewsletterPages> = {}, texts: Partial<NewsletterPageTexts> = {}): Promise<Response> {
  const p = { ...DEFAULT_PAGES, ...pages };
  const token = new URL(req.url).searchParams.get('token');
  if (req.method !== 'POST') return (await readToken(token, 'confirm')) ? actionPage(req, 'confirm', texts) : redirect(p.invalid);
  try {
    await confirmSubscription(token);
    return redirect(p.confirmed);
  } catch (e) {
    if (e instanceof NewsletterError) return redirect(p.invalid);
    throw e;
  }
}

/**
 * GET: página con el botón (si el token es válido). POST desde esa página: baja y redirige a `pages.unsubscribed`.
 * Cualquier otro POST es la baja en un clic de RFC 8058 (desde el cliente de correo): 200/400 sin redirigir.
 */
export async function handleUnsubscribe(req: Request, pages: Partial<NewsletterPages> = {}, texts: Partial<NewsletterPageTexts> = {}): Promise<Response> {
  const p = { ...DEFAULT_PAGES, ...pages };
  const token = new URL(req.url).searchParams.get('token');
  if (req.method !== 'POST') return (await readToken(token, 'unsubscribe')) ? actionPage(req, 'unsubscribe', texts) : redirect(p.invalid);
  const form = (req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded') ? await req.formData().catch(() => null) : null;
  const fromPage = form?.get('via') === 'page';
  try {
    await unsubscribe(token);
    return fromPage ? redirect(p.unsubscribed) : new Response(null, { status: 200 });
  } catch (e) {
    if (e instanceof NewsletterError) return fromPage ? redirect(p.invalid) : new Response(null, { status: 400 });
    throw e;
  }
}
