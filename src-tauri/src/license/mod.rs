// ============================================================================
// License / 卡密激活模块
//
// 职责：
//   - 机器指纹生成（fingerprint）
//   - License token 签名校验（token）
//   - 本地加密存储 license.dat（storage）
//   - 全局会员状态（status）
//   - 命令守卫宏 ensure_premium!()（guard）
//   - 调用后端 activate / unbind 接口（client）
//
// 全局状态在 lib.rs 启动时初始化（init_license_status），
// 后续清理类命令开头通过 ensure_premium!() 拦截未激活用户。
// ============================================================================

pub mod client;
pub mod commands;
pub mod fingerprint;
pub mod guard;
pub mod storage;
pub mod token;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::RwLock;

// ============================================================================
// 内置签名公钥（开发期占位，发布前请替换）
// 对应私钥保存在后端服务器
// ============================================================================

/// Ed25519 公钥（32 字节 hex）—— 用于验证服务器下发的 license token
pub const LICENSE_PUBKEY_HEX: &str =
    "cec68f495cb80ecf072ff70bdfa82412435fc6110994be520e898205eec5cf8c";

/// AES-GCM 派生密钥用的 pepper（16 字节 hex）—— 与机器指纹一起派生加密 key
pub const AES_PEPPER_HEX: &str = "9ffdc0313a00c721a9c8f5dc1c444230";

/// 与后台通信的 HMAC 签名 secret（32 字节 hex）
pub const APP_SIGN_SECRET_HEX: &str =
    "f39681045d3040cc3ca8c1b7b6cf5ead946962fd30c38a4bf1fcbcc82db9d950";

/// 默认后端 API 基址（可被环境变量覆盖）
pub const DEFAULT_API_BASE: &str = "https://license.example.com";

/// 客户端版本（上报给后端的 user_agent / version 字段）
pub const CLIENT_VERSION: &str = env!("CARGO_PKG_VERSION");

// ============================================================================
// 卡密类型 / License Tier
// ============================================================================

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tier {
    /// 1 天体验卡
    Day,
    /// 7 天周卡
    Week,
    /// 15 天半月卡
    HalfMonth,
    /// 90 天季卡
    Quarter,
    /// 180 天半年卡
    HalfYear,
    /// 365 天年卡
    Year,
}

impl Tier {
    /// 显示名（前端文案）
    pub fn label(&self) -> &'static str {
        match self {
            Tier::Day => "体验卡",
            Tier::Week => "周卡",
            Tier::HalfMonth => "半月卡",
            Tier::Quarter => "季卡",
            Tier::HalfYear => "半年卡",
            Tier::Year => "年卡",
        }
    }

    /// 时长（天）
    pub fn duration_days(&self) -> i64 {
        match self {
            Tier::Day => 1,
            Tier::Week => 7,
            Tier::HalfMonth => 15,
            Tier::Quarter => 90,
            Tier::HalfYear => 180,
            Tier::Year => 365,
        }
    }
}

// ============================================================================
// License 状态（暴露给前端）
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum LicenseStatus {
    /// 未激活（免费用户）
    Free,
    /// 激活中
    Premium {
        tier: Tier,
        /// 激活时间（Unix 秒）
        activated_at: i64,
        /// 到期时间（Unix 秒）
        expires_at: i64,
        /// 剩余天数（向下取整）
        days_left: i64,
    },
    /// 曾经激活过，已过期
    Expired {
        tier: Tier,
        expired_at: i64,
    },
}

impl LicenseStatus {
    /// 是否当前为有效付费状态
    pub fn is_premium_active(&self) -> bool {
        matches!(self, LicenseStatus::Premium { .. })
    }

    /// 从已校验的 token claims 构建状态（基于当前时间判断是否过期）
    pub fn from_claims(claims: &token::LicenseClaims) -> Self {
        let now = Utc::now().timestamp();
        if now >= claims.expires_at {
            LicenseStatus::Expired {
                tier: claims.tier,
                expired_at: claims.expires_at,
            }
        } else {
            let days_left = ((claims.expires_at - now) as f64 / 86400.0).floor() as i64;
            LicenseStatus::Premium {
                tier: claims.tier,
                activated_at: claims.issued_at,
                expires_at: claims.expires_at,
                days_left,
            }
        }
    }
}

// ============================================================================
// 全局状态
// ============================================================================

static LICENSE_STATE: std::sync::LazyLock<RwLock<LicenseStatus>> =
    std::sync::LazyLock::new(|| RwLock::new(LicenseStatus::Free));

/// 在 Tauri 启动时调用：尝试加载本地 license.dat
pub fn init_license_state() {
    match storage::load_local_token() {
        Ok(Some(claims)) => {
            let status = LicenseStatus::from_claims(&claims);
            log::info!(
                "[license] 本地 license 加载成功: tier={:?} expires_at={}",
                claims.tier,
                format_ts(claims.expires_at)
            );
            *LICENSE_STATE.write().unwrap() = status;
        }
        Ok(None) => {
            log::info!("[license] 本地无 license，进入免费模式");
        }
        Err(e) => {
            log::warn!("[license] 本地 license 加载失败: {}，进入免费模式", e);
        }
    }
}

/// 读取当前 license 状态（克隆，不长持读锁）
pub fn current_status() -> LicenseStatus {
    LICENSE_STATE.read().unwrap().clone()
}

/// 更新 license 状态（激活成功 / 解绑后调用）
pub fn set_status(status: LicenseStatus) {
    *LICENSE_STATE.write().unwrap() = status;
}

// ============================================================================
// 内部工具
// ============================================================================

fn format_ts(ts: i64) -> String {
    DateTime::<Utc>::from_timestamp(ts, 0)
        .map(|d| d.format("%Y-%m-%d %H:%M:%S UTC").to_string())
        .unwrap_or_else(|| format!("ts={}", ts))
}

fn hex_decode_const(hex: &str) -> Vec<u8> {
    let mut out = Vec::with_capacity(hex.len() / 2);
    let bytes = hex.as_bytes();
    let mut i = 0;
    while i + 1 < bytes.len() {
        let hi = hex_char(bytes[i]);
        let lo = hex_char(bytes[i + 1]);
        out.push((hi << 4) | lo);
        i += 2;
    }
    out
}

fn hex_char(c: u8) -> u8 {
    match c {
        b'0'..=b'9' => c - b'0',
        b'a'..=b'f' => c - b'a' + 10,
        b'A'..=b'F' => c - b'A' + 10,
        _ => 0,
    }
}

pub(crate) fn pubkey_bytes() -> Vec<u8> {
    hex_decode_const(LICENSE_PUBKEY_HEX)
}

pub(crate) fn aes_pepper_bytes() -> Vec<u8> {
    hex_decode_const(AES_PEPPER_HEX)
}

pub(crate) fn app_sign_secret_bytes() -> Vec<u8> {
    hex_decode_const(APP_SIGN_SECRET_HEX)
}
