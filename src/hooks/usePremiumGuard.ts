// ============================================================================
// 会员守卫 Hook
//
// 使用方式：
//   const guard = usePremiumGuard();
//
//   const onClean = guard(
//     async () => { await deleteFiles(items); },
//     { hint: `本次将释放 ${formatSize(totalSize)}` },
//   );
//
// 行为：
//   - 已激活会员 → 直接执行回调
//   - 未激活 / 已过期 → 弹激活窗，激活成功后自动重试原回调
// ============================================================================

import { useCallback } from 'react';
import { useLicense } from '../contexts/LicenseContext';
import { ERR_PREMIUM_REQUIRED } from '../api/commands';

interface GuardOptions {
  /** 激活弹窗展示的提示语 */
  hint?: string;
}

type AnyAsyncFn = (...args: any[]) => Promise<any> | any;

export function usePremiumGuard() {
  const { isPremium, promptActivate } = useLicense();

  /**
   * 包装一个清理回调，未激活时弹激活窗
   * 返回的函数原样接收任意参数透传给原回调
   */
  return useCallback(
    <Fn extends AnyAsyncFn>(fn: Fn, opts?: GuardOptions) => {
      return async (...args: Parameters<Fn>) => {
        if (!isPremium) {
          promptActivate({
            hint: opts?.hint,
            onActivated: () => {
              // 激活成功后 LicenseContext 会自动调度此回调
              // 此时 isPremium 已变 true，重新执行原 fn
              void fn(...args);
            },
          });
          return;
        }
        try {
          return await fn(...args);
        } catch (e) {
          // 兜底：后端返回 PREMIUM_REQUIRED（极端时序：状态刚过期、还没刷新）
          if (typeof e === 'string' && e === ERR_PREMIUM_REQUIRED) {
            promptActivate({
              hint: opts?.hint,
              onActivated: () => void fn(...args),
            });
            return;
          }
          throw e;
        }
      };
    },
    [isPremium, promptActivate],
  );
}
