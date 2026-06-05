// ============================================================================
// 卡密激活弹窗
//
// 由 LicenseContext 的 prompt 状态触发；
// 用户输入卡密 → 实时格式校验 → 调 activate_license → 服务器签发 token →
// 本地落盘 → 刷新 LicenseContext → 自动重试触发激活的清理操作。
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  KeyRound,
  Copy,
  CheckCircle,
  ShieldCheck,
  Sparkles,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { useLicense } from '../../contexts/LicenseContext';
import {
  activateLicense,
  getMachineFingerprint,
  TIER_LABEL,
  verifyCardFormat,
} from '../../api/commands';
import { useToast } from '../Toast';

/** 卡密格式化：自动加横线 → LC-XXXX-XXXX-XXXX-XXXX-XXXX */
function formatCard(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!clean) return '';
  // 首两位强制为 LC
  let body = clean;
  if (body.startsWith('LC')) body = body.slice(2);
  const segs: string[] = ['LC'];
  for (let i = 0; i < body.length && segs.length <= 5; i += 4) {
    segs.push(body.slice(i, i + 4));
  }
  return segs.filter(Boolean).join('-');
}

const TIER_PRICE_HINTS: { label: string; tip: string }[] = [
  { label: TIER_LABEL.day, tip: '快速体验所有清理功能' },
  { label: TIER_LABEL.week, tip: '短期使用首选' },
  { label: TIER_LABEL.half_month, tip: '深度清理一次系统' },
  { label: TIER_LABEL.quarter, tip: '季度大扫除' },
  { label: TIER_LABEL.half_year, tip: '半年无忧使用' },
  { label: TIER_LABEL.year, tip: '推荐 · 最划算' },
];

export function ActivationModal() {
  const { prompt, closePrompt, onActivationSuccess } = useLicense();
  const { showToast } = useToast();

  const isOpen = prompt !== null;

  const [card, setCard] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [fpCopied, setFpCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formatValid, setFormatValid] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [isVisible, setIsVisible] = useState(false);
  const enteredRef = useRef(false);
  if (isVisible) enteredRef.current = true;

  // 进出场动画
  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      setErrorMsg('');
      setCard('');
      setFormatValid(null);
    } else {
      setIsVisible(false);
    }
  }, [isOpen]);

  // 拉机器指纹
  useEffect(() => {
    if (!isOpen) return;
    getMachineFingerprint()
      .then(setFingerprint)
      .catch((e) => console.error('getMachineFingerprint failed:', e));
  }, [isOpen]);

  // 实时格式校验
  const normalized = useMemo(() => card.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), [card]);
  useEffect(() => {
    if (normalized.length < 22) {
      setFormatValid(null);
      return;
    }
    let cancelled = false;
    verifyCardFormat(normalized).then((ok) => {
      if (!cancelled) setFormatValid(ok);
    });
    return () => {
      cancelled = true;
    };
  }, [normalized]);

  if (!isOpen && !enteredRef.current) return null;

  const handleCardChange = (raw: string) => {
    setCard(formatCard(raw));
    setErrorMsg('');
  };

  const handleCopyFingerprint = async () => {
    try {
      await navigator.clipboard.writeText(fingerprint);
      setFpCopied(true);
      setTimeout(() => setFpCopied(false), 1500);
    } catch {
      showToast({ type: 'error', title: '复制失败', description: '请手动选择复制' });
    }
  };

  const handleActivate = async () => {
    if (!normalized || normalized.length !== 22) {
      setErrorMsg('请输入完整卡密');
      return;
    }
    if (formatValid === false) {
      setErrorMsg('卡密格式不正确，请仔细核对');
      return;
    }
    setSubmitting(true);
    setErrorMsg('');
    try {
      await activateLicense(normalized);
      showToast({
        type: 'success',
        title: '激活成功',
        description: '会员功能已解锁',
      });
      await onActivationSuccess();
    } catch (e) {
      const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
      setErrorMsg(msg || '激活失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const inputBorderColor = (() => {
    if (errorMsg) return 'border-[var(--color-danger)]';
    if (formatValid === false) return 'border-[var(--color-danger)]';
    if (formatValid === true) return 'border-[var(--brand-green)]';
    return 'border-[var(--border-color)]';
  })();

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 遮罩 */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${
          isVisible ? 'modal-overlay-in' : 'modal-overlay-out'
        }`}
        onClick={submitting ? undefined : closePrompt}
      />

      {/* 弹窗 */}
      <div
        className={`relative w-[480px] max-h-[88vh] bg-[var(--bg-card)] rounded-2xl shadow-2xl overflow-hidden flex flex-col ${
          isVisible ? 'modal-content-in' : 'modal-content-out'
        }`}
      >
        {/* 顶部品牌条 */}
        <div className="relative px-6 pt-6 pb-4 bg-gradient-to-br from-[var(--brand-green)]/15 to-transparent">
          <button
            onClick={closePrompt}
            disabled={submitting}
            className="absolute right-4 top-4 p-1.5 rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[var(--brand-green)] flex items-center justify-center text-white">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[16px] font-bold text-[var(--text-primary)]">
                输入卡密激活会员
              </h2>
              <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                激活后即可使用所有清理功能
              </p>
            </div>
          </div>

          {prompt?.hint && (
            <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg bg-[var(--brand-green)]/10 text-[12px] text-[var(--brand-green)]">
              <Sparkles className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>{prompt.hint}</span>
            </div>
          )}
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {/* 卡密输入 */}
          <div>
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              卡密
            </label>
            <input
              type="text"
              value={card}
              onChange={(e) => handleCardChange(e.target.value)}
              placeholder="LC-XXXX-XXXX-XXXX-XXXX-XXXX"
              autoFocus
              spellCheck={false}
              disabled={submitting}
              className={`w-full px-3 py-2.5 text-[14px] font-mono tracking-wider rounded-lg border-2 ${inputBorderColor} bg-[var(--bg-main)] text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--brand-green)]`}
            />
            <div className="mt-1.5 min-h-[16px] text-[11px]">
              {formatValid === true && !errorMsg && (
                <span className="text-[var(--brand-green)] flex items-center gap-1">
                  <CheckCircle className="w-3 h-3" /> 卡密格式正确
                </span>
              )}
              {formatValid === false && !errorMsg && (
                <span className="text-[var(--color-danger)] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> 卡密格式错误，请重新检查
                </span>
              )}
              {errorMsg && (
                <span className="text-[var(--color-danger)] flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> {errorMsg}
                </span>
              )}
            </div>
          </div>

          {/* 机器码 */}
          <div>
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              本机机器码（更换设备需提供给客服解绑）
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={fingerprint}
                readOnly
                className="flex-1 px-3 py-2 text-[12px] font-mono rounded-lg border border-[var(--border-color)] bg-[var(--bg-main)] text-[var(--text-secondary)] outline-none"
              />
              <button
                onClick={handleCopyFingerprint}
                disabled={!fingerprint}
                className="px-3 py-2 rounded-lg text-[12px] font-medium bg-[var(--bg-hover)] hover:bg-[var(--bg-active)] text-[var(--text-secondary)] disabled:opacity-50 flex items-center gap-1.5"
              >
                {fpCopied ? (
                  <>
                    <CheckCircle className="w-3.5 h-3.5" /> 已复制
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" /> 复制
                  </>
                )}
              </button>
            </div>
          </div>

          {/* 卡密类型说明 */}
          <details className="group">
            <summary className="text-[12px] font-semibold text-[var(--text-secondary)] cursor-pointer select-none flex items-center gap-1 hover:text-[var(--brand-green)]">
              查看卡密类型说明
              <span className="text-[10px] text-[var(--text-muted)] group-open:hidden">▼</span>
              <span className="text-[10px] text-[var(--text-muted)] hidden group-open:inline">▲</span>
            </summary>
            <ul className="mt-2 space-y-1 text-[11px] text-[var(--text-muted)]">
              {TIER_PRICE_HINTS.map((t) => (
                <li
                  key={t.label}
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[var(--bg-main)]"
                >
                  <span className="text-[var(--text-secondary)] font-medium">{t.label}</span>
                  <span>{t.tip}</span>
                </li>
              ))}
            </ul>
          </details>

          {/* 安全提示 */}
          <div className="flex items-start gap-2 text-[11px] text-[var(--text-muted)]">
            <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-[var(--brand-green)]" />
            <span>
              卡密激活后会绑定本机器，请勿在多台设备上重复使用。
              重装系统或更换硬件需联系客服解绑。
            </span>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-3 border-t border-[var(--border-color)] flex items-center justify-end gap-2 bg-[var(--bg-main)]">
          <button
            onClick={closePrompt}
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleActivate}
            disabled={submitting || formatValid !== true}
            className="px-5 py-2 rounded-lg text-[13px] font-semibold text-white bg-[var(--brand-green)] hover:bg-[var(--brand-green-hover)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {submitting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                激活中...
              </>
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5" />
                立即激活
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
