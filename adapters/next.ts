// Adaptador Next.js (route handlers):
//   app/newsletter/subscribe/route.ts   → export { subscribeRoute as POST } from '@/lib/newsletter/adapters/next';
//   app/newsletter/confirm/route.ts     → export { confirmRoute as GET } from '@/lib/newsletter/adapters/next';
//   app/newsletter/unsubscribe/route.ts → export { unsubscribeRoute as GET, unsubscribeRoute as POST } from '@/lib/newsletter/adapters/next';
// y las páginas /newsletter/confirmed, /newsletter/unsubscribed y /newsletter/invalid.
import { handleConfirm, handleSubscribe, handleUnsubscribe } from './http.ts';

export const subscribeRoute = (req: Request) => handleSubscribe(req);
export const confirmRoute = (req: Request) => handleConfirm(req);
export const unsubscribeRoute = (req: Request) => handleUnsubscribe(req);
