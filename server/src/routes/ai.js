// ============================================================================
// AI 分析代理：POST /api/ai/analyze
//
// 客户端 Proxy 模式调用此接口（服务端持有 GLM key，控制会员额度）。
// 流程：HMAC 校验 → 查会员状态 → 查/扣月度额度 → 调 GLM → 返回 AiReport
//
// 与客户端 src-tauri/src/ai_cleaner/prompt.rs 的 prompt 保持一致。
// ============================================================================

import { db, stmts } from '../db.js';
import { config } from '../config.js';
import { verifyAppSign } from '../crypto.js';

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function jsonError(reply, status, error, message) {
  return reply.status(status).send({ error, message });
}

// ============================================================================
// Prompt（与 Rust 端 prompt.rs 保持一致）
// ============================================================================

const SYSTEM_PROMPT = `你是 Windows 磁盘清理安全顾问。用户的 C 盘空间不足，需要你分析一批"证据"（目录信息），判断每一条是否可以安全删除。

# 你的任务
针对每条证据，给出 verdict（判定）、confidence（置信度 0~1）和 reasoning（中文理由）。

# 判定标准
- safe_to_delete（安全删除）：高置信度的残留/缓存。例如：卸载残留（无 exe、无注册表项、长期未访问）、可重新生成的缓存（HuggingFace hub、pip cache、IDE 缓存、GPU shader cache）。
- likely_safe（大概率安全）：例如长期（>180天）未活动项目的 .venv / node_modules，删除前建议用户确认项目是否还要用。
- needs_user_decision（需用户决定）：大体积 AI 模型（如 Ollama / HuggingFace 下载的大模型），删除后需重新下载（耗时数小时）。让用户自己权衡。
- keep（保留）：系统目录、正在使用的数据、近期（<30天）频繁访问的目录。

# 重要安全原则
1. 路径已脱敏：<USER> 是用户名占位符，<P1><P2> 是项目/应用名占位符。你不知道真实名字，只能依据结构和元数据判断。
2. 宁可保守：拿不准就给 needs_user_decision 或 keep，绝不轻易 safe_to_delete。
3. AI 模型（size_mb 很大 + meta.tool 是 ollama/huggingface 等）默认 needs_user_decision，除非 last_access_days > 180。
4. 看 last_access_days / last_modified_days：越久未用越可能可删。
5. node_modules / .venv：看 meta.parent_last_modified_days，父项目越久没动越可能可删。

# 输出格式（严格 JSON，不要任何额外文字）
{
  "summary": "一句话中文总结，例如：发现 12 项可优化，预计释放 23 GB",
  "decisions": [
    {
      "path": "<与输入证据 path 完全一致>",
      "verdict": "safe_to_delete | likely_safe | needs_user_decision | keep",
      "confidence": 0.0~1.0,
      "reasoning": "中文判定理由，简洁说明依据",
      "size_mb": <透传输入的 size_mb>,
      "category": "<透传输入的 type>"
    }
  ]
}`;

// ============================================================================
// 路由
// ============================================================================

export default async function aiApi(fastify) {
  // /api/ai/* 也走 HMAC 校验（client API 的 preHandler 已覆盖 /api/ 前缀，
  // 但本路由可能单独注册，这里兜底再校验一次）
  fastify.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/ai/')) return;
    const sign = req.headers['x-app-sign'];
    const rawBody = req.rawBody || '';
    if (!verifyAppSign(Buffer.from(rawBody, 'utf8'), sign)) {
      return jsonError(reply, 401, 'bad_signature', '请求签名校验失败');
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/ai/analyze  { fingerprint, evidence }
  // ---------------------------------------------------------------------------
  fastify.post('/api/ai/analyze', async (req, reply) => {
    const { fingerprint, evidence } = req.body || {};
    if (!fingerprint || !evidence) {
      return jsonError(reply, 400, 'invalid_request', '缺少 fingerprint 或 evidence');
    }

    // 1. 检查 Proxy 模式是否启用
    if (!config.ai.glmApiKey) {
      return jsonError(
        reply,
        503,
        'proxy_disabled',
        '服务端未配置 GLM API Key，请在客户端使用自带 Key 模式',
      );
    }

    // 2. 校验会员（按指纹查活跃卡密）
    const card = stmts.getCardByFingerprint.get(fingerprint);
    if (!card) {
      logAi(null, fingerprint, evidence, 'no_membership');
      return jsonError(reply, 403, 'no_membership', '未检测到有效会员，请先激活卡密');
    }
    // 过期检查
    if (card.expires_at && nowSec() >= card.expires_at) {
      logAi(card.card, fingerprint, evidence, 'expired');
      return jsonError(reply, 403, 'expired', '会员已过期');
    }

    // 3. 月度额度
    const month = currentMonth();
    const quota = config.ai.monthlyQuota;
    if (quota > 0) {
      const used = stmts.getAiUsage.get(card.card, month)?.count || 0;
      if (used >= quota) {
        logAi(card.card, fingerprint, evidence, 'quota_exceeded');
        return jsonError(
          reply,
          429,
          'quota_exceeded',
          `本月 AI 分析额度已用完（${quota} 次），下月重置或使用自带 Key 模式`,
        );
      }
    }

    // 4. 调 GLM
    let report;
    try {
      report = await callGlm(evidence);
    } catch (e) {
      logAi(card.card, fingerprint, evidence, 'llm_error');
      fastify.log.error(`GLM 调用失败: ${e.message}`);
      return jsonError(reply, 502, 'llm_error', `AI 分析失败: ${e.message}`);
    }

    // 5. 扣额度 + 记日志
    stmts.upsertAiUsage.run({ card: card.card, month, last_used_at: nowSec() });
    logAi(card.card, fingerprint, evidence, 'success');

    // 6. 直接返回 AiReport（客户端解析为 AiReport）
    return reply.send(report);
  });
}

// ============================================================================
// 调 GLM（OpenAI 兼容）
// ============================================================================

async function callGlm(evidence) {
  const userContent = `# 待分析证据\n${JSON.stringify(evidence)}`;
  const body = {
    model: config.ai.glmModel,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  };

  const resp = await fetch(config.ai.glmEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ai.glmApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GLM HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new Error('GLM 返回空内容');

  // 剥 code fence 容错
  const cleaned = stripFence(content);
  let report;
  try {
    report = JSON.parse(cleaned);
  } catch (e) {
    throw new Error(`GLM 输出非合法 JSON: ${cleaned.slice(0, 150)}`);
  }
  if (!report.decisions || !Array.isArray(report.decisions)) {
    throw new Error('GLM 输出缺少 decisions 数组');
  }
  return report;
}

function stripFence(s) {
  const t = s.trim();
  if (t.startsWith('```json')) return t.slice(7).replace(/```$/, '').trim();
  if (t.startsWith('```')) return t.slice(3).replace(/```$/, '').trim();
  return t;
}

function logAi(card, fingerprint, evidence, result) {
  try {
    stmts.insertAiLog.run({
      card,
      fingerprint,
      evidence_count: Array.isArray(evidence?.evidence) ? evidence.evidence.length : null,
      result,
      tokens_in: null,
      tokens_out: null,
      created_at: nowSec(),
    });
  } catch (e) {
    // 日志失败不阻塞主流程
  }
}
