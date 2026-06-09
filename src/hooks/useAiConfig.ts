// ============================================================================
// AI 清理配置 hook（localStorage 持久化）
//
// 存储 LLM 调用模式 + BYOK 的 API Key / endpoint / model
// ============================================================================

import { useCallback, useState } from 'react';
import type { AiLlmConfig, AiLlmMode } from '../api/commands';

const STORAGE_KEY = 'lightc-ai-config';

const DEFAULT_CONFIG: AiLlmConfig = {
  mode: 'proxy', // 默认走后台代理（会员额度）
  api_key: '',
  endpoint: '',
  model: '',
};

function load(): AiLlmConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch (e) {
    console.error('读取 AI 配置失败:', e);
  }
  return DEFAULT_CONFIG;
}

export function useAiConfig() {
  const [config, setConfig] = useState<AiLlmConfig>(load);

  const updateConfig = useCallback((updates: Partial<AiLlmConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...updates };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch (e) {
        console.error('保存 AI 配置失败:', e);
      }
      return next;
    });
  }, []);

  const setMode = useCallback(
    (mode: AiLlmMode) => updateConfig({ mode }),
    [updateConfig],
  );

  return { config, updateConfig, setMode };
}
