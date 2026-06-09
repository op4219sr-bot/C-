// ============================================================================
// AI 智能清理顾问模块
//
// 理念：AI 当"决策大脑"，不直接删文件。三步走：
//   1. evidence.rs   收集"证据包"（注册表/缓存/venv/残留/元数据），路径脱敏
//   2. llm_client.rs 把证据发给 LLM，得到结构化决策报告（哪些可删/保留/为什么）
//   3. 前端勾选后，走 LightC 现有删除引擎执行（送回收站/备份）
//
// 详见 AI_CLEANER_PLAN.md
// ============================================================================

pub mod commands;
pub mod evidence;
pub mod llm_client;
pub mod prompt;
pub mod sanitize;

use serde::{Deserialize, Serialize};

// ============================================================================
// 证据类型
// ============================================================================

/// 证据类别（6 类）
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvidenceType {
    /// 卸载残留（复用 leftovers scanner）
    UninstallResidue,
    /// Python 虚拟环境（.venv / venv / conda）
    PythonVenv,
    /// 废弃项目的 node_modules
    NodeModules,
    /// AI 模型缓存（Ollama / HF / LM Studio / SD 等）
    AiModelCache,
    /// IDE 缓存（PyCharm / VSCode / Cursor 等）
    IdeCache,
    /// 通用缓存目录
    GenericCache,
}

/// 单条证据（发给 AI 前路径已脱敏）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidenceItem {
    /// 证据类别
    #[serde(rename = "type")]
    pub evidence_type: EvidenceType,
    /// 脱敏后的路径（如 <USER>\AppData\Local\<P1>）
    pub path: String,
    /// 占用大小（MB）
    pub size_mb: u64,
    /// 文件数量
    pub file_count: u32,
    /// 最后访问距今天数（-1 表示未知）
    pub last_access_days: i64,
    /// 最后修改距今天数（-1 表示未知）
    pub last_modified_days: i64,
    /// 子目录名列表（前若干个，帮助 AI 判断；已脱敏）
    #[serde(default)]
    pub subdir_names: Vec<String>,
    /// 类别专属元数据（键值对，如 tool=ollama, model=llama3）
    #[serde(default)]
    pub meta: std::collections::HashMap<String, String>,
}

/// 系统概览（发给 AI）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SystemOverview {
    pub os: String,
    /// C 盘可用空间（GB）
    pub drive_c_free_gb: u64,
    /// C 盘总大小（GB）
    pub drive_c_total_gb: u64,
}

/// 完整证据包（发给 AI 的 payload）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvidencePackage {
    pub system: SystemOverview,
    pub evidence: Vec<EvidenceItem>,
}

// ============================================================================
// AI 决策类型
// ============================================================================

/// AI 对单条证据的判定
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    /// 安全删除（高置信度残留/缓存）
    SafeToDelete,
    /// 大概率安全（建议确认）
    LikelySafe,
    /// 需用户决定（大模型/重要数据）
    NeedsUserDecision,
    /// 保留（系统/正在使用）
    Keep,
}

/// AI 决策（单条，路径为脱敏形式，前端需用映射表还原真实路径）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiDecision {
    /// 脱敏路径（与 EvidenceItem.path 对应）
    pub path: String,
    /// 判定
    pub verdict: Verdict,
    /// 置信度 0.0~1.0
    pub confidence: f32,
    /// 判定理由（中文）
    pub reasoning: String,
    /// 大小（MB，AI 透传）
    #[serde(default)]
    pub size_mb: u64,
    /// 类别（AI 透传）
    #[serde(default)]
    pub category: String,
}

/// AI 分析完整报告
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiReport {
    /// 总结（中文一句话）
    pub summary: String,
    /// 决策列表
    pub decisions: Vec<AiDecision>,
}

/// 前端最终拿到的报告（路径已还原为真实路径）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiReportResolved {
    pub summary: String,
    pub decisions: Vec<AiDecisionResolved>,
}

/// 决策（真实路径版，前端勾选后用 real_path 调删除引擎）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiDecisionResolved {
    /// 真实路径
    pub real_path: String,
    pub verdict: Verdict,
    pub confidence: f32,
    pub reasoning: String,
    pub size_mb: u64,
    pub category: String,
    /// 证据类型（前端按此决定调哪个删除引擎）
    pub evidence_type: Option<EvidenceType>,
}

// ============================================================================
// LLM 配置
// ============================================================================

/// LLM 调用模式
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmMode {
    /// 走 LightC 后台代理（会员额度，服务端持有 key）
    Proxy,
    /// 自带 key（用户填智谱/OpenAI key + endpoint）
    Byok,
}

/// LLM 配置（前端传入）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmConfig {
    pub mode: LlmMode,
    /// BYOK 模式下的 API Key
    #[serde(default)]
    pub api_key: Option<String>,
    /// BYOK 模式下的 endpoint（OpenAI 兼容格式）
    #[serde(default)]
    pub endpoint: Option<String>,
    /// BYOK 模式下的模型名（默认 glm-4-flash）
    #[serde(default)]
    pub model: Option<String>,
}

/// 智谱 GLM 默认 endpoint（OpenAI 兼容）
pub const GLM_DEFAULT_ENDPOINT: &str = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
/// 默认模型
pub const GLM_DEFAULT_MODEL: &str = "glm-4-flash";
