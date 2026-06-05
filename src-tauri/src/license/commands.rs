// ============================================================================
// License 相关 Tauri 命令
//
//   - get_license_status     查询当前 license 状态
//   - get_machine_fingerprint 返回机器指纹（供用户复制给客服）
//   - activate_license       使用卡密激活
//   - deactivate_license     解绑当前机器
//   - verify_card_format     前端实时校验卡密格式
// ============================================================================

use crc32fast::Hasher as Crc32;
use log::{info, warn};
use serde::{Deserialize, Serialize};

use super::{
    client, current_status, fingerprint, set_status, storage, token, LicenseStatus,
};

// ---------------------------------------------------------------------------
// 命令
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn get_license_status() -> LicenseStatus {
    current_status()
}

#[tauri::command]
pub fn get_machine_fingerprint() -> String {
    fingerprint::get()
}

#[derive(Debug, Serialize)]
pub struct ActivateResult {
    pub status: LicenseStatus,
}

#[tauri::command]
pub async fn activate_license(card: String) -> Result<ActivateResult, String> {
    let normalized = normalize_card(&card);
    info!("[license] activate_license: card={}", mask_card(&normalized));

    if !is_card_format_valid(&normalized) {
        return Err("卡密格式不正确，请检查后重试".to_string());
    }

    let fp = fingerprint::get();
    let resp = client::activate(&normalized, &fp).await?;

    // 信任服务器之前，再用本地公钥校一遍签名 + 指纹
    let claims = token::verify_token(&resp.token, &fp)
        .map_err(|e| format!("服务器返回的 license 校验失败: {}", e))?;

    storage::write_local_token(&resp.token)?;

    let status = LicenseStatus::from_claims(&claims);
    set_status(status.clone());
    info!(
        "[license] 激活成功: tier={:?} expires_at={}",
        claims.tier, claims.expires_at
    );

    Ok(ActivateResult { status })
}

#[derive(Debug, Deserialize, Default)]
pub struct DeactivateRequest {
    /// 可选：用户描述解绑原因（更换设备 / 系统重装等）
    #[serde(default)]
    pub reason: Option<String>,
}

#[tauri::command]
pub async fn deactivate_license(
    request: Option<DeactivateRequest>,
) -> Result<LicenseStatus, String> {
    let req = request.unwrap_or_default();
    let fp = fingerprint::get();
    info!("[license] deactivate_license: fingerprint={}", &fp[..8]);

    // 尽力通知服务器解绑（失败不阻塞本地清理）
    if let Err(e) = client::unbind(&fp, req.reason.as_deref()).await {
        warn!("[license] 通知服务器解绑失败: {}（仍继续本地清理）", e);
    }

    storage::delete_local_token()?;
    set_status(LicenseStatus::Free);
    Ok(LicenseStatus::Free)
}

#[tauri::command]
pub fn verify_card_format(card: String) -> bool {
    is_card_format_valid(&normalize_card(&card))
}

// ---------------------------------------------------------------------------
// 卡密格式校验（本地）
// ---------------------------------------------------------------------------

/// 卡密字符集（与生成端一致：去除 0/O/1/I/L 易混淆字符的 Base32）
const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/// 规范化：去除空白与横线，转大写
fn normalize_card(card: &str) -> String {
    card.chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

/// 校验卡密格式：LCxxxxxxxxxxxxxxxxxxxx (LC + 20 字符)，最后 4 字符是 CRC32 校验
fn is_card_format_valid(normalized: &str) -> bool {
    if normalized.len() != 22 || !normalized.starts_with("LC") {
        return false;
    }
    let body = &normalized[2..]; // 20 字符
    // 字符集
    for c in body.bytes() {
        if !ALPHABET.contains(&c) {
            return false;
        }
    }
    // CRC 校验
    let (payload, checksum) = body.split_at(16);
    let mut hasher = Crc32::new();
    hasher.update(b"LC");
    hasher.update(payload.as_bytes());
    let crc = hasher.finalize();
    let expected = checksum_to_base27(crc, 4);
    expected == checksum
}

/// 将 32-bit 数值映射到 4 个字符（base 27），与后端 gen_card 工具一致
fn checksum_to_base27(value: u32, len: usize) -> String {
    let base = ALPHABET.len() as u32; // 27
    let mut buf = vec![0u8; len];
    let mut v = value;
    for slot in buf.iter_mut().rev() {
        *slot = ALPHABET[(v % base) as usize];
        v /= base;
    }
    String::from_utf8(buf).unwrap()
}

// ---------------------------------------------------------------------------
// 日志脱敏
// ---------------------------------------------------------------------------

fn mask_card(card: &str) -> String {
    if card.len() <= 6 {
        return "******".to_string();
    }
    let head = &card[..4];
    let tail = &card[card.len() - 2..];
    format!("{}****{}", head, tail)
}
