// ============================================================================
// 后端 API 客户端：调用 /activate、/unbind、/heartbeat
//
// 鉴权：所有请求都带 `X-App-Sign: hmac_sha256_hex(body)`，secret 内置在 Rust，
// 防止接口被随意爬取/扫描。
// ============================================================================

use hmac::{Hmac, Mac};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::time::Duration;

use super::{
    app_sign_secret_bytes, CLIENT_VERSION, DEFAULT_API_BASE,
};

type HmacSha256 = Hmac<Sha256>;

const REQUEST_TIMEOUT_SECS: u64 = 15;

// ---------------------------------------------------------------------------
// 请求 / 响应类型
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize)]
pub struct ActivateRequest<'a> {
    pub card: &'a str,
    pub fingerprint: &'a str,
    pub version: &'a str,
}

#[derive(Debug, Deserialize)]
pub struct ActivateResponse {
    pub token: String,
    pub tier: String,
    pub expires_at: i64,
}

#[derive(Debug, Serialize)]
pub struct UnbindRequest<'a> {
    pub card: &'a str,
    pub fingerprint: &'a str,
    pub reason: Option<&'a str>,
}

#[derive(Debug, Deserialize)]
pub struct UnbindResponse {
    pub ok: bool,
    #[serde(default)]
    pub ticket_id: Option<String>,
    #[serde(default)]
    pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ApiError {
    pub error: String,
    #[serde(default)]
    pub message: Option<String>,
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

pub async fn activate(card: &str, fingerprint: &str) -> Result<ActivateResponse, String> {
    let body = ActivateRequest {
        card,
        fingerprint,
        version: CLIENT_VERSION,
    };
    post_json::<_, ActivateResponse>("/api/activate", &body).await
}

pub async fn unbind(
    card: &str,
    fingerprint: &str,
    reason: Option<&str>,
) -> Result<UnbindResponse, String> {
    let body = UnbindRequest {
        card,
        fingerprint,
        reason,
    };
    post_json::<_, UnbindResponse>("/api/unbind", &body).await
}

// ---------------------------------------------------------------------------
// 内部 HTTP 实现
// ---------------------------------------------------------------------------

fn api_base() -> String {
    std::env::var("LIGHTC_API_BASE").unwrap_or_else(|_| DEFAULT_API_BASE.to_string())
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .user_agent(format!("LightC/{}", CLIENT_VERSION))
        .build()
        .map_err(|e| format!("HTTP client 构建失败: {}", e))
}

fn sign_body(body: &[u8]) -> String {
    let secret = app_sign_secret_bytes();
    let mut mac = HmacSha256::new_from_slice(&secret).expect("HMAC key 长度无效");
    mac.update(body);
    let bytes = mac.finalize().into_bytes();
    hex_lower(&bytes)
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

async fn post_json<Req: Serialize, Resp: for<'de> Deserialize<'de>>(
    path: &str,
    body: &Req,
) -> Result<Resp, String> {
    let client = build_client()?;
    let url = format!("{}{}", api_base().trim_end_matches('/'), path);
    let body_bytes =
        serde_json::to_vec(body).map_err(|e| format!("请求序列化失败: {}", e))?;
    let sign = sign_body(&body_bytes);

    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("X-App-Sign", sign)
        .body(body_bytes)
        .send()
        .await
        .map_err(|e| format!("请求 {} 失败: {}", path, e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if !status.is_success() {
        // 优先解析 API 风格错误
        if let Ok(api_err) = serde_json::from_str::<ApiError>(&text) {
            return Err(api_err.message.unwrap_or(api_err.error));
        }
        return Err(format!("HTTP {} — {}", status.as_u16(), text));
    }

    serde_json::from_str::<Resp>(&text)
        .map_err(|e| format!("响应解析失败: {} (body: {})", e, text))
}
