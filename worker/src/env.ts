export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PROVIDER: string;
  DAILY_REQUEST_LIMIT: string;
  LIVE_POLL_SECONDS: string;
  VAPID_SUBJECT: string;
  // أسرار (wrangler secret put ...)
  API_FOOTBALL_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}
