// ============================================================================
// LLM 客户端
//
// 支持两种模式：
//   - Byok：直接调智谱 GLM（或任意 OpenAI 兼容 endpoint），用户自带 key
//   - Proxy：走 LightC 后台 /api/ai/analyze（会员额度，服务端持有 key）
//
// 输出：解析 LLM 返回的 JSON → AiReport
// ============================================================================

use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;

use super::prompt::{FEW_SHOT, SYSTEM_PROMPT};
use super::{
    AiReport, EvidencePackage, LlmConfig, LlmMode, GLM_DEFAULT_ENDPOINT, GLM_DEFAULT_MODEL,
};

const TIMEOUT_SECS: u64 = 60;

// ============================================================================
// OpenAI 兼容请求/响应类型
// ============================================================================

#[derive(Serialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    temperature: f32,
    #[serde(skip_serializing_if = "Option::is_none")]
    response_format: Option<ResponseFormat>,
}

#[derive(Serialize)]
struct ResponseFormat {
    #[serde(rename = "type")]
    fmt_type: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Deserialize)]
struct ChatResponse {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatMessage,
}

// ============================================================================
// 公共入口
// ============================================================================

/// 调用 LLM 分析证据包，返回脱敏路径的 AiReport
pub async fn analyze(
    config: &LlmConfig,
    evidence: &EvidencePackage,
    api_base_for_proxy: &str,
) -> Result<AiReport, String> {
    match config.mode {
        LlmMode::Byok => analyze_byok(config, evidence).await,
        LlmMode::Proxy => analyze_proxy(evidence, api_base_for_proxy).await,
    }
}

// ============================================================================
// BYOK：直连 LLM
// ============================================================================

async fn analyze_byok(config: &LlmConfig, evidence: &EvidencePackage) -> Result<AiReport, String> {
    let api_key = config
        .api_key
        .as_deref()
        .filter(|k| !k.is_empty())
        .ok_or_else(|| "BYOK 模式需要填写 API Key".to_string())?;
    let endpoint = config
        .endpoint
        .as_deref()
        .filter(|e| !e.is_empty())
        .unwrap_or(GLM_DEFAULT_ENDPOINT);
    let model = config
        .model
        .as_deref()
        .filter(|m| !m.is_empty())
        .unwrap_or(GLM_DEFAULT_MODEL);

    let evidence_json =
        serde_json::to_string(evidence).map_err(|e| format!("证据序列化失败: {}", e))?;
    let user_content = format!("{}\n\n# 待分析证据\n{}", FEW_SHOT, evidence_json);

    let req = ChatRequest {
        model: model.to_string(),
        messages: vec![
            ChatMessage {
                role: "system".to_string(),
                content: SYSTEM_PROMPT.to_string(),
            },
            ChatMessage {
                role: "user".to_string(),
                content: user_content,
            },
        ],
        temperature: 0.2,
        response_format: Some(ResponseFormat {
            fmt_type: "json_object".to_string(),
        }),
    };

    let client = build_client()?;
    let resp = client
        .post(endpoint)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("调用 LLM 失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("LLM 返回错误 {}: {}", status.as_u16(), truncate(&text, 300)));
    }

    let chat: ChatResponse =
        serde_json::from_str(&text).map_err(|e| format!("LLM 响应解析失败: {} (原文: {})", e, truncate(&text, 200)))?;
    let content = chat
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| "LLM 返回空 choices".to_string())?;

    parse_report(&content)
}

// ============================================================================
// Proxy：走 LightC 后台
// ============================================================================

async fn analyze_proxy(
    evidence: &EvidencePackage,
    api_base: &str,
) -> Result<AiReport, String> {
    // 复用 license 模块的 HMAC 签名机制（后台 /api/ai/analyze 也校验 X-App-Sign）
    let url = format!("{}/api/ai/analyze", api_base.trim_end_matches('/'));
    let fingerprint = crate::license::fingerprint::get();

    #[derive(Serialize)]
    struct ProxyReq<'a> {
        fingerprint: &'a str,
        evidence: &'a EvidencePackage,
    }
    let body = ProxyReq {
        fingerprint: &fingerprint,
        evidence,
    };
    let body_bytes = serde_json::to_vec(&body).map_err(|e| format!("序列化失败: {}", e))?;
    let sign = crate::license::sign_app_body(&body_bytes);

    let client = build_client()?;
    let resp = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("X-App-Sign", sign)
        .body(body_bytes)
        .send()
        .await
        .map_err(|e| format!("调用后台 AI 代理失败: {}", e))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("后台返回错误 {}: {}", status.as_u16(), truncate(&text, 300)));
    }
    // 后台直接返回 AiReport JSON
    parse_report(&text)
}

// ============================================================================
// 解析 LLM 输出为 AiReport
// ============================================================================

fn parse_report(content: &str) -> Result<AiReport, String> {
    // LLM 有时会用 ```json ... ``` 包裹，剥掉
    let cleaned = strip_code_fence(content);
    serde_json::from_str::<AiReport>(&cleaned)
        .map_err(|e| format!("AI 报告解析失败: {} (内容: {})", e, truncate(&cleaned, 300)))
}

fn strip_code_fence(s: &str) -> String {
    let t = s.trim();
    if let Some(rest) = t.strip_prefix("```json") {
        return rest.trim_end_matches("```").trim().to_string();
    }
    if let Some(rest) = t.strip_prefix("```") {
        return rest.trim_end_matches("```").trim().to_string();
    }
    t.to_string()
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

fn build_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("HTTP client 构建失败: {}", e))
}
