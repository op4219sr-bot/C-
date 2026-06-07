// ============================================================================
// 机器指纹生成
//
// 组合：
//   1. MachineGuid （HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid）
//   2. C 盘卷序列号（GetVolumeInformationW）
//
// 输出：SHA256(machine_guid || ':' || volume_serial)，取前 16 字节 hex（32 字符）
//
// 注：含卷序列号意味着 **重装系统 / 换硬盘会导致指纹变化**，
// 用户需走"解绑"流程；这是反盗用的一道屏障。
// ============================================================================

use sha2::{Digest, Sha256};
use std::sync::OnceLock;

static FINGERPRINT_CACHE: OnceLock<String> = OnceLock::new();

/// 获取机器指纹（hex 字符串，长度 32）。多次调用复用首次计算结果。
pub fn get() -> String {
    FINGERPRINT_CACHE
        .get_or_init(|| {
            let guid = read_machine_guid().unwrap_or_else(|e| {
                log::warn!("[license] 读取 MachineGuid 失败: {}，使用 fallback", e);
                "UNKNOWN_GUID".to_string()
            });
            let volume = read_c_volume_serial().unwrap_or_else(|e| {
                log::warn!("[license] 读取 C 盘卷序列号失败: {}，使用 fallback", e);
                "UNKNOWN_VOLUME".to_string()
            });
            let combined = format!("{}:{}", guid, volume);
            let digest = Sha256::digest(combined.as_bytes());
            // 取前 16 字节 → 32 hex 字符
            hex_encode(&digest[..16])
        })
        .clone()
}

// ---------------------------------------------------------------------------
// MachineGuid
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn read_machine_guid() -> Result<String, String> {
    use winreg::enums::*;
    use winreg::RegKey;

    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let crypto = hklm
        .open_subkey(r"SOFTWARE\Microsoft\Cryptography")
        .map_err(|e| format!("打开注册表失败: {}", e))?;
    crypto
        .get_value::<String, _>("MachineGuid")
        .map_err(|e| format!("读取 MachineGuid 失败: {}", e))
}

#[cfg(not(target_os = "windows"))]
fn read_machine_guid() -> Result<String, String> {
    // 非 Windows 平台仅用于本地开发编译通过
    // 优先用 /etc/machine-id，否则用主机名
    use std::fs;
    if let Ok(s) = fs::read_to_string("/etc/machine-id") {
        return Ok(s.trim().to_string());
    }
    if let Ok(s) = fs::read_to_string("/var/lib/dbus/machine-id") {
        return Ok(s.trim().to_string());
    }
    Ok("DEV_MACHINE_GUID".to_string())
}

// ---------------------------------------------------------------------------
// C 盘卷序列号
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn read_c_volume_serial() -> Result<String, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::ptr;
    use winapi::um::fileapi::GetVolumeInformationW;

    let path: Vec<u16> = OsStr::new("C:\\").encode_wide().chain(Some(0)).collect();
    let mut serial: u32 = 0;
    let ok = unsafe {
        GetVolumeInformationW(
            path.as_ptr(),
            ptr::null_mut(),
            0,
            &mut serial as *mut u32,
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
            0,
        )
    };
    if ok == 0 {
        return Err("GetVolumeInformationW 返回失败".to_string());
    }
    Ok(format!("{:08X}", serial))
}

#[cfg(not(target_os = "windows"))]
fn read_c_volume_serial() -> Result<String, String> {
    Ok("DEV_VOLUME_SERIAL".to_string())
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}
