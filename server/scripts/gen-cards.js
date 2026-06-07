#!/usr/bin/env node
// ============================================================================
// 命令行卡密生成工具
//
// 用法:
//   node scripts/gen-cards.js --tier year --count 100 --batch "618促销"
//   node scripts/gen-cards.js --tier week --count 1000 --output cards.csv --batch "抖音活动"
//
// 选项：
//   --tier       day | week | half_month | quarter | half_year | year
//   --count      数量（默认 1）
//   --batch      批次名（可选）
//   --note       备注（可选）
//   --valid-until  必须在此日期前激活（yyyy-mm-dd）
//   --output     输出 CSV 路径（默认 stdout）
// ============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, stmts } from '../src/db.js';
import { generateCard, formatCardDisplay, TIER_DAYS } from '../src/crypto.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2).replace(/-/g, '_');
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    }
  }
  return out;
}

const args = parseArgs(process.argv);

const tier = args.tier;
if (!tier || !TIER_DAYS[tier]) {
  console.error('错误：必须指定 --tier，可选值：' + Object.keys(TIER_DAYS).join(' | '));
  process.exit(1);
}
const count = Math.max(1, Math.min(50000, Number(args.count || 1)));
const batch = args.batch || null;
const note = args.note || null;
const validUntil = args.valid_until ? Math.floor(new Date(args.valid_until + 'T23:59:59').getTime()) : null;
const output = args.output;

const baseSeq = stmts.maxSeqByTier.get(tier).max_seq;
const created_at = Math.floor(Date.now() / 1000);

const cards = [];
const tx = db.transaction(() => {
  for (let i = 0; i < count; i++) {
    const seq = baseSeq + i + 1;
    const card = generateCard(tier, seq);
    stmts.insertCard.run({
      card,
      card_id: crypto.randomUUID(),
      tier,
      duration_days: TIER_DAYS[tier],
      batch,
      created_at,
      valid_until: validUntil,
      seq,
      note,
    });
    cards.push(card);
  }
});
tx();

const csv = ['card,tier,batch,note,created_at'];
for (const c of cards) {
  csv.push([formatCardDisplay(c), tier, batch || '', note || '', new Date(created_at * 1000).toISOString()].join(','));
}

if (output) {
  fs.writeFileSync(path.resolve(output), csv.join('\n'));
  console.log(`✅ 已生成 ${count} 张 ${tier} 卡密 → ${output}`);
} else {
  console.log(csv.join('\n'));
  console.error(`✅ 已生成 ${count} 张 ${tier} 卡密`);
}
