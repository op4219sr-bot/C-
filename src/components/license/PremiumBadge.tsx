// ============================================================================
// 顶栏会员徽标（升级版：进度环 + 过期预警 + 文案优化 + 年卡金色）
//
// 三种状态：
//   - free：     [👤 免费版] [开通会员]
//   - premium：  [进度环 👑 年卡 · 剩 10 个月]
//   - expired：  [⚠️ 已过期] [立即续费]
// ============================================================================

import { Crown, UserRound, AlertTriangle } from 'lucide-react';
import { useLicense } from '../../contexts/LicenseContext';
import type { LicenseTier } from '../../api/commands';

/** 卡密类型 → 总时长（秒），用于计算进度环 */
const TIER_DURATION_SEC: Record<LicenseTier, number> = {
  day: 86400,
  week: 7 * 86400,
  half_month: 15 * 86400,
  quarter: 90 * 86400,
  half_year: 180 * 86400,
  year: 365 * 86400,
};

/** 类型展示（去括号的短名） */
const TIER_SHORT_LABEL: Record<LicenseTier, string> = {
  day: '体验卡',
  week: '周卡',
  half_month: '半月卡',
  quarter: '季卡',
  half_year: '半年卡',
  year: '年卡',
};

/** B5: 把剩余天数转成人类友好的字符串 */
function humanizeDaysLeft(days: number): string {
  if (days <= 0) return '今日到期';
  if (days === 1) return '剩 1 天';
  if (days < 30) return `剩 ${days} 天`;
  // 30~365 天 → 用"月"
  if (days < 365) {
    const months = Math.floor(days / 30);
    return `剩 ${months} 个月`;
  }
  // > 365
  const years = Math.floor(days / 365);
  const remainMonths = Math.floor((days % 365) / 30);
  return remainMonths > 0 ? `剩 ${years} 年 ${remainMonths} 个月` : `剩 ${years} 年`;
}

/** B4: 年卡专属金色渐变样式判定 */
function isGoldTier(tier: LicenseTier): boolean {
  return tier === 'year' || tier === 'half_year';
}

export function PremiumBadge() {
  const { status, loaded, promptActivate } = useLicense();

  if (!loaded || !status) return null;

  // ============================================================
  // Premium 状态
  // ============================================================
  if (status.status === 'premium') {
    const daysLeft = status.days_left;
    const isExpiringSoon = daysLeft <= 7;
    const gold = isGoldTier(status.tier);

    // 进度比例：剩余 / 总时长
    const totalSec = TIER_DURATION_SEC[status.tier];
    const remainSec = Math.max(0, status.expires_at - Math.floor(Date.now() / 1000));
    const progress = Math.max(0, Math.min(1, remainSec / totalSec));
    const dashOffset = 75.4 * (1 - progress); // 周长约 75.4 (r=12)

    return (
      <div className="relative group">
        <button
          onClick={() => promptActivate({ hint: '续费可延长当前会员有效期' })}
          className={`relative flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full text-[12px] font-semibold transition-all ${
            isExpiringSoon
              ? 'bg-gradient-to-r from-[var(--color-warning)]/20 to-[var(--color-warning)]/10 text-[var(--color-warning)] expiring-pulse'
              : gold
                ? 'bg-gradient-to-r from-amber-400/25 via-yellow-400/20 to-amber-500/25 text-amber-700 dark:text-amber-300 hover:from-amber-400/35 hover:to-amber-500/35'
                : 'bg-[var(--brand-green)]/15 text-[var(--brand-green)] hover:bg-[var(--brand-green)]/25'
          }`}
        >
          {/* B2: 倒计时进度环 */}
          <span className="relative w-5 h-5 inline-flex items-center justify-center">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 28 28">
              <circle
                cx="14" cy="14" r="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                opacity="0.18"
              />
              <circle
                cx="14" cy="14" r="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="75.4"
                strokeDashoffset={dashOffset}
                style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
              />
            </svg>
            <Crown className="w-3 h-3 relative" />
          </span>

          <span>{TIER_SHORT_LABEL[status.tier]}</span>
          <span className="opacity-75 font-normal">· {humanizeDaysLeft(daysLeft)}</span>
        </button>

        {/* B1 增强：悬停详情卡（这里只做精简版小气泡） */}
        <div className="absolute top-full right-0 mt-2 w-64 invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-150 z-50 pointer-events-none">
          <div className="bg-[var(--bg-card)] border border-[var(--border-color)] rounded-xl shadow-xl p-3 text-[12px]">
            <div className="flex items-center justify-between mb-2">
              <span className="font-bold text-[var(--text-primary)]">
                {gold && <span className="mr-1">✨</span>}
                {TIER_SHORT_LABEL[status.tier]}
              </span>
              <span className={isExpiringSoon ? 'text-[var(--color-warning)] font-semibold' : 'text-[var(--text-muted)]'}>
                {humanizeDaysLeft(daysLeft)}
              </span>
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              到期时间：{new Date(status.expires_at * 1000).toLocaleDateString('zh-CN')}
            </div>
            {isExpiringSoon && (
              <div className="mt-2 px-2 py-1 rounded bg-[var(--color-warning)]/10 text-[var(--color-warning)] text-[11px] font-medium">
                ⚠️ 即将到期，建议提前续费
              </div>
            )}
          </div>
        </div>

        {/* B3: 过期预警的呼吸光晕（仅 ≤7 天） */}
        <style>{`
          .expiring-pulse {
            box-shadow: 0 0 0 0 var(--color-warning);
            animation: expiring-pulse 2s ease-in-out infinite;
          }
          @keyframes expiring-pulse {
            0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--color-warning) 40%, transparent); }
            50% { box-shadow: 0 0 0 6px color-mix(in oklab, var(--color-warning) 0%, transparent); }
          }
        `}</style>
      </div>
    );
  }

  // ============================================================
  // Expired 状态
  // ============================================================
  if (status.status === 'expired') {
    return (
      <button
        onClick={() => promptActivate({ hint: '续费可继续使用所有清理功能' })}
        className="relative flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-gradient-to-r from-[var(--color-danger)]/20 to-[var(--color-danger)]/10 text-[var(--color-danger)] hover:from-[var(--color-danger)]/30 hover:to-[var(--color-danger)]/20 transition-all expired-shake"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>会员已过期</span>
        <span className="opacity-80">· 立即续费</span>
        <style>{`
          .expired-shake {
            animation: expired-attention 4s ease-in-out infinite;
          }
          @keyframes expired-attention {
            0%, 90%, 100% { transform: translateX(0); }
            92% { transform: translateX(-1.5px); }
            94% { transform: translateX(1.5px); }
            96% { transform: translateX(-1px); }
            98% { transform: translateX(1px); }
          }
        `}</style>
      </button>
    );
  }

  // ============================================================
  // Free 状态
  // ============================================================
  return (
    <button
      onClick={() => promptActivate()}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--bg-active)] transition-colors"
    >
      <UserRound className="w-3.5 h-3.5" />
      <span>免费版</span>
      <span className="text-[var(--brand-green)] opacity-90">· 开通会员</span>
    </button>
  );
}
