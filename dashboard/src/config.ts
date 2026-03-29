/**
 * Dashboard = http://localhost/app (reverse proxy).
 * Tickets = Chatwoot: self-hosted can be iframed (same nginx host); Chatwoot Cloud (app.chatwoot.com)
 * cannot be embedded — UI falls back to “open in new tab” only.
 * Optional: VITE_CHATWOOT_OPEN_URL = full inbox URL for the button when using Cloud.
 */
export const EXTERNAL_APP_URLS = {
  CHATWOOT: import.meta.env.VITE_CHATWOOT_URL ?? 'http://localhost',
  /** Primary “Open Chatwoot” / inbox link (e.g. deep link to inbox). */
  CHATWOOT_OPEN: import.meta.env.VITE_CHATWOOT_OPEN_URL ?? import.meta.env.VITE_CHATWOOT_URL ?? 'http://localhost',
  /** Optional second inbox tab link (same account, different inbox id). */
  CHATWOOT_OPEN_2: import.meta.env.VITE_CHATWOOT_OPEN_URL_2 ?? '',
  TWENTY: import.meta.env.VITE_TWENTY_URL ?? 'http://localhost:3002',
} as const;
