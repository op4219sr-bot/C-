// ============================================================================
// 配置加载
// ============================================================================

import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[fatal] 缺少环境变量 ${name}（参考 .env.example）`);
    process.exit(1);
  }
  return v;
}

function hexBuf(hex, expectedLen, name) {
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== expectedLen) {
    console.error(`[fatal] ${name} 长度错误：期望 ${expectedLen} 字节，实际 ${buf.length}`);
    process.exit(1);
  }
  return buf;
}

export const config = {
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8088),

  dbPath: path.resolve(ROOT, process.env.DB_PATH || './data/license.db'),

  privKey: hexBuf(required('LICENSE_PRIVKEY_HEX'), 32, 'LICENSE_PRIVKEY_HEX'),
  pubKey: hexBuf(required('LICENSE_PUBKEY_HEX'), 32, 'LICENSE_PUBKEY_HEX'),
  appSignSecret: hexBuf(required('APP_SIGN_SECRET_HEX'), 32, 'APP_SIGN_SECRET_HEX'),

  admin: {
    user: process.env.ADMIN_USER || 'admin',
    pass: process.env.ADMIN_PASS || 'changeme',
  },

  rateLimitPerMin: Number(process.env.RATE_LIMIT_PER_MIN || 60),
  allowDevCors: (process.env.ALLOW_DEV_CORS || 'false') === 'true',

  ai: {
    glmApiKey: process.env.GLM_API_KEY || '',
    glmEndpoint:
      process.env.GLM_ENDPOINT ||
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    glmModel: process.env.GLM_MODEL || 'glm-4-flash',
    monthlyQuota: Number(process.env.AI_MONTHLY_QUOTA || 30),
  },

  rootDir: ROOT,
};
