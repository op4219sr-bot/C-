// ============================================================================
// AI 清理顾问 Tauri 命令
//
//   - collect_ai_evidence()        免费：收集证据包（脱敏）
//   - analyze_ai_evidence(...)     会员：调 LLM 分析 + 反脱敏，返回真实路径报告
//
// 由于脱敏映射（Sanitizer）需要在"收集"和"反脱敏"之间保持，这里用全局
// 单例缓存最近一次收集的 Sanitizer + 原始证据。
// ============================================================================

use std::sync::Mutex;

use super::evidence;
use super::llm_client;
use super::sanitize::Sanitizer;
use super::{
    AiDecisionResolved, AiReportResolved, EvidencePackage, EvidenceType, LlmConfig,
};
use crate::license::guard::ensure_premium;

/// 缓存最近一次收集的状态（脱敏映射 + 证据类型映射）
struct EvidenceCache {
    sanitizer: Sanitizer,
    /// 脱敏路径 → 证据类型（用于反脱敏后告诉前端调哪个删除引擎）
    path_to_type: std::collections::HashMap<String, EvidenceType>,
}

static EVIDENCE_CACHE: std::sync::LazyLock<Mutex<Option<EvidenceCache>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

// ============================================================================
// 命令 1：收集证据（免费）
// ============================================================================

#[tauri::command]
pub async fn collect_ai_evidence() -> Result<EvidencePackage, String> {
    log::info!("[ai_cleaner] 开始收集证据...");

    let pkg = tokio::task::spawn_blocking(|| {
        let mut sanitizer = Sanitizer::new();
        let pkg = evidence::collect(&mut sanitizer);

        // 缓存脱敏映射 + 路径类型表
        let mut path_to_type = std::collections::HashMap::new();
        for item in &pkg.evidence {
            path_to_type.insert(item.path.clone(), item.evidence_type);
        }
        *EVIDENCE_CACHE.lock().unwrap() = Some(EvidenceCache {
            sanitizer,
            path_to_type,
        });

        pkg
    })
    .await
    .map_err(|e| format!("证据收集任务失败: {}", e))?;

    log::info!(
        "[ai_cleaner] 证据收集完成: {} 项, C盘可用 {}GB",
        pkg.evidence.len(),
        pkg.system.drive_c_free_gb
    );
    Ok(pkg)
}

// ============================================================================
// 命令 2：AI 分析（会员）
// ============================================================================

#[tauri::command]
pub async fn analyze_ai_evidence(
    evidence_pkg: EvidencePackage,
    config: LlmConfig,
) -> Result<AiReportResolved, String> {
    ensure_premium()?;
    log::info!(
        "[ai_cleaner] 开始 AI 分析: {} 项证据, mode={:?}",
        evidence_pkg.evidence.len(),
        config.mode
    );

    let api_base = crate::license::api_base();
    let report = llm_client::analyze(&config, &evidence_pkg, &api_base).await?;

    // 反脱敏：把 AI 返回的脱敏路径还原为真实路径
    let cache_guard = EVIDENCE_CACHE.lock().unwrap();
    let cache = cache_guard
        .as_ref()
        .ok_or_else(|| "证据缓存丢失，请重新扫描".to_string())?;

    let mut resolved_decisions = Vec::with_capacity(report.decisions.len());
    for d in &report.decisions {
        let real_path = cache.sanitizer.desanitize_path(&d.path);
        let evidence_type = cache.path_to_type.get(&d.path).copied();
        resolved_decisions.push(AiDecisionResolved {
            real_path,
            verdict: d.verdict,
            confidence: d.confidence,
            reasoning: d.reasoning.clone(),
            size_mb: d.size_mb,
            category: d.category.clone(),
            evidence_type,
        });
    }

    log::info!(
        "[ai_cleaner] AI 分析完成: {} 条决策",
        resolved_decisions.len()
    );

    Ok(AiReportResolved {
        summary: report.summary,
        decisions: resolved_decisions,
    })
}
