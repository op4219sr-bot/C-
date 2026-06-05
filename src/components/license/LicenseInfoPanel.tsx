// ============================================================================
// 设置页的"我的授权"面板（在 SettingsModal 里嵌入）
//
// 展示：
//   - 当前 license 状态
//   - 机器码
//   - 解绑按钮（仅 premium 状态可见）
//   - 输入卡密激活按钮（free / expired 状态可见）
// ============================================================================

import { useEffect, useState } from 'react';
import { Crown, Copy, CheckCircle, UnlockKeyhole, AlertTriangle } from 'lucide-react';
import { useLicense } from '../../contexts/LicenseContext';
import { useToast } from '../Toast';
import { deactivateLicense, getMachineFingerprint, TIER_LABEL } from '../../api/commands';

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
    if (!window.confirm('确定要解绑当前机器吗？\n解绑后会员功能将立即停用，原卡密可重新绑定到其他机器。')) {
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
        <Crown className="w-4 h-4 text-[var(--brand-green)]" />
        我的授权
      </div>

      {/* 状态卡片 */}
      <div className="p-3 rounded-lg bg-[var(--bg-main)] border border-[var(--border-color)]">
        {status?.status === 'premium' && (
          <>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[13px] font-semibold text-[var(--brand-green)]">
                {TIER_LABEL[status.tier]}
              </span>
              <span className="text-[11px] text-[var(--text-muted)]">
                剩余 {status.days_left} 天
              </span>
            </div>
            <div className="text-[11px] text-[var(--text-muted)]">
              到期时间：{new Date(status.expires_at * 1000).toLocaleString()}
            </div>
          </>
        )}

        {status?.status === 'expired' && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--color-warning)]">
            <AlertTriangle className="w-3.5 h-3.5" />
            会员已过期（{TIER_LABEL[status.tier]} · 于{' '}
            {new Date(status.expired_at * 1000).toLocaleDateString()}）
          </div>
        )}

        {status?.status === 'free' && (
          <div className="text-[12px] text-[var(--text-muted)]">
            当前为免费用户，可正常使用所有扫描功能；执行清理需激活会员。
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

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 pt-1">
        {status?.status === 'premium' ? (
          <button
            onClick={handleDeactivate}
            disabled={unbinding}
            className="px-3 py-1.5 rounded-md text-[12px] font-medium text-[var(--color-danger)] border border-[var(--color-danger)]/30 hover:bg-[var(--color-danger)]/10 disabled:opacity-50 flex items-center gap-1"
          >
            <UnlockKeyhole className="w-3.5 h-3.5" />
            {unbinding ? '解绑中...' : '解绑当前机器'}
          </button>
        ) : (
          <button
            onClick={() => promptActivate()}
            className="px-3 py-1.5 rounded-md text-[12px] font-semibold text-white bg-[var(--brand-green)] hover:bg-[var(--brand-green-hover)]"
          >
            输入卡密激活
          </button>
        )}
      </div>
    </div>
  );
}
