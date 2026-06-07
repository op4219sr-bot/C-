// ============================================================================
// 设置页「我的授权」面板（升级版：大图标状态 + 进度条 + 续费/升级按钮）
// ============================================================================

import { useEffect, useState } from 'react';
import {
  Crown,
  Copy,
  CheckCircle,
  UnlockKeyhole,
  AlertTriangle,
  UserRound,
  Sparkles,
  Clock,
} from 'lucide-react';
import { useLicense } from '../../contexts/LicenseContext';
import { useToast } from '../Toast';
import {
  deactivateLicense,
  getMachineFingerprint,
  TIER_LABEL,
  type LicenseTier,
} from '../../api/commands';

const TIER_DURATION_DAYS: Record<LicenseTier, number> = {
  day: 1,
  week: 7,
  half_month: 15,
  quarter: 90,
  half_year: 180,
  year: 365,
};

export function LicenseInfoPanel() {
  const { status, loaded, refresh, promptActivate } = useLicense();
  const { showToast } = useToast();
  const [fingerprint, setFingerprint] = useState('');
  const [copied, setCopied] = useState(false);
  const [unbinding, setUnbinding] = useState(false);

  useEffect(() => {
    getMachineFingerprint().then(setFingerprint).catch(console.error);
  }, []);

  if (!loaded) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      showToast({ type: 'error', title: '复制失败' });
    }
  };

  const handleDeactivate = async () => {
    if (!status || status.status !== 'premium') return;
    if (
      !window.confirm(
        '确定要解绑当前机器吗？\n\n解绑后：\n• 会员功能立即停用\n• 原卡密可重新绑定到其他机器',
      )
    ) {
      return;
    }
    setUnbinding(true);
    try {
      await deactivateLicense('用户主动解绑');
      showToast({ type: 'success', title: '已解绑', description: '会员状态已重置' });
      await refresh();
    } catch (e) {
      showToast({ type: 'error', title: '解绑失败', description: String(e) });
    } finally {
      setUnbinding(false);
    }
  };

  // ============================================================
  // 顶部大图标状态块（C2）—— 三种状态不同视觉
  // ============================================================
  const isPremium = status?.status === 'premium';
  const isExpired = status?.status === 'expired';

  const heroBg = isPremium
    ? 'bg-gradient-to-br from-[var(--brand-green)]/15 via-[var(--brand-green)]/8 to-transparent border-[var(--brand-green)]/30'
    : isExpired
      ? 'bg-gradient-to-br from-[var(--color-warning)]/15 via-[var(--color-warning)]/8 to-transparent border-[var(--color-warning)]/30'
      : 'bg-[var(--bg-main)] border-[var(--border-color)]';

  const heroIcon = isPremium ? (
    <div className="w-12 h-12 rounded-2xl bg-[var(--brand-green)] text-white flex items-center justify-center shadow-md">
      <Crown className="w-6 h-6" />
    </div>
  ) : isExpired ? (
    <div className="w-12 h-12 rounded-2xl bg-[var(--color-warning)] text-white flex items-center justify-center shadow-md">
      <AlertTriangle className="w-6 h-6" />
    </div>
  ) : (
    <div className="w-12 h-12 rounded-2xl bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center justify-center">
      <UserRound className="w-6 h-6" />
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
        <Crown className="w-4 h-4 text-[var(--brand-green)]" />
        我的授权
      </div>

      {/* C2: 大图标状态块 */}
      <div className={`p-4 rounded-xl border ${heroBg}`}>
        <div className="flex items-start gap-3">
          {heroIcon}
          <div className="flex-1 min-w-0">
            {status?.status === 'premium' && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-bold text-[var(--text-primary)]">
                    {TIER_LABEL[status.tier]}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-md bg-[var(--brand-green)] text-white text-[10px] font-bold">
                    会员中
                  </span>
                </div>
                <div className="text-[12px] text-[var(--text-secondary)] mt-1 flex items-center gap-1.5">
                  <Clock className="w-3 h-3" />
                  剩余 <span className="font-bold text-[var(--brand-green)]">{status.days_left}</span> 天，
                  到 {new Date(status.expires_at * 1000).toLocaleDateString('zh-CN')} 到期
                </div>
              </>
            )}

            {status?.status === 'expired' && (
              <>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[15px] font-bold text-[var(--text-primary)]">
                    {TIER_LABEL[status.tier]}
                  </span>
                  <span className="px-1.5 py-0.5 rounded-md bg-[var(--color-warning)] text-white text-[10px] font-bold">
                    已过期
                  </span>
                </div>
                <div className="text-[12px] text-[var(--text-secondary)] mt-1">
                  于 {new Date(status.expired_at * 1000).toLocaleDateString('zh-CN')} 到期，续费可立即恢复
                </div>
              </>
            )}

            {status?.status === 'free' && (
              <>
                <div className="text-[15px] font-bold text-[var(--text-primary)]">免费用户</div>
                <div className="text-[12px] text-[var(--text-secondary)] mt-1">
                  可使用所有扫描功能；执行清理需激活会员
                </div>
              </>
            )}
          </div>
        </div>

        {/* C1: 到期进度条（仅 premium 显示） */}
        {status?.status === 'premium' && (
          <div className="mt-3">
            <ExpiryProgressBar
              tier={status.tier}
              expiresAt={status.expires_at}
              activatedAt={status.activated_at}
            />
          </div>
        )}
      </div>

      {/* 机器码 */}
      <div>
        <div className="text-[11px] font-medium text-[var(--text-muted)] mb-1">本机机器码</div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={fingerprint}
            readOnly
            className="flex-1 px-2.5 py-1.5 text-[11px] font-mono rounded-md border border-[var(--border-color)] bg-[var(--bg-main)] text-[var(--text-secondary)] outline-none"
          />
          <button
            onClick={handleCopy}
            disabled={!fingerprint}
            className="px-2.5 py-1.5 rounded-md text-[11px] bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-secondary)] disabled:opacity-50 flex items-center gap-1"
          >
            {copied ? (
              <>
                <CheckCircle className="w-3 h-3" /> 已复制
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" /> 复制
              </>
            )}
          </button>
        </div>
      </div>

      {/* 操作按钮区 */}
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {/* C3: 续费/升级按钮（premium 和 expired 都显示） */}
        {(status?.status === 'premium' || status?.status === 'expired') && (
          <button
            onClick={() =>
              promptActivate({
                hint:
                  status.status === 'expired'
                    ? '输入新卡密恢复会员'
                    : '续费可叠加延长当前到期时间',
              })
            }
            className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-white bg-[var(--brand-green)] hover:bg-[var(--brand-green-hover)] flex items-center gap-1"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {status.status === 'expired' ? '立即续费' : '续费 / 升级'}
          </button>
        )}

        {status?.status === 'premium' && (
          <button
            onClick={handleDeactivate}
            disabled={unbinding}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium text-[var(--color-danger)] border border-[var(--color-danger)]/30 hover:bg-[var(--color-danger)]/10 disabled:opacity-50 flex items-center gap-1"
          >
            <UnlockKeyhole className="w-3.5 h-3.5" />
            {unbinding ? '解绑中...' : '解绑当前机器'}
          </button>
        )}

        {status?.status === 'free' && (
          <button
            onClick={() => promptActivate()}
            className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-white bg-[var(--brand-green)] hover:bg-[var(--brand-green-hover)] flex items-center gap-1"
          >
            <Sparkles className="w-3.5 h-3.5" />
            输入卡密激活
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 子组件：到期进度条（C1）
// ============================================================
interface ExpiryProgressBarProps {
  tier: LicenseTier;
  expiresAt: number;     // Unix 秒
  activatedAt: number;   // Unix 秒
}

function ExpiryProgressBar({ tier, expiresAt, activatedAt }: ExpiryProgressBarProps) {
  const totalDays = TIER_DURATION_DAYS[tier];
  const now = Math.floor(Date.now() / 1000);
  const elapsed = Math.max(0, now - activatedAt);
  const total = expiresAt - activatedAt;
  const usedPct = total > 0 ? Math.min(100, (elapsed / total) * 100) : 0;
  const remainPct = 100 - usedPct;
  const usedDays = Math.floor(elapsed / 86400);

  // 颜色：剩余 >50% 绿，20~50% 黄，<20% 红
  const barColor =
    remainPct < 20
      ? 'bg-[var(--color-danger)]'
      : remainPct < 50
        ? 'bg-[var(--color-warning)]'
        : 'bg-[var(--brand-green)]';

  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] mb-1">
        <span>已使用 {usedDays} / {totalDays} 天</span>
        <span className="font-semibold">{remainPct.toFixed(0)}% 剩余</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
        <div
          className={`h-full ${barColor} transition-all duration-500`}
          style={{ width: `${usedPct}%` }}
        />
      </div>
    </div>
  );
}
