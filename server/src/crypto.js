// ============================================================================
// 加密相关：Ed25519 签发 token / HMAC 校验 / 卡密生成
//
// 使用 Node 内置 crypto 模块（无需第三方库），与 Rust ed25519-dalek 互通。
// ============================================================================

import crypto from 'node:crypto';
import { config } from './config.js';

// ============================================================================
// Ed25519 签名（签发 license token）
// ============================================================================

// Node crypto 通过 DER 形式的 KeyObject 处理 Ed25519
// 私钥 PKCS8 头部 + 32 字节种子
function rawPrivKeyToKeyObject(rawPriv) {
  if (rawPriv.length !== 32) throw new Error('Ed25519 私钥必须是 32 字节');
  // PKCS8 ED25519 PrivateKey 的 ASN.1 编码（固定前缀）
  const pkcs8Prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const der = Buffer.concat([pkcs8Prefix, rawPriv]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

const privKeyObject = rawPrivKeyToKeyObject(config.privKey);

/** 签发 license token：base64url(claims).base64url(sig) */
export function signLicenseToken(claims) {
  const claimsJson = JSON.stringify(claims);
  const claimsBuf = Buffer.from(claimsJson, 'utf8');
  const sig = crypto.sign(null, claimsBuf, privKeyObject);
  return `${b64url(claimsBuf)}.${b64url(sig)}`;
}

function b64url(buf) {
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// ============================================================================
// HMAC（校验客户端请求签名）
// ============================================================================

export function verifyAppSign(rawBody, signHex) {
  if (!signHex) return false;
  const expected = crypto.createHmac('sha256', config.appSignSecret).update(rawBody).digest('hex');
  // 防时序攻击
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signHex, 'hex'));
  } catch {
    return false;
  }
}

// ============================================================================
// 卡密生成
// ============================================================================

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars, 去除 0/O/1/I/L 易混淆字符
const TIER_CODE = {
  day: 'DA',
  week: 'WK',
  half_month: 'HM',
  quarter: 'QT',
  half_year: 'HY',
  year: 'YR',
};
export const TIER_DAYS = {
  day: 1,
  week: 7,
  half_month: 15,
  quarter: 90,
  half_year: 180,
  year: 365,
};

/** 将 32-bit 整数编码成定长 base27（与 Rust 端一致） */
// 注意：函数名保留 encodeBase27 是历史命名，实际 base = ALPHABET.length = 31
// 必须使用 ALPHABET.length 与 Rust 端 (ALPHABET.len() = 31) 保持一致，
// 否则两端编码 checksum 时基数不同，校验永远失败。
function encodeBase27(value, len) {
  const buf = Buffer.alloc(len);
  let v = BigInt.asUintN(64, BigInt(value));
  const base = BigInt(ALPHABET.length); // 31
  for (let i = len - 1; i >= 0; i--) {
    buf[i] = ALPHABET.charCodeAt(Number(v % base));
    v = v / base;
  }
  return buf.toString('ascii');
}

function randomBase27(len) {
  const bytes = crypto.randomBytes(len);
  let out = '';
  for (const b of bytes) {
    out += ALPHABET[b % ALPHABET.length];
  }
  return out;
}

function crc32(buf) {
  // 简单 CRC32（与 Rust crc32fast IEEE 多项式一致）
  // 关键：`>>> 0` 强制转无符号 32-bit，否则 JS 位运算结果是有符号 i32，
  // 后续 BigInt.asUintN(64) 会把负数当成 2^64 - n 编码，与 Rust 的 u32 不一致。
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 生成一张卡密：
 *   LC + tierCode(2) + seq(6) + random(8) + crc(4) = 22 字符 → 带横线 26
 * crc = CRC32("LC" + tierCode + seq + random)，转 base27 取最后 4 位
 */
/**
 * 生成卡密的 normalized 形式（无横线，22 字符）。
 * 用于 DB 主键存储；展示时通过 formatCardDisplay() 重新加横线。
 */
export function generateCard(tier, seqNum) {
  const tierCode = TIER_CODE[tier];
  if (!tierCode) throw new Error(`未知 tier: ${tier}`);
  const seq = encodeBase27(seqNum, 6);
  const random = randomBase27(8);
  const payload = tierCode + seq + random; // 16
  const crc = crc32(Buffer.from('LC' + payload));
  // 不能用 crc & 0xffffffff！JS 位运算返回 signed i32，
  // 当 crc 高位为 1（值 >= 2^31）时会变负数，BigInt.asUintN(64) 编码错误
  const checksum = encodeBase27(crc >>> 0, 4);
  return 'LC' + payload + checksum; // 22, 无横线
}

/** 把 22 字符 normalized 卡密重新格式化为带横线展示形式：LC-XXXX-XXXX-XXXX-XXXX-XXXX */
export function formatCardDisplay(normalized) {
  if (!normalized || normalized.length !== 22 || !normalized.startsWith('LC')) {
    return normalized;
  }
  return 'LC-' + normalized.slice(2).match(/.{1,4}/g).join('-');
}

/** 卡密格式校验（CRC32 + 字符集） */
export function validateCardFormat(card) {
  const normalized = card.replace(/[-\s]/g, '').toUpperCase();
  if (normalized.length !== 22 || !normalized.startsWith('LC')) return false;
  const body = normalized.slice(2);
  for (const ch of body) if (!ALPHABET.includes(ch)) return false;
  const payload = body.slice(0, 16);
  const checksum = body.slice(16);
  const crc = crc32(Buffer.from('LC' + payload));
  const expected = encodeBase27(crc >>> 0, 4);
  return expected === checksum;
}

/** 去横线 + 转大写（用于 DB 查询和签发） */
export function normalizeCard(card) {
  return card.replace(/[-\s]/g, '').toUpperCase();
}
