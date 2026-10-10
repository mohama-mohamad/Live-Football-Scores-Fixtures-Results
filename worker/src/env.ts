export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  PROVIDER: string;
  DAILY_REQUEST_LIMIT: string;
  LIVE_POLL_SECONDS: string;
  VAPID_SUBJECT: string;
  // ميزات حسب خطة البيانات (يضبطها ملف النشر تلقائياً)
  STANDINGS_ENABLED?: string; // "false" لإخفاء جداول الترتيب وصفحات مباريات البطولة
  DATE_WINDOW_DAYS?: string; // عدد الأيام المتاحة قبل وبعد اليوم
  // أسرار اختيارية (wrangler secret put ...). مفاتيح VAPID تُولَّد تلقائياً إن لم تُضبط
  API_FOOTBALL_KEY?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}
