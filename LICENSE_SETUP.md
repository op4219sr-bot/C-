# LightC 卡密激活集成说明

本文档记录如何配置、部署和测试 LightC 的卡密激活系统。

---

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│  LightC 桌面端（Tauri + React + Rust）              │
│  ├ 免费功能：所有扫描 + 健康评分 + 系统快捷工具      │
│  └ 会员功能：所有清理执行（delete_* / clean_* 类）   │
└──────────────────┬──────────────────────────────────┘
                   │ HTTPS（仅激活/解绑时）
┌──────────────────▼──────────────────────────────────┐
│  License Server（Node.js + SQLite）                 │
│  ├ /api/activate  /api/unbind  /api/card_info        │
│  └ /admin/        管理后台（生成 / 查询 / 操作）     │
└─────────────────────────────────────────────────────┘
```

---

## 完整设置步骤

### 1. 生成生产密钥

`.env.example` 中提供了开发用的测试密钥，**生产部署前必须重新生成**：

```bash
node -e "
const c = require('crypto');
const { publicKey, privateKey } = c.generateKeyPairSync('ed25519');
console.log('LICENSE_PUBKEY_HEX =', publicKey.export({format:'der',type:'spki'}).slice(-32).toString('hex'));
console.log('LICENSE_PRIVKEY_HEX =', privateKey.export({format:'der',type:'pkcs8'}).slice(-32).toString('hex'));
console.log('APP_SIGN_SECRET_HEX =', c.randomBytes(32).toString('hex'));
console.log('AES_PEPPER (16字节) =', c.randomBytes(16).toString('hex'));
"
```

**同步到两端**：

| 密钥 | 客户端（src-tauri/src/license/mod.rs） | 服务端（server/.env） |
|------|-----------------------------------------|----------------------|
| Ed25519 公钥 | `LICENSE_PUBKEY_HEX` | `LICENSE_PUBKEY_HEX`（自检用） |
| Ed25519 私钥 | （不存在客户端） | `LICENSE_PRIVKEY_HEX` |
| HMAC secret  | `APP_SIGN_SECRET_HEX` | `APP_SIGN_SECRET_HEX` |
| AES pepper   | `AES_PEPPER_HEX` | （不存在服务端） |
| API 地址     | `DEFAULT_API_BASE` | — |

---

### 2. 部署后端服务

```bash
cd server
npm install
cp .env.example .env
# 编辑 .env：填入第 1 步生成的密钥 + 修改 ADMIN_PASS
npm start
```

后端默认监听 `:8088`。生产建议用 Caddy/Nginx 反代到 HTTPS。

访问 `http://localhost:8088/admin/` 进入管理后台（默认 admin/changeme）。

---

### 3. 客户端配置

编辑 `src-tauri/src/license/mod.rs`，更新四个常量：

```rust
pub const LICENSE_PUBKEY_HEX: &str = "<您的 Ed25519 公钥 hex>";
pub const AES_PEPPER_HEX: &str = "<您的 AES pepper hex>";
pub const APP_SIGN_SECRET_HEX: &str = "<您的 HMAC secret hex>";
pub const DEFAULT_API_BASE: &str = "https://license.your-domain.com";
```

也可通过环境变量 `LIGHTC_API_BASE` 在运行时覆盖 API 地址（便于测试）。

---

### 4. 重新构建客户端

```bash
npm install
npm run tauri build
```

打包好的安装包在 `src-tauri/target/release/bundle/nsis/`。

---

## 测试流程

### 本地端到端测试

1. **启动后端**
   ```bash
   cd server && npm start
   ```

2. **生成测试卡密**（在后台 Web 页或命令行）
   ```bash
   node scripts/gen-cards.js --tier day --count 5 --batch test
   ```
   或访问 `/admin/` 的「批量生成」页。

3. **启动客户端**
   ```bash
   # 让客户端走本地后端
   LIGHTC_API_BASE=http://localhost:8088 npm run tauri dev
   ```

4. **操作验证**
   - 启动后顶部应显示「免费版」徽标
   - 任意点击清理按钮 → 弹激活窗
   - 复制机器码 + 输入卡密 → 激活
   - 顶部徽标变为「日卡 · 剩 1 天」
   - 再次点清理 → 直接执行
   - 设置 → 通用 → 我的授权 → 解绑 → 状态回到免费版

---

## 卡密类型速查

| Tier | 时长 | 内部代号 | 卡密前 4 位标识 |
|------|------|---------|----------------|
| 体验卡 | 1 天 | `day` | `LC-DA...` |
| 周卡 | 7 天 | `week` | `LC-WK...` |
| 半月卡 | 15 天 | `half_month` | `LC-HM...` |
| 季卡 | 90 天 | `quarter` | `LC-QT...` |
| 半年卡 | 180 天 | `half_year` | `LC-HY...` |
| 年卡 | 365 天 | `year` | `LC-YR...` |

---

## 安全机制总览

| 层级 | 机制 | 防御场景 |
|------|------|---------|
| 网络 | HTTPS + HMAC 签名 | 防接口被随意爬取 |
| 服务端 | 卡密 + 指纹双重绑定 | 防卡密跨机使用 |
| Token | Ed25519 签名 | 防本地伪造 license |
| 本地存储 | AES-GCM 加密 + 机器指纹派生密钥 | 防 license.dat 被复制 |
| 客户端 | `ensure_premium!()` 守卫宏 | 防止前端绕过 |
| 时间检测 | last_seen 时间戳 | 防系统时间回拨 |
| 双重校验 | 服务端签发后客户端再用公钥验一次 | 防中间人攻击 |

---

## 运营手册

### 客服常见处理

| 场景 | 操作 |
|------|------|
| 用户卡密激活报"已绑定其他设备" | 后台搜卡密 → 确认是该用户 → 点「强制解绑」 → 用户重新激活 |
| 用户报告卡密泄露 | 后台搜卡密 → 「封禁」并填写原因 |
| 整批卡密被刷 | 在卡密列表按批次筛选 → 逐张封禁，或后续添加批量封禁接口 |
| 重装系统激活失败 | 同"已绑定其他设备"处理 |
| 月度对账 | 用卡密列表筛选 + 翻页查看，或后续直接导出 SQLite 表 |

### 数据备份

```bash
# 每日备份
sqlite3 server/data/license.db ".backup server/data/backup-$(date +%Y%m%d).db"
```

建议加到 crontab 每日凌晨执行。

---

## 模块清单

### 受守卫的会员命令（Rust 端 `ensure_premium!()`）

- `delete_files` —— 垃圾清理删除
- `enhanced_delete_files` —— 增强删除
- `delete_leftovers_permanent` —— 永久删除残留
- `delete_leftover_folders` —— 删除残留文件夹
- `delete_registry_entries` —— 注册表删除
- `delete_context_menu_entries` —— 右键菜单删除
- `cleanup_directory_contents` —— 大目录清理
- `clean_programdata` —— ProgramData 清理
- `disable_hibernation` / `enable_hibernation` —— 休眠开关
- `cleanup_winsxs` —— WinSxS 清理

### 免费命令（所有扫描和查询）

垃圾扫描、大文件扫描、社交缓存扫描、注册表扫描、卸载残留扫描、右键菜单扫描、ProgramData 扫描、磁盘信息、健康评分、系统信息、所有 `open_*` 工具函数。

---

## 故障排查

| 现象 | 排查方向 |
|------|---------|
| 客户端激活提示「服务器返回的 license 校验失败」 | 客户端公钥 ≠ 服务端私钥；重新同步密钥 |
| 客户端激活提示「卡密格式不正确」 | 卡密拼写错误，或客户端字符集表与服务端不一致 |
| 后台所有请求返回 401 bad_signature | HMAC secret 客户端/服务端不一致 |
| 重装系统后激活失败 | 机器指纹变了，让客服强制解绑 |
| 客户端启动慢 | 首次激活后所有功能均离线运行，无需联网 |
