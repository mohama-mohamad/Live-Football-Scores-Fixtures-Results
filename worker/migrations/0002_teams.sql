-- ربط الفرق بين مزوّدي البيانات: مفتاح الاسم الموحّد ← معرّف الفريق في API-Football
CREATE TABLE IF NOT EXISTS teams (
  key TEXT PRIMARY KEY,
  af_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  logo TEXT,
  updated_at INTEGER NOT NULL
);
