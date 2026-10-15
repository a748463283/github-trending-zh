-- 0001_init.sql —— 用户 / 收藏 / 会话（D1 / SQLite）
-- 适用命令：
--   npx wrangler d1 migrations apply github-trending-zh-users --local
--   npx wrangler d1 migrations apply github-trending-zh-users --remote

CREATE TABLE IF NOT EXISTS users (
  github_id       TEXT PRIMARY KEY,
  login           TEXT NOT NULL,
  name            TEXT,
  avatar          TEXT,
  html_url        TEXT,
  created_at      TEXT NOT NULL,
  last_login_at   TEXT,
  public_profile  INTEGER NOT NULL DEFAULT 1,
  bili_mid        TEXT,
  bili_code       TEXT,
  bili_verified   INTEGER NOT NULL DEFAULT 0,
  bili_label      TEXT,
  bili_sign       TEXT,
  bili_reason     TEXT,
  bili_linked_at  TEXT,
  bili_checked_at TEXT
);

-- GitHub 登录名不区分大小写，故用 NOCASE 唯一索引
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login ON users (login COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS favorites (
  github_id      TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  name           TEXT,
  owner          TEXT,
  url            TEXT,
  avatar         TEXT,
  stars          INTEGER NOT NULL DEFAULT 0,
  language       TEXT,
  description    TEXT,
  description_zh TEXT,
  topics         TEXT,            -- JSON 数组字符串
  saved_at       TEXT NOT NULL,
  PRIMARY KEY (github_id, full_name)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites (github_id, saved_at DESC);
