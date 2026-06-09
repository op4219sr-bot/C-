// ============================================================================
// 路径脱敏 + 反脱敏
//
// 发给 LLM 前：C:\Users\admin\AppData\Local\OldApp → <USER>\AppData\Local\<P1>
// AI 返回后：用映射表把脱敏路径还原为真实路径，再交给删除引擎。
//
// 映射表只存在本地内存，绝不上传。
// ============================================================================

use std::collections::HashMap;

/// 脱敏器：维护 真实路径片段 → 占位符 的双向映射
#[derive(Debug, Default)]
pub struct Sanitizer {
    /// 占位符 → 真实值（用于反脱敏）
    placeholder_to_real: HashMap<String, String>,
    /// 真实值 → 占位符（用于脱敏去重）
    real_to_placeholder: HashMap<String, String>,
    /// 敏感片段计数器（生成 <P1> <P2> ...）
    counter: usize,
}

impl Sanitizer {
    pub fn new() -> Self {
        Self::default()
    }

    /// 脱敏单条路径。
    /// 策略：
    ///   - C:\Users\<用户名>  → <USER>
    ///   - 路径中的"叶子目录名/项目名"等可能含个人信息的片段 → <Pn>
    ///   - 保留结构性目录（AppData/Local/Roaming/.cache/.ollama 等通用名）
    pub fn sanitize_path(&mut self, real_path: &str) -> String {
        // 统一分隔符为反斜杠
        let normalized = real_path.replace('/', "\\");
        let parts: Vec<&str> = normalized.split('\\').collect();
        let mut out: Vec<String> = Vec::with_capacity(parts.len());

        let mut i = 0;
        while i < parts.len() {
            let part = parts[i];
            let lower = part.to_lowercase();

            // 盘符（C:）原样保留
            if part.ends_with(':') {
                out.push(part.to_string());
                i += 1;
                continue;
            }

            // C:\Users\<name> → Users\<USER>
            if lower == "users" && i + 1 < parts.len() {
                out.push("Users".to_string());
                out.push("<USER>".to_string());
                // 记录用户名映射，便于其它路径里同名替换
                let username = parts[i + 1];
                self.placeholder_to_real
                    .insert("<USER>".to_string(), username.to_string());
                self.real_to_placeholder
                    .insert(username.to_lowercase(), "<USER>".to_string());
                i += 2;
                continue;
            }

            // 通用结构目录原样保留
            if is_structural_dir(&lower) {
                out.push(part.to_string());
                i += 1;
                continue;
            }

            // 其它叶子/中间目录：可能含项目名、应用名（个人信息）→ 占位
            // 但若已脱敏过同名，复用同一占位符
            if part.is_empty() {
                i += 1;
                continue;
            }
            let ph = self.placeholder_for(part);
            out.push(ph);
            i += 1;
        }

        out.join("\\")
    }

    /// 为一个真实片段分配/复用占位符
    fn placeholder_for(&mut self, real: &str) -> String {
        let key = real.to_lowercase();
        if let Some(ph) = self.real_to_placeholder.get(&key) {
            return ph.clone();
        }
        self.counter += 1;
        let ph = format!("<P{}>", self.counter);
        self.placeholder_to_real
            .insert(ph.clone(), real.to_string());
        self.real_to_placeholder.insert(key, ph.clone());
        ph
    }

    /// 反脱敏：把 AI 返回的脱敏路径还原为真实路径
    pub fn desanitize_path(&self, sanitized: &str) -> String {
        let mut result = sanitized.to_string();
        // 先替换 <USER>，再替换 <Pn>（按占位符长度降序避免 <P1> 误伤 <P10>）
        let mut keys: Vec<&String> = self.placeholder_to_real.keys().collect();
        keys.sort_by(|a, b| b.len().cmp(&a.len()));
        for ph in keys {
            if let Some(real) = self.placeholder_to_real.get(ph) {
                result = result.replace(ph, real);
            }
        }
        result
    }
}

/// 判断是否为通用结构目录（保留原名，不含个人信息）
fn is_structural_dir(lower: &str) -> bool {
    const STRUCTURAL: &[&str] = &[
        "appdata",
        "local",
        "locallow",
        "roaming",
        "temp",
        "cache",
        ".cache",
        ".ollama",
        "models",
        "hub",
        ".venv",
        "venv",
        "node_modules",
        "programdata",
        "windows",
        "program files",
        "program files (x86)",
        "huggingface",
        "torch",
        "transformers",
        "scripts",
        "lib",
        "site-packages",
        ".cursor",
        ".vscode",
        "logs",
        "log",
        "tmp",
    ];
    STRUCTURAL.contains(&lower)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_user_path() {
        let mut s = Sanitizer::new();
        let out = s.sanitize_path("C:\\Users\\admin\\AppData\\Local\\OldApp");
        assert!(out.contains("<USER>"));
        assert!(out.contains("AppData"));
        assert!(out.contains("Local"));
        // OldApp 应被占位
        assert!(out.contains("<P"));
        // 反脱敏回去
        let back = s.desanitize_path(&out);
        assert_eq!(back, "C:\\Users\\admin\\AppData\\Local\\OldApp");
    }

    #[test]
    fn test_dedup_placeholder() {
        let mut s = Sanitizer::new();
        let a = s.sanitize_path("D:\\projects\\myapp\\node_modules");
        let b = s.sanitize_path("D:\\projects\\myapp\\.venv");
        // myapp 在两条路径里应复用同一占位符
        let myapp_ph_a = a.split('\\').find(|p| p.starts_with("<P")).unwrap();
        let myapp_ph_b = b.split('\\').find(|p| p.starts_with("<P")).unwrap();
        assert_eq!(myapp_ph_a, myapp_ph_b);
    }
}
