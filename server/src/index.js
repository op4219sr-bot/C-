// ============================================================================
// LightC License Server 入口
// ============================================================================

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';

import { config } from './config.js';
import './db.js'; // 自动迁移
import clientApi from './routes/api.js';
import adminApi from './routes/admin.js';
import aiApi from './routes/ai.js';

const fastify = Fastify({
  logger: { level: 'info' },
  trustProxy: true,
});

// 抓取原始请求体（用于 HMAC 校验）
fastify.addContentTypeParser(
  'application/json',
  { parseAs: 'string' },
  (req, body, done) => {
    req.rawBody = body;
    try {
      done(null, body ? JSON.parse(body) : {});
    } catch (err) {
      err.statusCode = 400;
      done(err, undefined);
    }
  },
);

// CORS（生产请关闭）
if (config.allowDevCors) {
  await fastify.register(fastifyCors, { origin: true });
}

// 客户端 API
await fastify.register(clientApi);

// AI 分析代理
await fastify.register(aiApi);

// 管理后台（含 API + 静态页 + Basic Auth）
await fastify.register(adminApi);

// 根路径重定向到 admin
fastify.get('/', async (_, reply) => {
  return reply.redirect('/admin/');
});

// 健康检查
fastify.get('/health', async () => ({ ok: true, time: Date.now() }));

// ============================================================================
// 启动
// ============================================================================

try {
  await fastify.listen({ host: config.host, port: config.port });
  console.log('');
  console.log('  🛡️  LightC License Server');
  console.log(`  📍  监听地址：http://${config.host}:${config.port}`);
  console.log(`  🔐  管理后台：http://localhost:${config.port}/admin/（${config.admin.user}/${config.admin.pass.replace(/./g, '*')}）`);
  console.log(`  💾  数据库  ：${config.dbPath}`);
  console.log(`  🤖  AI 代理 ：${config.ai.glmApiKey ? `已启用（${config.ai.glmModel}，月额度 ${config.ai.monthlyQuota || '不限'}）` : '未配置（仅支持客户端自带 Key 模式）'}`);
  console.log('');
  if (config.admin.pass === 'changeme') {
    console.warn('  ⚠️  警告：管理员密码仍为默认值 "changeme"，请尽快在 .env 中修改！');
  }
} catch (err) {
  console.error(err);
  process.exit(1);
}
