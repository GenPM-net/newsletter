// Tokens firmados (sin estado) para confirmar y darse de baja: `<sub>.<kind>.<exp>.<hmac>`.

const enc = new TextEncoder();

function secret(): string {
  const s = process.env.NEWSLETTER_SECRET;
  if (!s || s.length < 32) throw new Error('NEWSLETTER_SECRET must be set (>= 32 chars)');
  return s;
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
  return btoa(String.fromCharCode(...sig)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export type TokenKind = 'confirm' | 'unsubscribe';

/** Confirmación: caduca en 7 días. Baja: no caduca (los enlaces de emails antiguos deben seguir funcionando). */
export async function makeToken(subscriberId: string, kind: TokenKind): Promise<string> {
  const exp = kind === 'confirm' ? Math.floor(Date.now() / 1000) + 7 * 86_400 : 0;
  const body = `${subscriberId}.${kind}.${exp}`;
  return `${body}.${await hmac(body)}`;
}

export async function readToken(token: string | null | undefined, kind: TokenKind): Promise<string | null> {
  const parts = (token ?? '').split('.');
  if (parts.length !== 4) return null;
  const [id, k, exp, sig] = parts as [string, string, string, string];
  const expected = await hmac(`${id}.${k}.${exp}`);
  let diff = sig.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= (sig.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  if (diff !== 0 || k !== kind) return null;
  if (Number(exp) !== 0 && Number(exp) * 1000 < Date.now()) return null;
  return id;
}
