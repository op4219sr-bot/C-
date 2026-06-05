// ============================================================================
// 客户端 API：/api/activate /api/unbind /api/card_info
//
// 所有请求都带 X-App-Sign 头（HMAC-SHA256(body, APP_SIGN_SECRET) hex）
// ============================================================================

import crypto from 'node:crypto';
import { stmts } from '../db.js';
import {
  normalizeCard,
  signLicenseToken,
  validateCardFormat,
  verifyAppSign,
} from '../crypto.js';

const DAY_MS = 86400 * 1000;

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function jsonError(reply, status, error, message) {
  return reply.status(status).send({ error, message });
}

/** HMAC 中间件 */
async function verifyHmac(req, reply) {
  // 注意：req.rawBody 由 fastify addContentTypeParser 提供（见 index.js）
  const sign = req.headers['x-app-sign'];
  const rawBody = req.rawBody || '';
  if (!verifyAppSign(Buffer.from(rawBody, 'utf8'), sign)) {
    return jsonError(reply, 401, 'bad_signature', '请求签名校验失败');
  }
}

export default async function clientApi(fastify) {
  // 所有 /api/* 路由统一校验签名
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    return verifyHmac(req, reply);
  });

  // ---------------------------------------------------------------------------
  // POST /api/activate
  // ---------------------------------------------------------------------------
  fastify.post('/api/activate', async (req, reply) => {
    const { card: rawCard, fingerprint, version } = req.body || {};
    if (!rawCard || !fingerprint) {
      return jsonError(reply, 400, 'invalid_request', '缺少 card 或 fingerprint');
    }
    const card = normalizeCard(rawCard);
    if (!validateCardFormat(card)) {
      return jsonError(reply, 400, 'invalid_card_format', '卡密格式不正确');
    }

    const row = stmts.getCardByCode.get(card);
    if (!row) {
      logActivation(card, fingerprint, req, 'invalid');
      return jsonError(reply, 404, 'invalid_card', '卡密不存在');
    }
    if (row.status === 'disabled') {
      logActivation(card, fingerprint, req, 'disabled');
      return jsonError(
        reply,
        403,
        'card_disabled',
        row.disabled_reason || '该卡密已被禁用',
      );
    }
    if (row.valid_until && Date.now() > row.valid_until && row.status === 'unused') {
      logActivation(card, fingerprint, req, 'expired_before_use');
      return jsonError(reply, 410, 'card_expired_before_use', '该卡密已超过有效激活期');
    }

    // 已激活的卡密
    if (row.status === 'active' || row.status === 'expired') {
      if (row.fingerprint !== fingerprint) {
        logActivation(card, fingerprint, req, 'already_bound');
        return jsonError(
          reply,
          409,
          'already_bound',
          '该卡密已绑定到其他设备，请联系客服解绑',
        );
      }
      // 同机重复激活：补发当前 token
      if (row.status === 'expired') {
        logActivation(card, fingerprint, req, 'expired');
        return jsonError(reply, 410, 'card_expired', '该卡密已过期');
      }
      const token = issueToken(row);
      logActivation(card, fingerprint, req, 'reactivate');
      return reply.send({
        token,
        tier: row.tier,
        expires_at: row.expires_at,
      });
    }

    // 全新激活
    const activated_at = nowSec();
    const expires_at = activated_at + row.duration_days * 86400;

    const result = stmts.activateCard.run({
      card,
      activated_at,
      expires_at,
      fingerprint,
    });
    if (result.changes === 0) {
      // 并发激活（极少见）
      logActivation(card, fingerprint, req, 'race_condition');
      return jsonError(reply, 409, 'race_condition', '激活冲突，请重试');
    }

    const refreshed = stmts.getCardByCode.get(card);
    const token = issueToken(refreshed);
    logActivation(card, fingerprint, req, 'success');

    return reply.send({
      token,
      tier: refreshed.tier,
      expires_at: refreshed.expires_at,
    });
  });

  // ---------------------------------------------------------------------------
  // POST /api/unbind  { fingerprint, reason? }
  // 仅允许客户端解绑当前机器上正在使用的卡密
  // ---------------------------------------------------------------------------
  fastify.post('/api/unbind', async (req, reply) => {
    const { fingerprint, reason } = req.body || {};
    if (!fingerprint) {
      return jsonError(reply, 400, 'invalid_request', '缺少 fingerprint');
    }

    const row = stmts.getCardByFingerprint.get(fingerprint);
    if (!row) {
      // 没找到也返回 ok（幂等）
      return reply.send({ ok: true, message: '当前机器无活跃卡密' });
    }

    stmts.unbindCard.run({ card: row.card });
    stmts.insertUnbindLog.run({
      card: row.card,
      old_fingerprint: fingerprint,
      reason: reason || null,
      source: 'user',
      approved_by: null,
      created_at: nowSec(),
    });

    return reply.send({ ok: true, ticket_id: null });
  });

  // ---------------------------------------------------------------------------
  // GET /api/card_info?card=xxx  用户自查
  // ---------------------------------------------------------------------------
  fastify.get('/api/card_info', async (req, reply) => {
    const raw = req.query?.card;
    if (!raw) return jsonError(reply, 400, 'invalid_request', '缺少 card');
    const card = normalizeCard(String(raw));
    if (!validateCardFormat(card))
      return jsonError(reply, 400, 'invalid_card_format', '卡密格式不正确');

    const row = stmts.getCardByCode.get(card);
    if (!row) return jsonError(reply, 404, 'invalid_card', '卡密不存在');

    return reply.send({
      tier: row.tier,
      status: row.status,
      expires_at: row.expires_at,
      activated_at: row.activated_at,
    });
  });
}

// ============================================================================
// 内部工具
// ============================================================================

function issueToken(row) {
  const claims = {
    card_id: row.card_id,
    tier: row.tier,
    fingerprint: row.fingerprint,
    issued_at: nowSec(),
    expires_at: row.expires_at,
    version: 1,
  };
  return signLicenseToken(claims);
}

function logActivation(card, fingerprint, req, result) {
  stmts.insertActivation.run({
    card,
    fingerprint,
    ip: req.ip || null,
    user_agent: req.headers['user-agent'] || null,
    result,
    created_at: nowSec(),
  });
}
