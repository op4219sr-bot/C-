# AI 智能清理顾问 — 任务计划文档

> **本文档用途**：跨会话续作。模型用量重置后，**先读此文档**，看 [当前进度] 找到下一个未完成任务接着干。
> 每完成一个任务，立刻更新对应复选框 + [当前进度] 区块，并 commit。

---

## 0. 需求定稿（已与用户确认）

**核心理念**：AI 当"决策大脑"，不直接删文件。三步走：
1. **系统侧**：Rust 扫描器收集"证据包"（注册表 / 缓存 / venv / 残留 / 文件元数据）
2. **AI 侧**：LLM 综合判断"哪些可删、哪些保留、为什么"，输出结构化决策报告
3. **用户侧**：用户看 AI 报告 → 勾选 → 走 LightC **现有删除引擎**执行（送回收站 / 备份）

**已确认选项**：
- Q1 LLM 调用方式 = **🅲 A+B 双模式**：默认用 LightC 后台代理（用户付费额度），进阶用户可填自己的 API Key
- Q2 默认厂商 = **🅰 智谱 GLM-4-Flash**（最便宜、国内合规、质量够用）
- Q3 隐私范围 = **🅱 路径脱敏**（`C:\Users\xxx\` → `<USER>\`，发给 LLM 前替换）
- Q4 范围 = **🅱 完整版**（6 类证据 + 前端 + 后台代理）

**6 类证据类型**：
1. `uninstall_residue` — 卸载残留（复用现有 leftovers scanner）
2. `python_venv` — Python 虚拟环境（.venv / venv / conda env）
3. `node_modules` — 废弃项目的 node_modules
4. `ai_model_cache` — AI 模型缓存（Ollama / HF / LM Studio / SD 等）
5. `ide_cache` — IDE 缓存（PyCharm / VSCode / Cursor 等）
6. `generic_cache` — 通用缓存目录（复用现有 hotspot/programdata）

**商业策略**：免费看"AI 检测到 X GB 可优化"总览；会员才能提交 AI 分析 + 看建议 + 执行（`ensure_premium!()` 守卫 analyze 和 execute 命令）。

---

## 1. 架构总览

```
前端 AiCleanerModule
  │ 1. invoke collect_ai_evidence()        → 拿证据包 JSON（免费）
  │ 2. invoke analyze_with_ai(evidence)    → AI 决策报告（会员，ensure_premium）
  │ 3. 用户勾选 → invoke 现有 enhanced_delete_files / delete_leftovers_permanent
  ▼
Rust src-tauri/src/ai_cleaner/
  ├── mod.rs           模块入口 + 类型定义（Evidence / AiDecision）
  ├── evidence.rs      证据收集器（整合现有 scanner，输出脱敏 JSON）
  ├── sanitize.rs      路径脱敏（C:\Users\xxx → <USER>）+ 反脱敏（AI 返回后还原真实路径）
  ├── llm_client.rs    LLM HTTP 客户端（GLM-4-Flash + 自定义 endpoint）
  ├── prompt.rs        system prompt + few-shot 示例
  └── commands.rs      Tauri 命令

后台 server/src/routes/ai.js
  └── POST /api/ai/analyze   代理 LLM 调用（控制会员额度 + 服务端持有 GLM key）

前端 src/components/modules/AiCleanerModule.tsx
  + src/components/ai/  （证据展示 / AI 报告卡片 / 决策勾选）
```

---

## 2. 分阶段任务清单

> 状态标记：`[ ]` 未开始 | `[~]` 进行中 | `[x]` 已完成 | `[!]` 阻塞/待确认

### Phase 0 — 准备（半天）
- [x] P0-1 写本任务计划文档
- [x] P0-2 创建 feat-ai-cleaner 分支（基于 dev）
- [x] P0-3 在 Cargo.toml 加依赖（已有 reqwest/serde_json/hmac/sha2，无需新增）

### Phase 1 — Rust 证据收集器（1.5 天）
- [x] P1-1 创建 ai_cleaner/mod.rs：定义 Evidence / EvidenceItem / EvidenceType 枚举
- [x] P1-2 evidence.rs：uninstall_residue 收集（复用 scanner::leftovers）
- [x] P1-3 evidence.rs：python_venv 收集（找 .venv/venv + pyvenv.cfg + 父目录活动）
- [x] P1-4 evidence.rs：node_modules 收集（找 node_modules + 父目录 package.json + 最后修改）
- [x] P1-5 evidence.rs：ai_model_cache 收集（Ollama/HF/LMStudio/torch/whisper/gpt4all/nvidia）
- [x] P1-6 evidence.rs：ide_cache 收集（VSCode/Cursor/JetBrains 缓存目录）
- [~] P1-7 evidence.rs：generic_cache 收集（暂用 uninstall+ai_cache 覆盖，后续可加 hotspot）
- [x] P1-8 文件元数据：last_access_days / last_modified_days / file_count / size_mb
- [x] P1-9 sanitize.rs：路径脱敏 + 反脱敏映射表（含单测）
- [x] P1-10 commands.rs：collect_ai_evidence() Tauri 命令（免费，输出脱敏 JSON）

### Phase 2 — LLM 客户端 + Prompt（2 天）
- [x] P2-1 prompt.rs：system prompt（教 AI 判断规则：什么可删/保留/需用户决定）
- [x] P2-2 prompt.rs：few-shot 示例（典型 case）
- [x] P2-3 llm_client.rs：GLM-4-Flash HTTP 调用（智谱 OpenAI 兼容格式 + Bearer）
- [x] P2-4 llm_client.rs：自定义 endpoint 支持（BYOK：用户填 key+url+model）
- [x] P2-5 llm_client.rs：结构化输出解析（AiReport + 剥 code fence 容错）
- [x] P2-6 commands.rs：analyze_ai_evidence(evidence, config) Tauri 命令（ensure_premium 守卫）
- [ ] P2-7 settings：前端 API Key / endpoint / 模式 配置存储（移到 Phase 4 前端做）

注：lib.rs 已注册 collect_ai_evidence / analyze_ai_evidence 两个命令。
license/mod.rs 已加 pub sign_app_body() + api_base() 供复用。
cargo check (x86_64-pc-windows-gnu) 通过，仅项目原有 warning。

### Phase 3 — 后台 LLM 代理（1 天）
- [ ] P3-1 server/src/routes/ai.js：POST /api/ai/analyze（HMAC 校验 + 会员校验）
- [ ] P3-2 服务端持有 GLM key（.env 加 GLM_API_KEY）
- [ ] P3-3 会员额度控制（每卡密每月 N 次，记 DB）
- [ ] P3-4 db.js：ai_usage 表（card / month / count）
- [ ] P3-5 admin 后台：AI 用量统计页

### Phase 4 — 前端 UI（1 天）
- [ ] P4-1 api/commands.ts：collectAiEvidence / analyzeWithAi 封装 + 类型
- [ ] P4-2 AiCleanerModule.tsx：主模块（扫描 → 证据总览 → AI 分析 → 报告 → 勾选执行）
- [ ] P4-3 ai/EvidenceOverview.tsx：免费总览（X GB 可优化，按类型分组）
- [ ] P4-4 ai/AiDecisionCard.tsx：AI 决策卡片（verdict 徽章 + reasoning + confidence + 勾选）
- [ ] P4-5 ai/AiSettingsPanel.tsx：设置页 AI 配置（模式切换 + API Key 输入）
- [ ] P4-6 接入 App.tsx 模块列表 + DashboardContext
- [ ] P4-7 lib.rs 注册新命令

### Phase 5 — 测试 + 调优（1 天）
- [ ] P5-1 Rust cargo check（x86_64-pc-windows-gnu）通过
- [ ] P5-2 前端 tsc 通过
- [ ] P5-3 Prompt 调优（用真实证据测 AI 判断质量）
- [ ] P5-4 端到端：证据收集 → AI 分析 → 勾选 → 删除
- [ ] P5-5 触发 test-build 出 Windows exe 验证

---

## 3. 关键技术决策记录

- **智谱 GLM-4-Flash API**：endpoint `https://open.bigmodel.cn/api/paas/v4/chat/completions`，OpenAI 兼容格式，鉴权用 API Key（Bearer）。免费额度大，flash 模型几乎免费。
- **结构化输出**：用 `response_format: { type: "json_object" }` 强制 JSON，prompt 里给 schema。
- **脱敏映射**：收集时生成 `{ "<USER>": "admin", "<P1>": "OldAppXYZ" }` 映射表，AI 返回脱敏路径后用映射还原真实路径再交给删除引擎。映射表**只在本地内存**，不上传。
- **删除复用**：AI 不做删除。用户勾选后，前端按 verdict 调现有 `enhanced_delete_files`（普通文件）或 `delete_leftovers_permanent`（残留文件夹）。
- **双模式**：`mode: "proxy"`（走 LightC 后台，会员额度）| `mode: "byok"`（bring your own key，用户填智谱/OpenAI key + endpoint）。

---

## 4. 当前进度（每次更新！）

**最后更新**：Phase 1 + Phase 2 已完成（Rust 后端核心全部就绪）
**已完成**：Phase 0 全部 / Phase 1 全部（P1-7 部分）/ Phase 2 除 P2-7
**下一步**：Phase 3 后台 LLM 代理（server/src/routes/ai.js）→ 然后 Phase 4 前端
**阻塞项**：无
**分支**：feat-ai-cleaner（push 到 origin/dev）
**已验证**：cargo check x86_64-pc-windows-gnu 通过

**已创建文件**：
- src-tauri/src/ai_cleaner/mod.rs（类型定义）
- src-tauri/src/ai_cleaner/sanitize.rs（脱敏 + 单测）
- src-tauri/src/ai_cleaner/evidence.rs（6 类证据收集）
- src-tauri/src/ai_cleaner/prompt.rs（system prompt + few-shot）
- src-tauri/src/ai_cleaner/llm_client.rs（GLM/BYOK/Proxy 三态）
- src-tauri/src/ai_cleaner/commands.rs（collect + analyze 命令）
- 修改 lib.rs（注册模块+命令）、license/mod.rs（加 sign_app_body/api_base）

---

## 5. 给"重置后接手的自己"的提示

1. `git checkout feat-ai-cleaner && git pull origin dev`（如果分支丢了，从 origin/dev 重建）
2. 读本文档 §4 当前进度，找到 `[~]` 或下一个 `[ ]`
3. 现有可复用代码：
   - 卸载残留：`src-tauri/src/scanner/leftovers.rs`
   - 大目录/缓存：`src-tauri/src/scanner/hotspot.rs`
   - 删除引擎：`src-tauri/src/cleaner/enhanced_delete.rs` + `permanent_delete.rs`
   - 会员守卫：`src-tauri/src/license/guard.rs` 的 `ensure_premium()`
   - LLM HTTP 参考：`src-tauri/src/license/client.rs`（已有 reqwest 用法）
   - 后台路由参考：`server/src/routes/api.js` + `admin.js`
4. 每改完一个 Rust 文件，`cd src-tauri && cargo check --target x86_64-pc-windows-gnu`
5. 每改完前端，`npx tsc --noEmit`
6. 完成一个 Phase 就更新本文档 §2 复选框 + §4 进度 + commit
