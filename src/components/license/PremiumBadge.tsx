// ============================================================================
// 顶栏会员徽标
//
// 三种状态：
//   - free：     [👤 免费版] [开通会员]
//   - premium：  [👑 年卡 · 还剩 312 天]
//   - expired：  [⚠️ 已过期] [立即续费]
// ============================================================================

import { Crown, UserRound, AlertTriangle } from 'lucide-react';
import { useLicense } from '../../contexts/LicenseContext';
import { TIER_LABEL } from '../../api/commands';

export function PremiumBadge() {
  const { status, loaded, promptActivate } = useLicense();

  if (!loaded || !status) return null;

  if (status.status === 'premium') {
    const tierLabel = TIER_LABEL[status.tier].replace(/（.+?）/, '');
    const daysLeft = status.days_left;
    const isExpiringSoon = daysLeft <= 7;
    return (
      <button
        onClick={() => promptActivate({ hint: '续期可延长当前会员有效期' })}
        title={`会员到期时间：${new Date(status.expires_at * 1000).toLocaleString()}`}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors ${
          isExpiringSoon
            ? 'bg-[var(--color-warning)]/15 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/25'
            : 'bg-[var(--brand-green)]/15 text-[var(--brand-green)] hover:bg-[var(--brand-green)]/25'
        }`}
      >
        <Crown className="w-3.5 h-3.5" />
        <span>{tierLabel}</span>
        <span className="opacity-70">· 剩 {daysLeft} 天</span>
      </button>
    );
  }

  if (status.status === 'expired') {
    return (
      <button
        onClick={() => promptActivate({ hint: '续费可继续使用所有清理功能' })}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold bg-[var(--color-danger)]/15 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/25 transition-colors"
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        <span>会员已过期</span>
        <span className="opacity-70">· 立即续费</span>
      </button>
    );
  }

  // free
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
