// ============================================================================
// SQLite 数据库 + 迁移
// ============================================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

// 确保数据目录存在
const dir = path.dirname(config.dbPath);
fs.mkdirSync(dir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================================
// 迁移
// ============================================================================

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  card             TEXT PRIMARY KEY,
  card_id          TEXT NOT NULL UNIQUE,
  tier             TEXT NOT NULL,
  duration_days    INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'unused',
  batch            TEXT,
  created_at       INTEGER NOT NULL,
  valid_until      INTEGER,
  activated_at     INTEGER,
  expires_at       INTEGER,
  fingerprint      TEXT,
  seq              INTEGER NOT NULL,
  note             TEXT,
  disabled_reason  TEXT,
  disabled_at      INTEGER
);

CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
CREATE INDEX IF NOT EXISTS idx_cards_batch  ON cards(batch);
CREATE INDEX IF NOT EXISTS idx_cards_fp     ON cards(fingerprint);
CREATE INDEX IF NOT EXISTS idx_cards_tier   ON cards(tier);

CREATE TABLE IF NOT EXISTS activations (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  card         TEXT NOT NULL,
  fingerprint  TEXT NOT NULL,
  ip           TEXT,
  user_agent   TEXT,
  result       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_act_card ON activations(card);
CREATE INDEX IF NOT EXISTS idx_act_fp   ON activations(fingerprint);
CREATE INDEX IF NOT EXISTS idx_act_time ON activations(created_at);

CREATE TABLE IF NOT EXISTS unbind_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  card             TEXT NOT NULL,
  old_fingerprint  TEXT NOT NULL,
  reason           TEXT,
  source           TEXT NOT NULL DEFAULT 'user',
  approved_by      TEXT,
  created_at       INTEGER NOT NULL
);

-- AI 分析用量（按 卡密 + 月份 计数，控制会员额度）
CREATE TABLE IF NOT EXISTS ai_usage (
  card             TEXT NOT NULL,
  month            TEXT NOT NULL,           -- YYYY-MM
  count            INTEGER NOT NULL DEFAULT 0,
  last_used_at     INTEGER,
  PRIMARY KEY (card, month)
);

-- AI 分析调用日志（审计 + 排查）
CREATE TABLE IF NOT EXISTS ai_logs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  card             TEXT,
  fingerprint      TEXT NOT NULL,
  evidence_count   INTEGER,
  result           TEXT NOT NULL,           -- success / quota_exceeded / no_membership / llm_error
  tokens_in        INTEGER,
  tokens_out       INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_card ON ai_logs(card);
CREATE INDEX IF NOT EXISTS idx_ai_logs_time ON ai_logs(created_at);
`;

export function migrate() {
  db.exec(SCHEMA);
  console.log('[db] 迁移完成');
}

// 启动时自动迁移
migrate();

// CLI 入口：node src/db.js migrate
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('[db] 数据库路径:', config.dbPath);
  process.exit(0);
}

// ============================================================================
// 常用查询封装
// ============================================================================

export const stmts = {
  getCardByCode: db.prepare(`SELECT * FROM cards WHERE card = ?`),
  getCardById: db.prepare(`SELECT * FROM cards WHERE card_id = ?`),
  getCardByFingerprint: db.prepare(
    `SELECT * FROM cards WHERE fingerprint = ? AND status = 'active' ORDER BY activated_at DESC LIMIT 1`,
  ),
  insertCard: db.prepare(`
    INSERT INTO cards (card, card_id, tier, duration_days, status, batch, created_at, valid_until, seq, note)
    VALUES (@card, @card_id, @tier, @duration_days, 'unused', @batch, @created_at, @valid_until, @seq, @note)
  `),
  activateCard: db.prepare(`
    UPDATE cards
    SET status='active', activated_at=@activated_at, expires_at=@expires_at, fingerprint=@fingerprint
    WHERE card=@card AND status='unused'
  `),
  unbindCard: db.prepare(`
    UPDATE cards
    SET status='unused', activated_at=NULL, expires_at=NULL, fingerprint=NULL
    WHERE card=@card
  `),
  expireCard: db.prepare(`UPDATE cards SET status='expired' WHERE card=@card`),
  disableCard: db.prepare(`
    UPDATE cards
    SET status='disabled', disabled_reason=@reason, disabled_at=@disabled_at
    WHERE card=@card
  `),
  insertActivation: db.prepare(`
    INSERT INTO activations (card, fingerprint, ip, user_agent, result, created_at)
    VALUES (@card, @fingerprint, @ip, @user_agent, @result, @created_at)
  `),
  insertUnbindLog: db.prepare(`
    INSERT INTO unbind_logs (card, old_fingerprint, reason, source, approved_by, created_at)
    VALUES (@card, @old_fingerprint, @reason, @source, @approved_by, @created_at)
  `),
  maxSeqByTier: db.prepare(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM cards WHERE tier = ?`),
  countByStatus: db.prepare(`SELECT status, COUNT(*) AS c FROM cards GROUP BY status`),
  countByTier: db.prepare(`SELECT tier, COUNT(*) AS c FROM cards GROUP BY tier`),

  // AI 用量
  getAiUsage: db.prepare(`SELECT count FROM ai_usage WHERE card = ? AND month = ?`),
  upsertAiUsage: db.prepare(`
    INSERT INTO ai_usage (card, month, count, last_used_at)
    VALUES (@card, @month, 1, @last_used_at)
    ON CONFLICT(card, month) DO UPDATE SET
      count = count + 1,
      last_used_at = @last_used_at
  `),
  insertAiLog: db.prepare(`
    INSERT INTO ai_logs (card, fingerprint, evidence_count, result, tokens_in, tokens_out, created_at)
    VALUES (@card, @fingerprint, @evidence_count, @result, @tokens_in, @tokens_out, @created_at)
  `),
  aiUsageThisMonth: db.prepare(`
    SELECT COUNT(*) AS cards, COALESCE(SUM(count), 0) AS total
    FROM ai_usage WHERE month = ?
  `),
};
