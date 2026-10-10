export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SELF?: Fetcher; // ربط الـ Worker بنفسه (انظر wrangler.jsonc)
  PROVIDER: string;
  DAILY_REQUEST_LIMIT: string;
  LIVE_POLL_SECONDS: string;
  VAPID_SUBJECT: string;
  // ميزات حسب خطة البيانات (يضبطها ملف النشر تلقائياً)
  STANDINGS_ENABLED?: string; // "false" لإخفاء جداول الترتيب وصفحات مباريات البطولة
  DATE_WINDOW_DAYS?: string; // عدد الأيام المتاحة قبل وبعد اليوم
  // أسرار اختيارية (wrangler secret put ...). مفاتيح VAPID تُولَّد تلقائياً إن لم تُضبط
  API_FOOTBALL_KEY?: string;
  FOOTBALL_DATA_KEY?: string;
  // "true": لا يتصل الخادم بـ API-Football مباشرة (مرفوض من Cloudflare)؛ تصله البيانات عبر مهمة GitHub (af-relay)
  AF_VIA_RELAY?: string; // مزوّد ثانٍ اختياري: جداول الترتيب ومباريات الأيام القادمة
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}
