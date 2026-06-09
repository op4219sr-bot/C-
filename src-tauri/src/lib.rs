// ============================================================================
// C盘清理工具 - 主入口
// Windows专属的智能磁盘清理工具
// ============================================================================

// 模块声明
mod cleaner;
mod commands;
mod data_dir;
mod health_score;
mod license;
mod logger;
mod scanner;
mod system_info;
mod system_slim;

// 导出命令模块
use commands::*;
use license::commands::{
    activate_license, deactivate_license, get_license_status, get_machine_fingerprint,
    verify_card_format,
};
use tauri::{Manager, RunEvent, WindowEvent};

// ============================================================================
// 启动屏幕窗口管理
// ============================================================================

/// 关闭启动屏幕并显示主窗口
#[tauri::command]
async fn close_splashscreen(app: tauri::AppHandle) -> Result<(), String> {
    // 关闭 splashscreen 窗口
    if let Some(splash) = app.get_webview_window("splashscreen") {
        splash.close().map_err(|e| e.to_string())?;
    }

    // 显示主窗口
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 关闭主窗口前的强制清理：
/// - 触发所有后台扫描的取消标志（避免 worker 线程长时间运行）
/// - 仅打日志，不阻塞
fn cancel_all_background_scans() {
    log::info!("[shutdown] 正在取消所有后台扫描...");
    crate::scanner::big_files::cancel();
    crate::scanner::cancel_hotspot_scan();
}

/// 应用程序入口点
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 初始化日志
    env_logger::init();

    // 加载本地 license（如有）
    license::init_license_state();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // ====================================================================
        // 关窗即退：避免 Tauri 默认让 WebView2 子进程残留导致目录被锁占
        // ====================================================================
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                // 只对主窗口处理（splashscreen 关闭由 close_splashscreen 命令负责）
                if window.label() == "main" {
                    log::info!("[shutdown] 主窗口关闭，准备退出应用");
                    cancel_all_background_scans();
                    // 让 app handle 走干净的退出路径
                    let app_handle = window.app_handle().clone();
                    // 异步触发退出，避免阻塞当前事件回调
                    std::thread::spawn(move || {
                        // 给后台线程 300ms 响应取消标志
                        std::thread::sleep(std::time::Duration::from_millis(300));
                        app_handle.exit(0);
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            // 启动屏幕
            close_splashscreen,
            // 磁盘信息
            get_disk_info,
            // 扫描相关
            scan_junk_files,
            scan_category,
            scan_large_files,
            cancel_large_file_scan,
            scan_social_cache,
            get_categories,
            // 删除相关
            delete_files,
            // 工具函数
            format_size,
            open_disk_cleanup,
            open_in_folder,
            open_file,
            // 系统瘦身
            check_admin_privilege,
            get_system_slim_status,
            disable_hibernation,
            enable_hibernation,
            cleanup_winsxs,
            open_virtual_memory_settings,
            // 健康评分
            get_health_score,
            // 卸载残留和注册表清理
            scan_uninstall_leftovers,
            delete_leftover_folders,
            scan_registry_redundancy,
            delete_registry_entries,
            open_registry_backup_dir,
            // 增强删除
            enhanced_delete_files,
            get_physical_size,
            check_admin_for_path,
            // 永久删除（深度清理）
            delete_leftovers_permanent,
            check_leftover_safety,
            // 系统信息
            get_system_info,
            // 清理日志
            record_cleanup_action,
            open_logs_folder,
            get_cleanup_history,
            // C盘热点扫描
            scan_hotspot,
            cancel_hotspot_scan,
            scan_path_direct,
            cleanup_directory_contents,
            // 右键菜单清理
            scan_context_menu,
            delete_context_menu_entries,
            // 系统快捷工具
            open_startup_manager,
            open_storage_settings,
            // ProgramData 分析
            scan_programdata,
            scan_and_analyze_programdata,
            analyze_programdata,
            diff_programdata,
            clean_programdata,
            // 数据目录管理
            get_data_directory,
            set_data_directory,
            clear_local_data,
            pick_folder_dialog,
            // 卡密 / License 激活
            get_license_status,
            get_machine_fingerprint,
            activate_license,
            deactivate_license,
            verify_card_format,
        ])
        .build(tauri::generate_context!())
        .expect("启动应用程序时发生错误");

    // run_iter 让我们捕获 Exit 事件并兜底强制终止
    app.run(|_app_handle, event| {
        if let RunEvent::ExitRequested { .. } = event {
            log::info!("[shutdown] ExitRequested 收到，应用即将退出");
        }
        if let RunEvent::Exit = event {
            log::info!("[shutdown] Exit 事件，进程即将结束");
            // 兜底：Tauri 退出后立即强杀本进程，确保 WebView2 子进程也被父进程终止时一起收回
            // （Tauri 默认走 std::process::exit(0) 已经够好，这里只是日志）
        }
    });
}
