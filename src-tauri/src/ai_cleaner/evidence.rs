// ============================================================================
// 证据收集器
//
// 收集 6 类证据，整合现有 scanner，输出脱敏后的 EvidencePackage。
// 注意：所有路径在返回前都经过 Sanitizer 脱敏。真实路径映射保存在 Sanitizer
// 实例里（由 commands.rs 持有），AI 返回后用于反脱敏。
// ============================================================================

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use super::sanitize::Sanitizer;
use super::{EvidenceItem, EvidencePackage, EvidenceType, SystemOverview};

/// 收录证据的最小大小阈值（MB）—— 太小的不值得让 AI 分析
const MIN_SIZE_MB: u64 = 50;
/// 单类证据最多收集多少条（控制 LLM token）
const MAX_PER_TYPE: usize = 15;

// ============================================================================
// 入口
// ============================================================================

/// 收集完整证据包。返回 (脱敏后的包, 持有真实路径映射的 Sanitizer)。
pub fn collect(sanitizer: &mut Sanitizer) -> EvidencePackage {
    let mut items: Vec<EvidenceItem> = Vec::new();

    items.extend(collect_python_venvs(sanitizer));
    items.extend(collect_node_modules(sanitizer));
    items.extend(collect_ai_model_caches(sanitizer));
    items.extend(collect_ide_caches(sanitizer));
    // 卸载残留 / 通用缓存复用现有 scanner，体量大，放后面
    items.extend(collect_uninstall_residue(sanitizer));

    // 按大小降序
    items.sort_by(|a, b| b.size_mb.cmp(&a.size_mb));

    EvidencePackage {
        system: collect_system_overview(),
        evidence: items,
    }
}

// ============================================================================
// 系统概览
// ============================================================================

fn collect_system_overview() -> SystemOverview {
    let (total, free) = disk_c_space();
    SystemOverview {
        os: os_name(),
        drive_c_free_gb: free / (1024 * 1024 * 1024),
        drive_c_total_gb: total / (1024 * 1024 * 1024),
    }
}

#[cfg(target_os = "windows")]
fn disk_c_space() -> (u64, u64) {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use winapi::um::fileapi::GetDiskFreeSpaceExW;

    let path: Vec<u16> = OsStr::new("C:\\").encode_wide().chain(Some(0)).collect();
    let mut free: u64 = 0;
    let mut total: u64 = 0;
    unsafe {
        GetDiskFreeSpaceExW(
            path.as_ptr(),
            &mut free as *mut u64 as *mut _,
            &mut total as *mut u64 as *mut _,
            std::ptr::null_mut(),
        );
    }
    (total, free)
}

#[cfg(not(target_os = "windows"))]
fn disk_c_space() -> (u64, u64) {
    (0, 0)
}

fn os_name() -> String {
    #[cfg(target_os = "windows")]
    {
        "Windows".to_string()
    }
    #[cfg(not(target_os = "windows"))]
    {
        "Non-Windows".to_string()
    }
}

// ============================================================================
// 工具函数
// ============================================================================

fn home_dir() -> Option<PathBuf> {
    dirs::home_dir()
}

fn local_appdata() -> Option<PathBuf> {
    dirs::data_local_dir()
}

fn roaming_appdata() -> Option<PathBuf> {
    dirs::config_dir()
}

/// 递归算目录大小（字节）
fn dir_size(path: &Path) -> u64 {
    let mut size = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_file() {
                if let Ok(m) = entry.metadata() {
                    size += m.len();
                }
            } else if p.is_dir() {
                size += dir_size(&p);
            }
        }
    }
    size
}

/// 数文件数 + 取最后修改/访问时间
fn dir_stats(path: &Path) -> (u32, i64, i64) {
    let mut count = 0u32;
    let mut latest_mtime: Option<SystemTime> = None;
    let mut latest_atime: Option<SystemTime> = None;

    if let Ok(walker) = std::fs::read_dir(path) {
        for entry in walker.flatten() {
            let p = entry.path();
            if let Ok(m) = entry.metadata() {
                if p.is_file() {
                    count += 1;
                }
                if let Ok(mt) = m.modified() {
                    latest_mtime = Some(latest_mtime.map_or(mt, |o| o.max(mt)));
                }
                if let Ok(at) = m.accessed() {
                    latest_atime = Some(latest_atime.map_or(at, |o| o.max(at)));
                }
            }
        }
    }
    (
        count,
        days_since(latest_mtime),
        days_since(latest_atime),
    )
}

/// 距今天数（-1 表示未知）
fn days_since(t: Option<SystemTime>) -> i64 {
    match t {
        Some(time) => match SystemTime::now().duration_since(time) {
            Ok(d) => (d.as_secs() / 86400) as i64,
            Err(_) => 0,
        },
        None => -1,
    }
}

/// 取目录的前若干个子目录名
fn subdir_names(path: &Path, limit: usize) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if entry.path().is_dir() {
                if let Some(n) = entry.file_name().to_str() {
                    names.push(n.to_string());
                    if names.len() >= limit {
                        break;
                    }
                }
            }
        }
    }
    names
}

/// 构建一条证据（自动脱敏路径 + 子目录名）
fn build_item(
    sanitizer: &mut Sanitizer,
    evidence_type: EvidenceType,
    real_path: &Path,
    meta: HashMap<String, String>,
) -> Option<EvidenceItem> {
    let size = dir_size(real_path);
    let size_mb = size / (1024 * 1024);
    if size_mb < MIN_SIZE_MB {
        return None;
    }
    let (file_count, last_modified_days, last_access_days) = dir_stats(real_path);
    let raw_subdirs = subdir_names(real_path, 8);
    // 子目录名也脱敏（可能含项目名）
    let subdirs: Vec<String> = raw_subdirs
        .iter()
        .map(|n| {
            // 用脱敏器把目录名映射成占位（保持一致性）
            let fake = sanitizer.sanitize_path(&format!("X:\\{}", n));
            fake.trim_start_matches("X:\\").to_string()
        })
        .collect();

    Some(EvidenceItem {
        evidence_type,
        path: sanitizer.sanitize_path(&real_path.to_string_lossy()),
        size_mb,
        file_count,
        last_access_days,
        last_modified_days,
        subdir_names: subdirs,
        meta,
    })
}

// ============================================================================
// 1. Python 虚拟环境
// ============================================================================

fn collect_python_venvs(sanitizer: &mut Sanitizer) -> Vec<EvidenceItem> {
    let mut out = Vec::new();
    // 扫描常见项目根目录
    let roots = candidate_project_roots();
    for root in roots {
        find_dirs_named(&root, &[".venv", "venv", "env"], 3, &mut |venv_path| {
            // 确认是 venv（含 Scripts/python.exe 或 pyvenv.cfg）
            let is_venv = venv_path.join("pyvenv.cfg").exists()
                || venv_path.join("Scripts").join("python.exe").exists()
                || venv_path.join("bin").join("python").exists();
            if !is_venv {
                return;
            }
            let mut meta = HashMap::new();
            // 父项目最后活动天数
            if let Some(parent) = venv_path.parent() {
                let (_, pmod, _) = dir_stats(parent);
                meta.insert("parent_last_modified_days".to_string(), pmod.to_string());
            }
            if let Some(item) =
                build_item(sanitizer, EvidenceType::PythonVenv, venv_path, meta)
            {
                out.push(item);
            }
        });
        if out.len() >= MAX_PER_TYPE {
            break;
        }
    }
    out.truncate(MAX_PER_TYPE);
    out
}

// ============================================================================
// 2. node_modules
// ============================================================================

fn collect_node_modules(sanitizer: &mut Sanitizer) -> Vec<EvidenceItem> {
    let mut out = Vec::new();
    let roots = candidate_project_roots();
    for root in roots {
        find_dirs_named(&root, &["node_modules"], 3, &mut |nm_path| {
            let mut meta = HashMap::new();
            if let Some(parent) = nm_path.parent() {
                let has_pkg = parent.join("package.json").exists();
                meta.insert("has_package_json".to_string(), has_pkg.to_string());
                let (_, pmod, _) = dir_stats(parent);
                meta.insert("parent_last_modified_days".to_string(), pmod.to_string());
            }
            if let Some(item) =
                build_item(sanitizer, EvidenceType::NodeModules, nm_path, meta)
            {
                out.push(item);
            }
        });
        if out.len() >= MAX_PER_TYPE {
            break;
        }
    }
    out.truncate(MAX_PER_TYPE);
    out
}

// ============================================================================
// 3. AI 模型缓存
// ============================================================================

fn collect_ai_model_caches(sanitizer: &mut Sanitizer) -> Vec<EvidenceItem> {
    let mut out = Vec::new();
    let home = match home_dir() {
        Some(h) => h,
        None => return out,
    };

    // (工具名, 相对 home 的路径)
    let targets: &[(&str, &[&str])] = &[
        ("ollama", &[".ollama", "models"]),
        ("huggingface", &[".cache", "huggingface", "hub"]),
        ("torch", &[".cache", "torch", "hub"]),
        ("lm_studio", &[".cache", "lm-studio", "models"]),
        ("whisper", &[".cache", "whisper"]),
        ("gpt4all", &[".cache", "gpt4all"]),
    ];

    for (tool, rel) in targets {
        let mut p = home.clone();
        for seg in *rel {
            p = p.join(seg);
        }
        if p.exists() && p.is_dir() {
            let mut meta = HashMap::new();
            meta.insert("tool".to_string(), tool.to_string());
            if let Some(item) =
                build_item(sanitizer, EvidenceType::AiModelCache, &p, meta)
            {
                out.push(item);
            }
        }
    }

    // LOCALAPPDATA 下的 AI 应用
    if let Some(local) = local_appdata() {
        let local_targets: &[(&str, &[&str])] = &[
            ("gpt4all", &["nomic.ai", "GPT4All"]),
            ("nvidia_compute", &["NVIDIA", "ComputeCache"]),
        ];
        for (tool, rel) in local_targets {
            let mut p = local.clone();
            for seg in *rel {
                p = p.join(seg);
            }
            if p.exists() && p.is_dir() {
                let mut meta = HashMap::new();
                meta.insert("tool".to_string(), tool.to_string());
                if let Some(item) =
                    build_item(sanitizer, EvidenceType::AiModelCache, &p, meta)
                {
                    out.push(item);
                }
            }
        }
    }

    out.truncate(MAX_PER_TYPE);
    out
}

// ============================================================================
// 4. IDE 缓存
// ============================================================================

fn collect_ide_caches(sanitizer: &mut Sanitizer) -> Vec<EvidenceItem> {
    let mut out = Vec::new();

    if let Some(local) = local_appdata() {
        let targets: &[(&str, &[&str])] = &[
            ("vscode", &["Microsoft", "vscode-cpptools"]),
            ("cursor", &["Cursor", "Cache"]),
            ("jetbrains", &["JetBrains"]),
        ];
        for (tool, rel) in targets {
            let mut p = local.clone();
            for seg in *rel {
                p = p.join(seg);
            }
            if p.exists() && p.is_dir() {
                let mut meta = HashMap::new();
                meta.insert("tool".to_string(), tool.to_string());
                if let Some(item) = build_item(sanitizer, EvidenceType::IdeCache, &p, meta) {
                    out.push(item);
                }
            }
        }
    }

    out.truncate(MAX_PER_TYPE);
    out
}

// ============================================================================
// 5. 卸载残留（复用现有 scanner）
// ============================================================================

fn collect_uninstall_residue(sanitizer: &mut Sanitizer) -> Vec<EvidenceItem> {
    use crate::scanner::LeftoverScanner;

    let result = LeftoverScanner::with_deep_scan(false).scan();
    let mut out = Vec::new();
    for lo in result.leftovers.into_iter().take(MAX_PER_TYPE) {
        let size_mb = lo.size / (1024 * 1024);
        if size_mb < MIN_SIZE_MB {
            continue;
        }
        let real_path = Path::new(&lo.path);
        let mut meta = HashMap::new();
        meta.insert("app_name".to_string(), lo.app_name.clone());
        meta.insert("confidence".to_string(), format!("{:.2}", lo.confidence));
        if let Some(item) =
            build_item(sanitizer, EvidenceType::UninstallResidue, real_path, meta)
        {
            out.push(item);
        }
    }
    out
}

// ============================================================================
// 辅助：候选项目根目录 + 递归找特定名目录
// ============================================================================

/// 候选项目根目录（用户常放代码的地方）
fn candidate_project_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = home_dir() {
        for sub in &["projects", "Projects", "code", "Code", "dev", "Dev", "repos", "workspace", "Documents"] {
            let p = home.join(sub);
            if p.exists() {
                roots.push(p);
            }
        }
        roots.push(home);
    }
    // 常见盘符根目录
    #[cfg(target_os = "windows")]
    {
        for drive in &["D:\\", "E:\\"] {
            let p = PathBuf::from(drive);
            if p.exists() {
                roots.push(p);
            }
        }
    }
    roots
}

/// 在 root 下递归（限定深度）查找名为 names 之一的目录，命中后调用 cb（不再深入命中目录内部）
fn find_dirs_named<F: FnMut(&Path)>(
    root: &Path,
    names: &[&str],
    max_depth: usize,
    cb: &mut F,
) {
    find_dirs_named_inner(root, names, max_depth, 0, cb);
}

fn find_dirs_named_inner<F: FnMut(&Path)>(
    dir: &Path,
    names: &[&str],
    max_depth: usize,
    depth: usize,
    cb: &mut F,
) {
    if depth > max_depth {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        // 跳过隐藏/系统目录（避免扫 C:\Windows 等）
        if name_str.starts_with('$') || name_str.eq_ignore_ascii_case("Windows") {
            continue;
        }
        if names.iter().any(|n| name_str.eq_ignore_ascii_case(n)) {
            cb(&p);
            // 命中后不深入其内部
            continue;
        }
        find_dirs_named_inner(&p, names, max_depth, depth + 1, cb);
    }
}
