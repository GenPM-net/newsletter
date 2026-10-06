// Envío con cabeceras de baja en un clic (RFC 8058, exigidas por Gmail y Yahoo a remitentes masivos).
// Con RESEND_API_KEY usa la API de Resend directamente (admite cabeceras); si no, el proveedor de @core/email
// (sin cabeceras: solo para desarrollo).
import { getEmailProvider } from '../email/index.js';

export type NewsletterMessage = { from: string; to: string; subject: string; html: string; text: string; headers: Record<string, string> };

export interface NewsletterSender {
  readonly name: string;
  send(m: NewsletterMessage): Promise<void>;
}

export function resendSender(apiKey: string, fetchImpl: typeof fetch = fetch): NewsletterSender {
  return {
    name: 'resend',
    async send(m) {
      const res = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: m.from, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

export function emailProviderSender(): NewsletterSender {
  return {
    name: 'email-provider',
    send: async (m) => void (await getEmailProvider().send({ from: m.from, to: m.to, subject: m.subject, html: m.html, text: m.text })),
  };
}

let current: NewsletterSender | null = null;

export function getNewsletterSender(): NewsletterSender {
  current ??= process.env.RESEND_API_KEY ? resendSender(process.env.RESEND_API_KEY) : emailProviderSender();
  return current;
}

export function setNewsletterSender(s: NewsletterSender): void {
  current = s;
}
