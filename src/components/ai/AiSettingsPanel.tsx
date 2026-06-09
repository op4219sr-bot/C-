// ============================================================================
// AI 配置面板：模式切换（后台代理 / 自带 Key）+ BYOK 参数
// 嵌在 AiCleanerModule 头部，点击齿轮展开
// ============================================================================

import { Cloud, KeyRound, Info } from 'lucide-react';
import type { AiLlmConfig } from '../../api/commands';

interface AiSettingsPanelProps {
  config: AiLlmConfig;
  onUpdate: (updates: Partial<AiLlmConfig>) => void;
}

export function AiSettingsPanel({ config, onUpdate }: AiSettingsPanelProps) {
  return (
    <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-main)] p-4 space-y-3">
      <div className="text-[12px] font-semibold text-[var(--text-secondary)]">AI 分析方式</div>

      {/* 模式选择 */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onUpdate({ mode: 'proxy' })}
          className={`flex items-start gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
            config.mode === 'proxy'
              ? 'border-[var(--brand-green)] bg-[var(--brand-green)]/5'
              : 'border-[var(--border-color)] hover:border-[var(--brand-green)]/50'
          }`}
        >
          <Cloud className="w-4 h-4 mt-0.5 text-[var(--brand-green)] shrink-0" />
          <div>
            <div className="text-[12px] font-semibold text-[var(--text-primary)]">官方分析</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">会员额度，免配置</div>
          </div>
        </button>

        <button
          onClick={() => onUpdate({ mode: 'byok' })}
          className={`flex items-start gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
            config.mode === 'byok'
              ? 'border-[var(--brand-green)] bg-[var(--brand-green)]/5'
              : 'border-[var(--border-color)] hover:border-[var(--brand-green)]/50'
          }`}
        >
          <KeyRound className="w-4 h-4 mt-0.5 text-[var(--brand-green)] shrink-0" />
          <div>
            <div className="text-[12px] font-semibold text-[var(--text-primary)]">自带 Key</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">用自己的 API 额度</div>
          </div>
        </button>
      </div>

      {/* BYOK 参数 */}
      {config.mode === 'byok' && (
        <div className="space-y-2 pt-1">
          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">API Key</label>
            <input
              type="password"
              value={config.api_key || ''}
              onChange={(e) => onUpdate({ api_key: e.target.value })}
              placeholder="智谱 / OpenAI API Key"
              className="w-full px-2.5 py-1.5 text-[12px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-[var(--brand-green)]"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">
              API 地址（留空用智谱 GLM）
            </label>
            <input
              type="text"
              value={config.endpoint || ''}
              onChange={(e) => onUpdate({ endpoint: e.target.value })}
              placeholder="https://open.bigmodel.cn/api/paas/v4/chat/completions"
              className="w-full px-2.5 py-1.5 text-[12px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-[var(--brand-green)]"
            />
          </div>
          <div>
            <label className="block text-[11px] text-[var(--text-muted)] mb-1">
              模型名（留空用 glm-4-flash）
            </label>
            <input
              type="text"
              value={config.model || ''}
              onChange={(e) => onUpdate({ model: e.target.value })}
              placeholder="glm-4-flash"
              className="w-full px-2.5 py-1.5 text-[12px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-card)] text-[var(--text-primary)] outline-none focus:border-[var(--brand-green)]"
            />
          </div>
          <div className="flex items-start gap-1.5 text-[10px] text-[var(--text-muted)]">
            <Info className="w-3 h-3 mt-0.5 shrink-0" />
            <span>
              智谱 GLM-4-Flash 免费，去 open.bigmodel.cn 注册即可获取 Key。也支持任意
              OpenAI 兼容接口。
            </span>
          </div>
        </div>
      )}

      {/* 隐私说明 */}
      <div className="flex items-start gap-1.5 text-[10px] text-[var(--text-muted)] pt-1 border-t border-[var(--border-color)]">
        <Info className="w-3 h-3 mt-0.5 shrink-0 text-[var(--brand-green)]" />
        <span>
          隐私保护：发送给 AI 前，所有真实路径已脱敏（用户名、项目名替换为占位符），
          AI 只看到目录结构和大小，看不到你的真实文件名。
        </span>
      </div>
    </div>
  );
}
