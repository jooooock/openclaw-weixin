# openclaw-weixin

学习 & 研究 `@tencent-weixin/openclaw-weixin` 包


## 项目结构

```
├── demo/           # 独立可运行的微信机器人 CLI Demo
├── web/            # Web UI（Vue 3 + Hono），可部署到 Cloudflare Workers
├── resources/      # 从 npm 包中提取的各版本源码，用于对比分析
│   └── openclaw-weixin/
│       ├── v1.0.2/
│       ├── v2.0.1/
│       └── v2.1.1/
└── docs/           # 文档和分析笔记
```


## 版本分析

### 整体架构

插件通过 OpenClaw 的 plugin-sdk 注册为微信渠道插件，核心流程：

1. **扫码登录** — 调用微信 iLink API 获取二维码，轮询扫码状态，获取 `bot_token`
2. **消息接收** — 通过 `getUpdates` 长轮询获取用户消息，缓存 `context_token`
3. **消息发送** — 通过 `sendMessage` 发送文本/媒体消息，需要 `context_token`
4. **媒体处理** — CDN 上传/下载，AES-128-ECB 加密，SILK 语音转码

### 源码模块说明

| 模块 | 说明 |
|------|------|
| `src/api/` | HTTP API 封装、请求头构建、会话守卫、类型定义 |
| `src/auth/` | 二维码登录、账号管理、配对授权 |
| `src/cdn/` | CDN 媒体上传/下载、AES 加解密、图片解密 |
| `src/config/` | 插件配置 schema 定义 |
| `src/media/` | 媒体文件下载、MIME 类型、SILK 语音转码 |
| `src/messaging/` | 消息收发、入站处理、斜杠命令、调试模式 |
| `src/monitor/` | 运行监控 |
| `src/storage/` | 状态目录管理、同步缓冲区 |
| `src/util/` | 日志、随机数、敏感信息脱敏 |
| `channel.ts` | 渠道插件主逻辑（注册网关、处理消息流） |
| `runtime.ts` | 全局运行时状态管理 |
| `compat.ts` | 宿主版本兼容性检查（v2.0.1+） |
| `weixin-cli.ts` | CLI 命令：卸载、日志上传（v2.1.1+） |


### v1.0.2（Legacy 版本）

> npm dist-tag: `legacy` | 兼容 OpenClaw >=2026.1.0 <2026.3.22

初始发布版本，提供基础的微信渠道插件功能：

- **入口**：直接导入 `openclaw/plugin-sdk`，无版本兼容检查
- **登录**：从配置读取 API 基础 URL，标准二维码轮询流程
- **消息**：`context_token` 仅存于内存，重启后丢失；发送消息时 `context_token` 缺失会直接抛错
- **路径**：硬编码 `/tmp/openclaw` 作为临时目录
- **CLI**：仅 `logs-upload` 命令（位于 `log-upload.ts`）
- **API 请求头**：基础头部（Content-Type, AuthorizationType, X-WECHAT-UIN, SKRouteTag）
- 33 个 TypeScript 源文件


### v2.0.1（当前稳定版）

> npm dist-tag: `latest` | 兼容 OpenClaw >=2026.3.22

主要改进：兼容性检查、多账号支持、状态持久化。

#### 相对 v1.0.2 的变化

**新增文件：**
- `src/compat.ts` — 宿主版本兼容性检查，解析日期格式版本号（YYYY.M.DD），启动时 fail-fast

**入口变化（index.ts）：**
- 导入路径改为版本化路径：`openclaw/plugin-sdk/plugin-entry`、`openclaw/plugin-sdk/channel-config-schema`
- 启动时调用 `assertHostCompatibility(api.runtime?.version)` 进行版本断言
- 支持 `registrationMode`，仅在 `"full"` 模式下注册 CLI 命令

**渠道插件（channel.ts）：**
- 临时目录改用 `resolvePreferredOpenClawTmpDir()` 替代硬编码路径
- 新增 `resolveOutboundAccountId()` 支持多账号
- `context_token` 缺失时降级为警告（不再抛错）
- 新增 `blockStreaming: true` 能力声明和流式合并配置
- 登录时调用 `clearStaleAccountsForUserId()` 清理过期账号
- 启动时调用 `restoreContextTokens()` 恢复持久化的 token

**消息持久化（messaging/inbound.ts）：**
- 新增磁盘持久化层，`context_token` 以 JSON 文件存储在状态目录
- 新增 `restoreContextTokens()`、`clearContextTokensForAccount()` 函数
- token 键格式：`${accountId}:${userId}`，重启后可恢复

**CLI（log-upload.ts）：**
- 新增 `uninstall` 命令：清理渠道配置并卸载插件
- 临时目录同样改用动态解析

**包元数据（package.json）：**
- 新增 `peerDependencies: { "openclaw": ">=2026.3.22" }`
- 新增 `install.minHostVersion: ">=2026.3.22"`

**插件元数据（openclaw.plugin.json）：**
- 新增 `"version": "2.0.0"` 字段

共 34 个 TypeScript 源文件（+1）


### v2.1.1（最新补丁版）

> 兼容 OpenClaw >=2026.3.22

主要改进：API 现代化、IDC 容灾、请求头增强。

#### 相对 v2.0.1 的变化

**新增文件：**
- `src/weixin-cli.ts` — 从 `log-upload.ts` 拆出的独立 CLI 模块，包含 `uninstall` 和 `logs-upload` 命令

**移除文件：**
- `src/log-upload.ts` — 功能迁移至 `weixin-cli.ts`

**入口变化（index.ts）：**
- CLI 注册改为导入 `weixin-cli.js`（替代 `log-upload.js`）

**登录流程（auth/login-qr.ts）：**
- 使用固定 `FIXED_BASE_URL = "https://ilinkai.weixin.qq.com"`（不再从配置读取）
- 重构 API 调用为 `apiGetFetch()` 辅助函数
- 新增 `scaned_but_redirect` 状态处理（IDC 容灾重定向）
- 在 `ActiveLogin` 中跟踪 `currentApiBaseUrl` 用于 IDC 故障转移
- 新增超时常量：`GET_QRCODE_TIMEOUT_MS = 5_000`、`QR_LONG_POLL_TIMEOUT_MS = 35_000`

**API 模块（api/api.ts）：**
- 从 `package.json` 读取 `ilink_appid` 字段（值为 `"bot"`）
- 构建编码版本号 `ILINK_APP_CLIENT_VERSION`（uint32 格式 `0x00MMNNPP`）
- 新增 `buildCommonHeaders()` 公共头部构建函数
- 请求头新增：`iLink-App-Id`、`iLink-App-ClientVersion`
- 区分 GET/POST 请求的头部构建

**API 类型（api/types.ts）：**
- `GetUploadUrlResp` 新增 `upload_full_url?: string` 字段（服务端返回完整上传 URL）

**渠道插件（channel.ts）：**
- Agent 提示词新增 `MEDIA:` 指令格式说明（必须独占一行）

**配置（config/config-schema.ts）：**
- 移除 `logUploadUrl` 字段

**包元数据（package.json）：**
- 移除 `peerDependencies`（改为仅 devDependencies）
- 移除 `install.minHostVersion`
- 新增顶层 `ilink_appid: "bot"` 字段

**插件元数据（openclaw.plugin.json）：**
- 版本更新为 `"2.1.1"`

共 35 个 TypeScript 源文件（+1，-1）


### 版本对比总结

| 特性 | v1.0.2 | v2.0.1 | v2.1.1 |
|------|--------|--------|--------|
| 最低 OpenClaw 版本 | 无限制 | >=2026.3.22 | >=2026.3.22 |
| 启动版本检查 | 无 | Fail-fast | Fail-fast |
| 多账号支持 | 不支持 | 支持 | 支持 |
| context_token 持久化 | 内存 | 磁盘 | 磁盘 |
| 临时目录 | 硬编码 `/tmp` | 动态解析 | 动态解析 |
| IDC 容灾重定向 | 不支持 | 不支持 | 支持 |
| QR 码 API 地址 | 配置读取 | 配置读取 | 固定地址 |
| 流式消息阻断 | 不支持 | 支持 | 支持 |
| iLink 请求头 | 无 | 无 | 有 |
| CLI 命令 | logs-upload | logs-upload, uninstall | logs-upload, uninstall |
| 源文件数 | 33 | 34 | 35 |
