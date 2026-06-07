// ============================================================================
// 管理后台 API（Basic Auth 保护）
//
//   GET  /admin/api/stats           总览统计
//   GET  /admin/api/cards           卡密列表（支持筛选 / 分页）
//   GET  /admin/api/cards/:card     单卡详情 + 激活记录
//   POST /admin/api/generate        批量生成卡密
//   POST /admin/api/cards/:card/disable    封禁
//   POST /admin/api/cards/:card/enable     解禁（回到 unused）
//   POST /admin/api/cards/:card/unbind     强制解绑（保留 active 状态）
//   POST /admin/api/cards/:card/reset      重置（回到 unused + 清空指纹）
//   GET  /admin/api/activations     激活日志
// ============================================================================

import nodeCrypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { db, stmts } from '../db.js';
import { config } from '../config.js';
import { generateCard, formatCardDisplay, TIER_DAYS } from '../crypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// ---------------------------------------------------------------------------
// Basic Auth 中间件
// ---------------------------------------------------------------------------
function checkBasicAuth(req, reply) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Basic ')) {
    reply.header('WWW-Authenticate', 'Basic realm="LightC Admin"');
    return reply.status(401).send({ error: 'unauthorized' });
  }
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  if (idx < 0) {
    reply.header('WWW-Authenticate', 'Basic realm="LightC Admin"');
    return reply.status(401).send({ error: 'unauthorized' });
  }
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  if (user !== config.admin.user || pass !== config.admin.pass) {
    reply.header('WWW-Authenticate', 'Basic realm="LightC Admin"');
    return reply.status(401).send({ error: 'unauthorized' });
  }
}

export default async function adminApi(fastify) {
  // Basic Auth：保护所有 /admin/* 路由（含静态页和 API）
  fastify.addHook('onRequest', async (req, reply) => {
    return checkBasicAuth(req, reply);
  });

  // 静态后台页面（同样受 Basic Auth 保护）
  await fastify.register(fastifyStatic, {
    root: path.join(__dirname, '..', 'admin'),
    prefix: '/admin/',
    decorateReply: false,
  });

  // ---------------------------------------------------------------------------
  // 统计总览
  // ---------------------------------------------------------------------------
  fastify.get('/admin/api/stats', async () => {
    // 自动把过期 license 标记为 expired
    db.prepare(
      `UPDATE cards SET status='expired' WHERE status='active' AND expires_at < ?`,
    ).run(nowSec());

    const byStatus = {};
    for (const r of stmts.countByStatus.all()) byStatus[r.status] = r.c;

    const byTier = {};
    for (const r of stmts.countByTier.all()) byTier[r.tier] = r.c;

    const monthStart = Math.floor(
      new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime() / 1000,
    );

    const monthActivated = db
      .prepare(`SELECT COUNT(*) AS c FROM cards WHERE activated_at >= ?`)
      .get(monthStart).c;

    const expiringSoon = db
      .prepare(
        `SELECT COUNT(*) AS c FROM cards WHERE status='active' AND expires_at BETWEEN ? AND ?`,
      )
      .get(nowSec(), nowSec() + 7 * 86400).c;

    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);

    return {
      total,
      by_status: byStatus,
      by_tier: byTier,
      month_activated: monthActivated,
      expiring_soon_7d: expiringSoon,
    };
  });

  // ---------------------------------------------------------------------------
  // 卡密列表（筛选 + 分页）
  // ---------------------------------------------------------------------------
  fastify.get('/admin/api/cards', async (req) => {
    const {
      status,
      tier,
      batch,
      keyword,
      page = '1',
      page_size = '50',
    } = req.query || {};
    const where = [];
    const params = {};
    if (status) {
      where.push('status = @status');
      params.status = status;
    }
    if (tier) {
      where.push('tier = @tier');
      params.tier = tier;
    }
    if (batch) {
      where.push('batch = @batch');
      params.batch = batch;
    }
    if (keyword) {
      where.push('(card LIKE @kw OR card_id LIKE @kw OR fingerprint LIKE @kw)');
      params.kw = `%${keyword}%`;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM cards ${whereSql}`)
      .get(params).c;

    const limit = Math.max(1, Math.min(500, Number(page_size) || 50));
    const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
    params.limit = limit;
    params.offset = offset;

    const items = db
      .prepare(
        `SELECT * FROM cards ${whereSql} ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
      )
      .all(params)
      .map((c) => ({ ...c, display: formatCardDisplay(c.card) }));

    return { total, items };
  });

  // ---------------------------------------------------------------------------
  // 单卡详情
  // ---------------------------------------------------------------------------
  fastify.get('/admin/api/cards/:card', async (req, reply) => {
    const card = String(req.params.card).replace(/-/g, '').toUpperCase();
    const row = stmts.getCardByCode.get(card);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    const activations = db
      .prepare(`SELECT * FROM activations WHERE card = ? ORDER BY created_at DESC LIMIT 50`)
      .all(card);
    const unbinds = db
      .prepare(`SELECT * FROM unbind_logs WHERE card = ? ORDER BY created_at DESC LIMIT 50`)
      .all(card);
    return { card: { ...row, display: formatCardDisplay(row.card) }, activations, unbinds };
  });

  // ---------------------------------------------------------------------------
  // 批量生成
  // ---------------------------------------------------------------------------
  fastify.post('/admin/api/generate', async (req, reply) => {
    const { tier, count, batch, valid_until, note } = req.body || {};
    if (!tier || !TIER_DAYS[tier]) {
      return reply.status(400).send({ error: 'invalid_tier' });
    }
    const n = Math.max(1, Math.min(50000, Number(count) || 1));
    const baseSeq = stmts.maxSeqByTier.get(tier).max_seq;
    const created_at = nowSec();
    const inserted = [];

    const tx = db.transaction(() => {
      for (let i = 0; i < n; i++) {
        const seq = baseSeq + i + 1;
        const card = generateCard(tier, seq);
        const card_id = randomUuid();
        stmts.insertCard.run({
          card,
          card_id,
          tier,
          duration_days: TIER_DAYS[tier],
          batch: batch || null,
          created_at,
          valid_until: valid_until ? Number(valid_until) : null,
          seq,
          note: note || null,
        });
        inserted.push(card);
      }
    });
    tx();

    return reply.send({ count: n, cards: inserted.map(formatCardDisplay) });
  });

  // ---------------------------------------------------------------------------
  // 单卡操作
  // ---------------------------------------------------------------------------
  fastify.post('/admin/api/cards/:card/disable', async (req, reply) => {
    const card = String(req.params.card).replace(/-/g, '').toUpperCase();
    const { reason } = req.body || {};
    stmts.disableCard.run({
      card,
      reason: reason || '管理员手动封禁',
      disabled_at: nowSec(),
    });
    return reply.send({ ok: true });
  });

  fastify.post('/admin/api/cards/:card/enable', async (req, reply) => {
    const card = String(req.params.card).replace(/-/g, '').toUpperCase();
    db.prepare(
      `UPDATE cards SET status='unused', disabled_reason=NULL, disabled_at=NULL WHERE card = ?`,
    ).run(card);
    return reply.send({ ok: true });
  });

  fastify.post('/admin/api/cards/:card/unbind', async (req, reply) => {
    const card = String(req.params.card).replace(/-/g, '').toUpperCase();
    const { reason } = req.body || {};
    const row = stmts.getCardByCode.get(card);
    if (!row) return reply.status(404).send({ error: 'not_found' });
    if (!row.fingerprint) return reply.send({ ok: true, message: '卡密未绑定' });

    stmts.unbindCard.run({ card });
    stmts.insertUnbindLog.run({
      card,
      old_fingerprint: row.fingerprint,
      reason: reason || '管理员强制解绑',
      source: 'admin',
      approved_by: 'admin',
      created_at: nowSec(),
    });
    return reply.send({ ok: true });
  });

  fastify.post('/admin/api/cards/:card/reset', async (req, reply) => {
    const card = String(req.params.card).replace(/-/g, '').toUpperCase();
    db.prepare(
      `UPDATE cards
       SET status='unused', activated_at=NULL, expires_at=NULL, fingerprint=NULL,
           disabled_reason=NULL, disabled_at=NULL
       WHERE card = ?`,
    ).run(card);
    return reply.send({ ok: true });
  });

  // ---------------------------------------------------------------------------
  // 激活日志
  // ---------------------------------------------------------------------------
  fastify.get('/admin/api/activations', async (req) => {
    const { card, result, limit = '100' } = req.query || {};
    const where = [];
    const params = {};
    if (card) {
      where.push('card = @card');
      params.card = String(card).replace(/-/g, '').toUpperCase();
    }
    if (result) {
      where.push('result = @result');
      params.result = result;
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.limit = Math.max(1, Math.min(1000, Number(limit) || 100));
    const items = db
      .prepare(
        `SELECT * FROM activations ${whereSql} ORDER BY created_at DESC LIMIT @limit`,
      )
      .all(params);
    return { items };
  });
}

function randomUuid() {
  return nodeCrypto.randomUUID();
}
