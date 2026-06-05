// ============================================================================
// 命令守卫：清理类命令开头调用 ensure_premium()，未激活时统一返回错误
// ============================================================================

use super::{current_status, LicenseStatus};

/// 错误标志：前端识别到该字符串后弹激活窗
pub const ERR_PREMIUM_REQUIRED: &str = "PREMIUM_REQUIRED";

/// 检查当前是否处于有效付费状态；未激活/已过期时返回标准化错误字符串
pub fn ensure_premium() -> Result<(), String> {
    let status = current_status();
    if status.is_premium_active() {
        return Ok(());
    }
    match status {
        LicenseStatus::Free => {
            log::info!("[license] 拒绝执行：免费用户调用了会员命令");
            Err(ERR_PREMIUM_REQUIRED.to_string())
        }
        LicenseStatus::Expired { tier, expired_at } => {
            log::info!(
                "[license] 拒绝执行：license 已过期 tier={:?} expired_at={}",
                tier,
                expired_at
            );
            Err(ERR_PREMIUM_REQUIRED.to_string())
        }
        LicenseStatus::Premium { .. } => unreachable!(),
    }
}
