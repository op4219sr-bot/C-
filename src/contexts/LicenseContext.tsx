// ============================================================================
// License 上下文 —— 卡密激活全局状态
//
// 启动时调用 get_license_status 拉取本地状态；
// 激活/解绑/过期检查后调用 refresh() 刷新；
// 同时维护"激活弹窗触发器"（任何模块的清理动作未激活时调 promptActivate()）。
// ============================================================================

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import {
  getLicenseStatus,
  PREMIUM_REQUIRED_EVENT,
  type LicenseStatus,
} from '../api/commands';

interface ActivationPrompt {
  /** 弹窗里展示的辅助文案，常用于"本次将释放 XX GB" */
  hint?: string;
  /** 激活成功后自动重试的回调 */
  onActivated?: () => void;
}

interface LicenseContextValue {
  /** 当前 license 状态（首次拉取前为 null） */
  status: LicenseStatus | null;
  /** 是否当前为有效会员 */
  isPremium: boolean;
  /** 是否已加载完毕（避免闪烁） */
  loaded: boolean;
  /** 拉取最新状态（激活/解绑后调用） */
  refresh: () => Promise<void>;
  /** 激活弹窗状态 —— 由 ActivationModal 消费 */
  prompt: ActivationPrompt | null;
  /** 触发激活弹窗（任何位置调用） */
  promptActivate: (prompt?: ActivationPrompt) => void;
  /** 关闭激活弹窗 */
  closePrompt: () => void;
  /** 激活成功后由 ActivationModal 调用：刷新状态 + 触发回调 + 关闭 */
  onActivationSuccess: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextValue | null>(null);

export function useLicense() {
  const ctx = useContext(LicenseContext);
  if (!ctx) {
    throw new Error('useLicense must be used within LicenseProvider');
  }
  return ctx;
}

interface LicenseProviderProps {
  children: ReactNode;
}

export function LicenseProvider({ children }: LicenseProviderProps) {
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState<ActivationPrompt | null>(null);
  // 当前 prompt 对应的回调挂在 ref，避免 prompt 引用变化时丢失
  const pendingCallbackRef = useRef<(() => void) | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const s = await getLicenseStatus();
      setStatus(s);
    } catch (e) {
      console.error('[license] getLicenseStatus failed:', e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 周期性检查过期（每 60 秒，处理用户开着应用跨过期点的情况）
  useEffect(() => {
    if (!status || status.status !== 'premium') return;
    const tick = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      if (now >= status.expires_at) {
        refresh();
      }
    }, 60_000);
    return () => clearInterval(tick);
  }, [status, refresh]);

  const isPremium = status?.status === 'premium';

  const promptActivate = useCallback((p?: ActivationPrompt) => {
    pendingCallbackRef.current = p?.onActivated;
    setPrompt({ hint: p?.hint });
  }, []);

  // 监听后端 PREMIUM_REQUIRED 全局事件：任意会员命令被拦截 → 自动弹激活窗
  useEffect(() => {
    const onEvent = () => {
      pendingCallbackRef.current = undefined;
      setPrompt({ hint: '该功能需要会员，激活后即可使用' });
    };
    window.addEventListener(PREMIUM_REQUIRED_EVENT, onEvent);
    return () => window.removeEventListener(PREMIUM_REQUIRED_EVENT, onEvent);
  }, []);

  const closePrompt = useCallback(() => {
    pendingCallbackRef.current = undefined;
    setPrompt(null);
  }, []);

  const onActivationSuccess = useCallback(async () => {
    await refresh();
    const cb = pendingCallbackRef.current;
    pendingCallbackRef.current = undefined;
    setPrompt(null);
    // 微小延迟让弹窗关闭动画跑完
    setTimeout(() => cb?.(), 200);
  }, [refresh]);

  const value: LicenseContextValue = {
    status,
    isPremium,
    loaded,
    refresh,
    prompt,
    promptActivate,
    closePrompt,
    onActivationSuccess,
  };

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
}
