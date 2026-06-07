// ============================================================================
// 本地 license 加密存储
//
// 存储位置：%LOCALAPPDATA%\LightC\license.dat
// 加密算法：AES-256-GCM
// 密钥派生：HKDF-SHA256(salt = AES_PEPPER, ikm = machine_fingerprint, info = "lightc-license-v1") → 32 字节
//
// 文件结构：
//   [12 bytes nonce][N bytes ciphertext + 16 bytes auth tag]
//
// 明文是一个 JSON：
//   {
//     "token": "<license token>",     // 服务器签发的签名 token
//     "last_seen": 1733400000          // 防时间回拨：客户端见过的最新时间戳
//   }
// ============================================================================

use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use chrono::Utc;
use hkdf::Hkdf;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fs;
use std::path::PathBuf;

use super::{fingerprint, token};

const LICENSE_FILENAME: &str = "license.dat";
const HKDF_INFO: &[u8] = b"lightc-license-v1";

#[derive(Debug, Serialize, Deserialize)]
struct StoredPayload {
    token: String,
    last_seen: i64,
}

// ---------------------------------------------------------------------------
// 公共接口
// ---------------------------------------------------------------------------

/// 加载本地 license，返回已校验通过的 claims。
/// 文件不存在时返回 Ok(None)；解密/校验失败返回 Err。
pub fn load_local_token() -> Result<Option<token::LicenseClaims>, String> {
    let path = license_path();
    if !path.exists() {
        return Ok(None);
    }

    let blob = fs::read(&path).map_err(|e| format!("读取 license.dat 失败: {}", e))?;
    let payload = decrypt(&blob)?;

    // 时间回拨检测
    let now = Utc::now().timestamp();
    if payload.last_seen > now {
        return Err(format!(
            "检测到系统时间回拨：last_seen={} now={}",
            payload.last_seen, now
        ));
    }

    // token 签名 + 机器指纹校验
    let fp = fingerprint::get();
    let claims = token::verify_token(&payload.token, &fp)?;

    // 更新 last_seen 为当前时间（自我修正）
    write_local_token(&payload.token).ok();

    Ok(Some(claims))
}

/// 写入新的 license token（覆盖旧文件）。
pub fn write_local_token(token: &str) -> Result<(), String> {
    let payload = StoredPayload {
        token: token.to_string(),
        last_seen: Utc::now().timestamp(),
    };
    let plain = serde_json::to_vec(&payload).map_err(|e| format!("payload 序列化失败: {}", e))?;
    let blob = encrypt(&plain)?;

    let path = license_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| format!("创建数据目录失败: {}", e))?;
    }
    fs::write(&path, blob).map_err(|e| format!("写入 license.dat 失败: {}", e))?;
    Ok(())
}

/// 删除本地 license（解绑 / 重置时调用）
pub fn delete_local_token() -> Result<(), String> {
    let path = license_path();
    if path.exists() {
        fs::remove_file(&path).map_err(|e| format!("删除 license.dat 失败: {}", e))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// 加解密
// ---------------------------------------------------------------------------

fn derive_key() -> Result<[u8; 32], String> {
    let fp = fingerprint::get();
    let salt = super::aes_pepper_bytes();
    let hk = Hkdf::<Sha256>::new(Some(&salt), fp.as_bytes());
    let mut okm = [0u8; 32];
    hk.expand(HKDF_INFO, &mut okm)
        .map_err(|e| format!("HKDF expand 失败: {}", e))?;
    Ok(okm)
}

fn encrypt(plain: &[u8]) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::OsRng;
    use aes_gcm::AeadCore;

    let key = derive_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("AES key 错误: {}", e))?;
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let cipher_bytes = cipher
        .encrypt(&nonce, plain)
        .map_err(|e| format!("加密失败: {}", e))?;

    let mut out = Vec::with_capacity(12 + cipher_bytes.len());
    out.extend_from_slice(nonce.as_slice());
    out.extend_from_slice(&cipher_bytes);
    Ok(out)
}

fn decrypt(blob: &[u8]) -> Result<StoredPayload, String> {
    if blob.len() < 12 + 16 {
        return Err("license.dat 数据过短".to_string());
    }
    let (nonce_bytes, cipher_bytes) = blob.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let key = derive_key()?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| format!("AES key 错误: {}", e))?;
    let plain = cipher
        .decrypt(nonce, cipher_bytes)
        .map_err(|e| format!("解密失败（机器指纹可能已变化）: {}", e))?;

    serde_json::from_slice::<StoredPayload>(&plain)
        .map_err(|e| format!("payload 反序列化失败: {}", e))
}

// ---------------------------------------------------------------------------
// 路径
// ---------------------------------------------------------------------------

fn license_path() -> PathBuf {
    // 与 data_dir 模块解耦：直接用 LOCALAPPDATA\LightC
    let base = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("LightC");
    base.join(LICENSE_FILENAME)
}
