// @core/newsletter — API pública. Importa desde aquí; rutas públicas en adapters/hono.ts y adapters/next.ts.
export { campaignsAdminResource, newsletterAdminResources, subscribersAdminResource } from './admin.ts';
export {
  BATCH_SIZE,
  cancelCampaign,
  confirmSubscription,
  confirmUrl,
  createCampaign,
  deleteSubscriber,
  markUndeliverable,
  NewsletterError,
  type NewsletterMessages,
  normalizeEmail,
  renderCampaign,
  sendBatchJob,
  sendCampaign,
  sendConfirmationJob,
  setNewsletterMessages,
  subscribe,
  unsubscribe,
  unsubscribeUrl,
  updateCampaign,
} from './newsletter.ts';
export { type Campaign, campaignSends, campaigns, type Subscriber, subscribers } from './schema.ts';
export {
  emailProviderSender,
  getNewsletterSender,
  type NewsletterMessage,
  type NewsletterSender,
  resendSender,
  setNewsletterSender,
} from './sender.ts';
