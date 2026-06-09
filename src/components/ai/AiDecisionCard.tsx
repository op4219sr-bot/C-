// ============================================================================
// AI 决策卡片：展示单条 AI 判定 + 复选框
// ============================================================================

import { Check, FolderOpen, ShieldCheck, HelpCircle, Lock } from 'lucide-react';
import {
  AI_VERDICT_META,
  AI_EVIDENCE_TYPE_LABEL,
  type AiDecisionResolved,
} from '../../api/commands';

interface AiDecisionCardProps {
  decision: AiDecisionResolved;
  selected: boolean;
  onToggle: () => void;
  onOpenFolder: (path: string) => void;
}

/** verdict → 配色与图标 */
function verdictStyle(verdict: AiDecisionResolved['verdict']) {
  switch (verdict) {
    case 'safe_to_delete':
      return {
        icon: <ShieldCheck className="w-3.5 h-3.5" />,
        badge: 'bg-[var(--brand-green)]/15 text-[var(--brand-green)]',
        border: 'border-[var(--brand-green)]/30',
      };
    case 'likely_safe':
      return {
        icon: <Check className="w-3.5 h-3.5" />,
        badge: 'bg-blue-500/15 text-blue-500',
        border: 'border-blue-500/30',
      };
    case 'needs_user_decision':
      return {
        icon: <HelpCircle className="w-3.5 h-3.5" />,
        badge: 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
        border: 'border-[var(--color-warning)]/30',
      };
    case 'keep':
      return {
        icon: <Lock className="w-3.5 h-3.5" />,
        badge: 'bg-gray-400/15 text-gray-400',
        border: 'border-[var(--border-color)]',
      };
  }
}

export function AiDecisionCard({ decision, selected, onToggle, onOpenFolder }: AiDecisionCardProps) {
  const style = verdictStyle(decision.verdict);
  const meta = AI_VERDICT_META[decision.verdict];
  const isKeep = decision.verdict === 'keep';
  const sizeGb = decision.size_mb >= 1024;
  const sizeText = sizeGb
    ? `${(decision.size_mb / 1024).toFixed(1)} GB`
    : `${decision.size_mb} MB`;

  // 路径简写：保留盘符 + 末两级
  const shortPath = (() => {
    const parts = decision.real_path.replace(/\//g, '\\').split('\\').filter(Boolean);
    if (parts.length <= 3) return decision.real_path;
    return `${parts[0]}\\...\\${parts.slice(-2).join('\\')}`;
  })();

  const confidencePct = Math.round(decision.confidence * 100);

  return (
    <div
      className={`relative rounded-xl border p-3 transition-colors ${style.border} ${
        selected ? 'bg-[var(--brand-green)]/5' : 'bg-[var(--bg-main)]'
      } ${isKeep ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-3">
        {/* 复选框（keep 不可选） */}
        <button
          onClick={isKeep ? undefined : onToggle}
          disabled={isKeep}
          className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors ${
            isKeep
              ? 'border-[var(--border-color)] cursor-not-allowed'
              : selected
                ? 'bg-[var(--brand-green)] border-[var(--brand-green)] text-white'
                : 'border-[var(--border-color)] hover:border-[var(--brand-green)]'
          }`}
        >
          {selected && !isKeep && <Check className="w-3.5 h-3.5" />}
        </button>

        <div className="flex-1 min-w-0">
          {/* 第一行：判定徽章 + 类型 + 大小 */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${style.badge}`}>
              {style.icon}
              {meta.label}
            </span>
            {decision.evidence_type && (
              <span className="text-[11px] text-[var(--text-muted)]">
                {AI_EVIDENCE_TYPE_LABEL[decision.evidence_type]}
              </span>
            )}
            <span className="text-[12px] font-bold text-[var(--text-primary)] tabular-nums ml-auto">
              {sizeText}
            </span>
          </div>

          {/* 路径 */}
          <div
            className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] font-mono mb-1 cursor-pointer hover:text-[var(--brand-green)]"
            onClick={() => onOpenFolder(decision.real_path)}
            title={`点击打开：${decision.real_path}`}
          >
            <FolderOpen className="w-3 h-3 shrink-0" />
            <span className="truncate">{shortPath}</span>
          </div>

          {/* AI 理由 */}
          <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
            {decision.reasoning}
          </p>

          {/* 置信度条 */}
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] text-[var(--text-muted)]">AI 置信度</span>
            <div className="flex-1 h-1 rounded-full bg-[var(--bg-hover)] overflow-hidden max-w-[120px]">
              <div
                className={`h-full ${confidencePct >= 70 ? 'bg-[var(--brand-green)]' : confidencePct >= 40 ? 'bg-[var(--color-warning)]' : 'bg-[var(--text-muted)]'}`}
                style={{ width: `${confidencePct}%` }}
              />
            </div>
            <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{confidencePct}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}
