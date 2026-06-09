// ============================================================================
// AI 智能清理顾问模块
//
// 流程：
//   1. collect_ai_evidence()  收集证据包（免费，脱敏）
//   2. 免费用户看总览（X GB 可优化），点"AI 分析"弹激活窗
//   3. 会员 analyze_ai_evidence()  → AI 决策报告
//   4. 用户勾选 → 走现有删除引擎执行
// ============================================================================

import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Brain, Loader2, Sparkles, Settings2, Trash2, ShieldCheck } from 'lucide-react';
import { ModuleCard } from '../ModuleCard';
import { ConfirmDialog } from '../ConfirmDialog';
import { useToast } from '../Toast';
import { useDashboard } from '../../contexts/DashboardContext';
import { useLicense } from '../../contexts/LicenseContext';
import { useAiConfig } from '../../hooks/useAiConfig';
import {
  collectAiEvidence,
  analyzeAiEvidence,
  openInFolder,
  deleteLeftoverFolders,
  enhancedDeleteFiles,
  AI_EVIDENCE_TYPE_LABEL,
  type AiEvidencePackage,
  type AiReportResolved,
  type AiDecisionResolved,
} from '../../api/commands';
import { formatSize } from '../../utils/format';
import { AiDecisionCard } from '../ai/AiDecisionCard';
import { AiSettingsPanel } from '../ai/AiSettingsPanel';

export function AiCleanerModule() {
  const { modules, expandedModule, setExpandedModule, updateModuleState, triggerHealthRefresh } =
    useDashboard();
  const moduleState = modules.aiCleaner;
  const { showToast } = useToast();
  const { isPremium, promptActivate } = useLicense();
  const { config, updateConfig } = useAiConfig();

  const [evidence, setEvidence] = useState<AiEvidencePackage | null>(null);
  const [report, setReport] = useState<AiReportResolved | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isExpanded = expandedModule === 'aiCleaner';

  // ============================================================
  // 1. 收集证据（免费）
  // ============================================================
  const handleScan = useCallback(async () => {
    updateModuleState('aiCleaner', { status: 'scanning', error: null });
    setReport(null);
    setSelectedPaths(new Set());
    try {
      const pkg = await collectAiEvidence();
      setEvidence(pkg);
      const totalMb = pkg.evidence.reduce((s, e) => s + e.size_mb, 0);
      updateModuleState('aiCleaner', {
        status: 'done',
        fileCount: pkg.evidence.length,
        totalSize: totalMb * 1024 * 1024,
      });
      setExpandedModule('aiCleaner');
    } catch (e) {
      const msg = typeof e === 'string' ? e : String(e);
      updateModuleState('aiCleaner', { status: 'error', error: msg });
    }
  }, [updateModuleState, setExpandedModule]);

  // ============================================================
  // 2. AI 分析（会员）
  // ============================================================
  const handleAnalyze = useCallback(async () => {
    if (!evidence) return;
    if (!isPremium) {
      promptActivate({ hint: 'AI 智能分析需要会员，让 AI 帮你判断哪些可安全清理' });
      return;
    }
    setAnalyzing(true);
    try {
      const r = await analyzeAiEvidence(evidence, config);
      setReport(r);
      // 默认勾选 safe_to_delete
      const preselect = new Set(
        r.decisions.filter((d) => d.verdict === 'safe_to_delete').map((d) => d.real_path),
      );
      setSelectedPaths(preselect);
      showToast({ type: 'success', title: 'AI 分析完成', description: r.summary });
    } catch (e) {
      if (e === 'PREMIUM_REQUIRED') {
        // 已由全局事件弹窗，无需处理
        return;
      }
      const msg = typeof e === 'string' ? e : String(e);
      showToast({ type: 'error', title: 'AI 分析失败', description: msg });
    } finally {
      setAnalyzing(false);
    }
  }, [evidence, isPremium, config, promptActivate, showToast]);

  // ============================================================
  // 3. 执行清理
  // ============================================================
  const toggleSelect = useCallback((path: string) => {
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleOpenFolder = useCallback(
    async (path: string) => {
      try {
        await openInFolder(path);
      } catch (e) {
        showToast({ type: 'error', title: '打开失败', description: String(e) });
      }
    },
    [showToast],
  );

  const selectedDecisions = (report?.decisions || []).filter((d) =>
    selectedPaths.has(d.real_path),
  );
  const selectedSizeMb = selectedDecisions.reduce((s, d) => s + d.size_mb, 0);

  const handleExecute = useCallback(async () => {
    if (selectedDecisions.length === 0) return;
    setIsDeleting(true);
    try {
      // 按证据类型分流：卸载残留走文件夹删除，其它走增强删除
      const leftoverPaths = selectedDecisions
        .filter((d) => d.evidence_type === 'uninstall_residue')
        .map((d) => d.real_path);
      const otherPaths = selectedDecisions
        .filter((d) => d.evidence_type !== 'uninstall_residue')
        .map((d) => d.real_path);

      let freed = 0;
      let failed = 0;

      if (leftoverPaths.length > 0) {
        const res = await deleteLeftoverFolders(leftoverPaths);
        freed += res.deleted_count;
        failed += res.failed_paths?.length || 0;
      }
      if (otherPaths.length > 0) {
        const res = await enhancedDeleteFiles(otherPaths);
        freed += res.success_count;
        failed += res.failed_count;
      }

      showToast({
        type: failed > 0 ? 'warning' : 'success',
        title: '清理完成',
        description: `成功 ${freed} 项${failed > 0 ? `，失败 ${failed} 项` : ''}`,
      });

      // 移除已删除的决策
      setReport((prev) =>
        prev
          ? {
              ...prev,
              decisions: prev.decisions.filter((d) => !selectedPaths.has(d.real_path)),
            }
          : prev,
      );
      setSelectedPaths(new Set());
      triggerHealthRefresh();
    } catch (e) {
      if (e === 'PREMIUM_REQUIRED') return;
      showToast({ type: 'error', title: '清理失败', description: String(e) });
    } finally {
      setIsDeleting(false);
    }
  }, [selectedDecisions, selectedPaths, showToast, triggerHealthRefresh]);

  // ============================================================
  // 渲染
  // ============================================================
  const totalEvidenceMb = evidence?.evidence.reduce((s, e) => s + e.size_mb, 0) || 0;

  return (
    <>
      {isDeleting &&
        createPortal(
          <div className="fixed inset-0 z-[9999] bg-black/50 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-[var(--bg-card)] rounded-2xl p-8 shadow-2xl flex flex-col items-center gap-4">
              <Loader2 className="w-10 h-10 text-[var(--brand-green)] animate-spin" />
              <p className="text-sm text-[var(--text-secondary)]">正在执行清理...</p>
            </div>
          </div>,
          document.body,
        )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="确认 AI 推荐清理"
        description={`你将清理 ${selectedDecisions.length} 项，约 ${formatSize(selectedSizeMb * 1024 * 1024)}。残留文件夹送回收站，其它文件增强删除。`}
        warning="请再次确认 AI 的判断。删除前建议核对重要数据。"
        confirmText="确认清理"
        cancelText="取消"
        onConfirm={() => {
          setShowDeleteConfirm(false);
          handleExecute();
        }}
        onCancel={() => setShowDeleteConfirm(false)}
        isDanger
      />

      <ModuleCard
        id="aiCleaner"
        title="AI 智能清理"
        description="AI 综合分析残留、缓存、虚拟环境，智能判断哪些可安全清理"
        icon={<Brain className="w-6 h-6 text-[var(--brand-green)]" />}
        status={moduleState.status}
        fileCount={moduleState.fileCount}
        totalSize={moduleState.totalSize}
        countLabel="项可优化"
        expanded={isExpanded}
        onToggleExpand={() => setExpandedModule(isExpanded ? null : 'aiCleaner')}
        onScan={handleScan}
        scanButtonText="开始扫描"
        error={moduleState.error}
        headerExtra={
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-main)] text-[var(--text-muted)] hover:text-[var(--text-primary)] border border-[var(--border-color)] transition"
            title="AI 分析设置"
          >
            <Settings2 className="w-3.5 h-3.5" />
            设置
          </button>
        }
      >
        <div className="space-y-3">
          {/* 设置面板 */}
          {showSettings && <AiSettingsPanel config={config} onUpdate={updateConfig} />}

          {/* 证据总览（免费可见） */}
          {evidence && (
            <div className="rounded-xl bg-gradient-to-br from-[var(--brand-green)]/10 to-transparent border border-[var(--brand-green)]/20 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] text-[var(--text-secondary)]">检测到可优化项</div>
                  <div className="text-[24px] font-bold text-[var(--brand-green)] tabular-nums mt-0.5">
                    {formatSize(totalEvidenceMb * 1024 * 1024)}
                  </div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    共 {evidence.evidence.length} 项 · C 盘可用 {evidence.system.drive_c_free_gb} GB
                  </div>
                </div>
                {!report && (
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold text-white bg-[var(--brand-green)] hover:bg-[var(--brand-green-hover)] disabled:opacity-60 transition"
                  >
                    {analyzing ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        AI 分析中...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        {isPremium ? 'AI 智能分析' : '🔒 AI 智能分析'}
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* 免费用户分类预览（不调 AI 也能看到分布） */}
              {!report && (
                <div className="mt-3 pt-3 border-t border-[var(--brand-green)]/20 grid grid-cols-2 gap-1.5">
                  {Object.entries(
                    evidence.evidence.reduce<Record<string, { count: number; mb: number }>>(
                      (acc, e) => {
                        const k = e.type;
                        if (!acc[k]) acc[k] = { count: 0, mb: 0 };
                        acc[k].count++;
                        acc[k].mb += e.size_mb;
                        return acc;
                      },
                      {},
                    ),
                  ).map(([type, stat]) => (
                    <div key={type} className="flex items-center justify-between text-[11px]">
                      <span className="text-[var(--text-secondary)]">
                        {AI_EVIDENCE_TYPE_LABEL[type as keyof typeof AI_EVIDENCE_TYPE_LABEL] || type}
                        <span className="text-[var(--text-muted)] ml-1">×{stat.count}</span>
                      </span>
                      <span className="text-[var(--text-muted)] tabular-nums">
                        {formatSize(stat.mb * 1024 * 1024)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* AI 报告 */}
          {report && (
            <>
              <div className="flex items-center gap-2 px-1">
                <ShieldCheck className="w-4 h-4 text-[var(--brand-green)]" />
                <span className="text-[13px] text-[var(--text-secondary)]">{report.summary}</span>
              </div>

              <div className="space-y-2">
                {report.decisions.map((d: AiDecisionResolved) => (
                  <AiDecisionCard
                    key={d.real_path}
                    decision={d}
                    selected={selectedPaths.has(d.real_path)}
                    onToggle={() => toggleSelect(d.real_path)}
                    onOpenFolder={handleOpenFolder}
                  />
                ))}
              </div>

              {/* 执行栏 */}
              {selectedDecisions.length > 0 && (
                <div className="sticky bottom-0 flex items-center justify-between gap-3 bg-[var(--bg-card)] border-t border-[var(--border-color)] pt-3 mt-2">
                  <span className="text-[12px] text-[var(--text-secondary)]">
                    已选 {selectedDecisions.length} 项 · {formatSize(selectedSizeMb * 1024 * 1024)}
                  </span>
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white bg-[var(--color-danger)] hover:opacity-90 transition"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    清理选中项
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </ModuleCard>
    </>
  );
}
