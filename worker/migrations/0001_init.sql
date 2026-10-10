-- ذاكرة مؤقتة لردود مزوّد البيانات (لتوفير الطلبات)
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- عدد الطلبات المستهلكة يومياً (بتوقيت UTC)
CREATE TABLE IF NOT EXISTS usage (
  day TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);

-- اشتراكات التنبيهات (Web Push)
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  prefs TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- آخر حالة معروفة لكل مباراة (لاكتشاف الأهداف وبداية/نهاية المباريات)
CREATE TABLE IF NOT EXISTS match_state (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  kickoff INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_match_state_status ON match_state(status);
CREATE INDEX IF NOT EXISTS idx_match_state_kickoff ON match_state(kickoff);

-- قيم عامة (مثل وقت آخر فحص للمباريات المباشرة)
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
