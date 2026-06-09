// ============================================================================
// 卡密激活弹窗（升级版：价格卡片 + 突出场景 + 成功动画）
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
  Zap,
  TrendingUp,
  Package,
  ShieldAlert,
  ClipboardList,
  Rocket,
  Layers,
} from 'lucide-react';
import { useLicense } from '../../contexts/LicenseContext';
import {
  activateLicense,
  getMachineFingerprint,
  verifyCardFormat,
  type LicenseTier,
} from '../../api/commands';
import { useToast } from '../Toast';

/** 卡密格式化：自动加横线 → LC-XXXX-XXXX-XXXX-XXXX-XXXX */
function formatCard(input: string): string {
  const clean = input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (!clean) return '';
  let body = clean;
  if (body.startsWith('LC')) body = body.slice(2);
  const segs: string[] = ['LC'];
  for (let i = 0; i < body.length && segs.length <= 5; i += 4) {
    segs.push(body.slice(i, i + 4));
  }
  return segs.filter(Boolean).join('-');
}

// 卡密类型展示元数据
interface TierMeta {
  tier: LicenseTier;
  label: string;
  duration: string;
  badge?: string;        // 角标文案（"推荐"/"超值"等）
  highlight?: boolean;   // 是否突出
  gradient: string;      // 渐变背景
}

const TIER_CARDS: TierMeta[] = [
  { tier: 'day', label: '体验卡', duration: '1 天', gradient: 'from-slate-50 to-slate-100' },
  { tier: 'week', label: '周卡', duration: '7 天', gradient: 'from-blue-50 to-blue-100' },
  { tier: 'half_month', label: '半月卡', duration: '15 天', gradient: 'from-sky-50 to-sky-100' },
  { tier: 'quarter', label: '季卡', duration: '90 天', gradient: 'from-teal-50 to-teal-100', badge: '热门' },
  { tier: 'half_year', label: '半年卡', duration: '180 天', gradient: 'from-emerald-50 to-emerald-100', badge: '超值' },
  { tier: 'year', label: '年卡', duration: '365 天', gradient: 'from-amber-50 to-orange-100', badge: '推荐', highlight: true },
];

type ModalStage = 'input' | 'submitting' | 'success';

/** 会员卖点行（A 方案：突出"批量、安全、有记录"等价值） */
function FeatureRow({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0 text-[var(--brand-green)]">{icon}</span>
      <div className="min-w-0">
        <div className="font-semibold text-[var(--text-primary)] leading-tight">{title}</div>
        <div className="text-[var(--text-muted)] leading-tight mt-0.5">{desc}</div>
      </div>
    </div>
  );
}

export function ActivationModal() {
  const { prompt, closePrompt, onActivationSuccess } = useLicense();
  const { showToast } = useToast();

  const isOpen = prompt !== null;

  const [card, setCard] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [fpCopied, setFpCopied] = useState(false);
  const [stage, setStage] = useState<ModalStage>('input');
  const [formatValid, setFormatValid] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [activatedTier, setActivatedTier] = useState<string>('');
  const [isVisible, setIsVisible] = useState(false);
  // 与 SettingsModal 一致的"动画期间保留挂载"模式：
  // - 打开 → 立即挂载，设 isVisible=true 触发入场动画
  // - 关闭 → 立即 isVisible=false 触发出场动画，190ms 后 isAnimating=false 真正卸载
  // 之前用 enteredRef 永远不重置，导致关闭后 fixed inset-0 overlay 留在 DOM，
  // 拦截所有点击 → 整个 UI 卡死。
  const [isAnimating, setIsAnimating] = useState(false);
  // 兼容旧逻辑：动画期间标记一次已"进入过"，仅用于过渡动画 class 切换
  const enteredRef = useRef(false);
  if (isVisible) enteredRef.current = true;

  // 进出场动画
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
      setIsVisible(true);
      setErrorMsg('');
      setCard('');
      setFormatValid(null);
      setStage('input');
      setActivatedTier('');
    } else {
      setIsVisible(false);
      // 等待出场动画结束（约 190ms）后真正卸载，释放遮罩对点击的拦截
      const t = setTimeout(() => {
        setIsAnimating(false);
        enteredRef.current = false;
      }, 200);
      return () => clearTimeout(t);
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

  // 关闭后等待动画结束才真正卸载（出场动画期间 isAnimating=true）
  if (!isOpen && !isAnimating) return null;

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
    setStage('submitting');
    setErrorMsg('');
    try {
      const res = await activateLicense(normalized);
      // 取出激活的 tier 用于成功页展示
      const s = res.status;
      if (s.status === 'premium') {
        const meta = TIER_CARDS.find((t) => t.tier === s.tier);
        setActivatedTier(meta?.label || '会员');
      }
      setStage('success');
      // 1.2 秒后真正完成
      setTimeout(async () => {
        await onActivationSuccess();
      }, 1200);
    } catch (e) {
      const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
      setErrorMsg(msg || '激活失败，请稍后重试');
      setStage('input');
    }
  };

  const inputBorderColor = (() => {
    if (errorMsg) return 'border-[var(--color-danger)]';
    if (formatValid === false) return 'border-[var(--color-danger)]';
    if (formatValid === true) return 'border-[var(--brand-green)]';
    return 'border-[var(--border-color)]';
  })();

  // ============================================================
  // 成功页
  // ============================================================
  if (stage === 'success') {
    return createPortal(
      <div
        className={`fixed inset-0 z-[9999] flex items-center justify-center ${
          isVisible ? '' : 'pointer-events-none'
        }`}
      >
        <div className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${isVisible ? 'modal-overlay-in' : 'modal-overlay-out'}`} />
        <div className={`relative w-[420px] bg-[var(--bg-card)] rounded-2xl shadow-2xl overflow-hidden ${isVisible ? 'modal-content-in' : 'modal-content-out'}`}>
          <div className="px-8 py-10 flex flex-col items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-[var(--brand-green)] opacity-20 animate-ping" />
              <div className="relative w-20 h-20 rounded-full bg-[var(--brand-green)] flex items-center justify-center text-white shadow-lg">
                <CheckCircle className="w-10 h-10" strokeWidth={2.5} />
              </div>
            </div>
            <div className="text-center mt-2">
              <h3 className="text-[18px] font-bold text-[var(--text-primary)]">激活成功</h3>
              <p className="text-[13px] text-[var(--text-secondary)] mt-1">
                {activatedTier} 已生效，所有清理功能已解锁
              </p>
            </div>
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--brand-green)]/10 text-[var(--brand-green)] text-[12px] font-medium">
              <Sparkles className="w-3.5 h-3.5" />
              即将自动继续操作
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  }

  // ============================================================
  // 输入页
  // ============================================================
  const submitting = stage === 'submitting';

  return createPortal(
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center ${
        isVisible ? '' : 'pointer-events-none'
      }`}
    >
      {/* 遮罩 */}
      <div
        className={`absolute inset-0 bg-black/40 backdrop-blur-sm ${
          isVisible ? 'modal-overlay-in' : 'modal-overlay-out'
        }`}
        onClick={submitting ? undefined : closePrompt}
      />

      {/* 弹窗 */}
      <div
        className={`relative w-[540px] max-h-[88vh] bg-[var(--bg-card)] rounded-2xl shadow-2xl overflow-hidden flex flex-col ${
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

          {/* 突出场景：A5 —— 释放量大字突出展示 */}
          {prompt?.hint && (
            <div className="mt-4 flex items-center gap-3 px-4 py-3 rounded-xl bg-gradient-to-r from-[var(--brand-green)]/15 via-[var(--brand-green)]/8 to-transparent border border-[var(--brand-green)]/20">
              <div className="w-9 h-9 rounded-lg bg-[var(--brand-green)] flex items-center justify-center text-white shrink-0">
                <Zap className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-[var(--text-muted)] leading-tight">
                  本次操作
                </div>
                <div className="text-[14px] font-bold text-[var(--brand-green)] mt-0.5 leading-tight">
                  {prompt.hint}
                </div>
              </div>
              <TrendingUp className="w-4 h-4 text-[var(--brand-green)] shrink-0" />
            </div>
          )}
        </div>

        {/* 主体 */}
        <div className="flex-1 overflow-auto px-6 py-4 space-y-4">
          {/* 会员价值卖点（A：重新定义"会员到底买的是啥"） */}
          <div className="rounded-xl border border-[var(--brand-green)]/20 bg-gradient-to-br from-[var(--brand-green)]/5 to-transparent p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles className="w-3.5 h-3.5 text-[var(--brand-green)]" />
              <span className="text-[12px] font-bold text-[var(--text-primary)]">会员能多做什么</span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
              <FeatureRow
                icon={<Package className="w-3.5 h-3.5" />}
                title="批量清理"
                desc="勾选 N 个目录一键删，10 分钟 → 1 分钟"
              />
              <FeatureRow
                icon={<ShieldAlert className="w-3.5 h-3.5" />}
                title="智能避险"
                desc="自动跳过系统文件，杜绝误删"
              />
              <FeatureRow
                icon={<ClipboardList className="w-3.5 h-3.5" />}
                title="操作日志"
                desc="哪天删了啥、释放多少 GB"
              />
              <FeatureRow
                icon={<Rocket className="w-3.5 h-3.5" />}
                title="一键全清"
                desc="跨垃圾/大文件/残留/注册表"
              />
              <FeatureRow
                icon={<Layers className="w-3.5 h-3.5" />}
                title="全盘深度扫描"
                desc="大目录分析不止 AppData"
              />
              <FeatureRow
                icon={<TrendingUp className="w-3.5 h-3.5" />}
                title="完整结果"
                desc="大文件 / 残留路径全展开"
              />
            </div>
          </div>

          {/* A1: 价格卡片网格 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[12px] font-semibold text-[var(--text-secondary)]">
                卡密类型
              </label>
              <span className="text-[11px] text-[var(--text-muted)]">点击查看详情 / 选择购买</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {TIER_CARDS.map((t) => (
                <div
                  key={t.tier}
                  className={`relative rounded-xl border-2 p-2.5 transition-all ${
                    t.highlight
                      ? 'border-[var(--brand-green)] bg-gradient-to-br ' + t.gradient
                      : 'border-[var(--border-color)] bg-gradient-to-br ' + t.gradient + ' hover:border-[var(--brand-green)]/60'
                  }`}
                >
                  {t.badge && (
                    <span
                      className={`absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold text-white ${
                        t.highlight ? 'bg-[var(--brand-green)]' : 'bg-[var(--color-warning)]'
                      }`}
                    >
                      {t.badge}
                    </span>
                  )}
                  <div className="text-[13px] font-bold text-slate-800">{t.label}</div>
                  <div className="text-[10px] text-slate-600 mt-0.5">{t.duration}</div>
                </div>
              ))}
            </div>
          </div>

          {/* 卡密输入 */}
          <div>
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
              输入卡密
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
