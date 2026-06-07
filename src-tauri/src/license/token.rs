// ============================================================================
// License Token 编解码 + Ed25519 签名验证
//
// Token 格式（Base64 URL-safe，无 padding）：
//   <claims_json>.<signature>
//
// claims_json 字段：
//   {
//     "card_id":       "uuid",         // 卡密 ID
//     "tier":          "year",         // Tier
//     "fingerprint":   "hex16",        // 绑定机器指纹
//     "issued_at":     1733400000,     // Unix 秒
//     "expires_at":    1764936000,     // Unix 秒
//     "version":       1               // 协议版本
//   }
//
// signature 是 Ed25519(claims_json_bytes) → 64 字节
// ============================================================================

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use super::Tier;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseClaims {
    pub card_id: String,
    pub tier: Tier,
    pub fingerprint: String,
    pub issued_at: i64,
    pub expires_at: i64,
    #[serde(default = "default_version")]
    pub version: u32,
}

fn default_version() -> u32 {
    1
}

/// 解析并校验 token
///
/// 校验项：
///   1. 格式（必须含一个点分隔的两段）
///   2. Ed25519 签名（用内置公钥）
///   3. claims 必填字段非空
///   4. fingerprint 与本机匹配（防 token 复制到他机）
pub fn verify_token(token: &str, expected_fingerprint: &str) -> Result<LicenseClaims, String> {
    let (claims_b64, sig_b64) = token
        .split_once('.')
        .ok_or_else(|| "token 格式错误：缺少分隔符".to_string())?;

    let claims_bytes = URL_SAFE_NO_PAD
        .decode(claims_b64)
        .map_err(|e| format!("claims base64 解码失败: {}", e))?;
    let sig_bytes = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|e| format!("signature base64 解码失败: {}", e))?;

    // 签名校验
    let pubkey_raw = super::pubkey_bytes();
    let pubkey_arr: [u8; 32] = pubkey_raw
        .as_slice()
        .try_into()
        .map_err(|_| "内置公钥长度错误".to_string())?;
    let verifying_key =
        VerifyingKey::from_bytes(&pubkey_arr).map_err(|e| format!("公钥解析失败: {}", e))?;
    let sig_arr: [u8; 64] = sig_bytes
        .as_slice()
        .try_into()
        .map_err(|_| "签名长度错误".to_string())?;
    let signature = Signature::from_bytes(&sig_arr);
    verifying_key
        .verify(&claims_bytes, &signature)
        .map_err(|e| format!("签名校验失败: {}", e))?;

    // 反序列化 claims
    let claims: LicenseClaims =
        serde_json::from_slice(&claims_bytes).map_err(|e| format!("claims 反序列化失败: {}", e))?;

    // 字段合法性
    if claims.card_id.is_empty() {
        return Err("claims.card_id 为空".to_string());
    }
    if claims.fingerprint.is_empty() {
        return Err("claims.fingerprint 为空".to_string());
    }
    if claims.expires_at <= claims.issued_at {
        return Err("claims 时间字段非法".to_string());
    }

    // 机器指纹匹配
    if !claims.fingerprint.eq_ignore_ascii_case(expected_fingerprint) {
        return Err("license 与本机器指纹不匹配".to_string());
    }

    Ok(claims)
}
