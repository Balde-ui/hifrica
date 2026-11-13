// Propriétaire : Dev A
// La signature des webhooks vit dans @hifrica/shared, pour que le moteur (envoi) et l'API (réception, C6)
// appliquent exactement la même règle. Ce fichier ne fait que la réexporter.
export { signWebhook, verifyWebhookSignature } from "@hifrica/shared/webhook-signature";
