# LightC License Server

自建的卡密授权后台，配合 LightC 桌面端使用。

## 功能

- 客户端 API（带 HMAC 签名）：`/api/activate` `/api/unbind` `/api/card_info`
- 管理后台（Basic Auth + Web UI）：批量生成卡密、查看激活情况、单卡操作（封禁/解绑/重置）、激活日志
- 命令行卡密生成工具
- SQLite 单文件存储，轻量易部署

## 快速开始

```bash
cd server
npm install
cp .env.example .env       # 修改密码和密钥
npm start                  # 默认监听 :8088
```

启动后访问 `http://localhost:8088/admin/`（用户名/密码在 .env 中）。

## 生成测试卡密

通过 Web 后台「批量生成」页或命令行：

```bash
# Web 后台：访问 /admin/，切到「批量生成」tab

# 命令行：
node scripts/gen-cards.js --tier year --count 10 --batch "测试"
node scripts/gen-cards.js --tier week --count 100 --output cards.csv
```

## 密钥配置

`.env` 中的密钥必须与客户端 Rust 代码中的常量保持一致：

| 后端 .env | 客户端 (src-tauri/src/license/mod.rs) |
|-----------|------------------------------------------|
| `LICENSE_PRIVKEY_HEX` | （仅服务端持有，签发 token） |
| `LICENSE_PUBKEY_HEX`  | `LICENSE_PUBKEY_HEX`（验签） |
| `APP_SIGN_SECRET_HEX` | `APP_SIGN_SECRET_HEX`（HMAC） |

**生产部署前**：重新生成所有密钥并同步到客户端，然后重新打包 Windows 安装包。

生成密钥的脚本：

```bash
node -e "
const c = require('crypto');
const { publicKey, privateKey } = c.generateKeyPairSync('ed25519');
console.log('LICENSE_PUBKEY_HEX  =', publicKey.export({format:'der',type:'spki'}).slice(-32).toString('hex'));
console.log('LICENSE_PRIVKEY_HEX =', privateKey.export({format:'der',type:'pkcs8'}).slice(-32).toString('hex'));
console.log('APP_SIGN_SECRET_HEX =', c.randomBytes(32).toString('hex'));
console.log('AES_PEPPER (16字节) =', c.randomBytes(16).toString('hex'));
"
```

## 客户端 API 协议

### POST `/api/activate`
```http
POST /api/activate
Content-Type: application/json
X-App-Sign: <hmac_sha256_hex(body, APP_SIGN_SECRET)>

{
  "card": "LC-XXXX-XXXX-XXXX-XXXX-XXXX",
  "fingerprint": "a1b2...",  // SHA256(MachineGuid + 卷序列号) 取前 16 字节 hex
  "version": "2.4.4"
}

→ 200 OK
{
  "token": "<base64url-claims>.<base64url-sig>",
  "tier": "year",
  "expires_at": 1764936000
}

→ 4xx
{ "error": "invalid_card" | "card_disabled" | "already_bound" | ..., "message": "..." }
```

### POST `/api/unbind`
```http
POST /api/unbind
X-App-Sign: ...
{ "fingerprint": "...", "reason": "用户重装系统" }
→ { "ok": true }
```

### GET `/api/card_info?card=LC-...`
```
→ { "tier": "year", "status": "active", "expires_at": ..., "activated_at": ... }
```

## 部署建议

- **反代 HTTPS**：用 Caddy / Nginx 反代到 8088，自动签发证书。
- **持久化备份**：每日 cron `sqlite3 data/license.db ".backup data/backup-$(date +%Y%m%d).db"`
- **进程管理**：用 systemd / pm2 守护进程。
- **修改默认密码**：`.env` 中的 `ADMIN_PASS` 务必修改。
- **关闭 CORS**：生产环境务必 `ALLOW_DEV_CORS=false`（默认）。

## 数据库

SQLite 单文件 `data/license.db`，含三张表：

- `cards` —— 卡密主表
- `activations` —— 激活日志
- `unbind_logs` —— 解绑日志

## 卡密格式

```
LC-XXXX-XXXX-XXXX-XXXX-XXXX  (26 字符，带横线)
```

- `LC` 固定前缀
- 2 字符 tier 标识（DA/WK/HM/QT/HY/YR）
- 6 字符自增序号（base27）
- 8 字符加密随机数
- 4 字符 CRC32 校验位

校验位允许客户端在不联网的情况下立即识别输错的卡密。

## License

私有项目内部使用，请勿对外开源。
