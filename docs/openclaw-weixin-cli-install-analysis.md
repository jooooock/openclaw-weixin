# `npx -y @tencent-weixin/openclaw-weixin-cli@latest install` 执行分析

## 1. 命令概述

该命令通过 `npx` 临时下载并执行 `@tencent-weixin/openclaw-weixin-cli` 包中的 `install` 子命令，用于一键安装微信渠道插件并完成首次连接。

### 参数解析

| 部分 | 含义 |
|------|------|
| `npx -y` | 自动确认下载，不提示用户 |
| `@tencent-weixin/openclaw-weixin-cli@latest` | 从 npm 拉取最新版本（当前 v1.0.2） |
| `install` | 执行安装子命令 |

## 2. 执行结果

**执行失败**，退出码 1，输出：

```
[openclaw-weixin] 未找到 openclaw，请先安装：
  npm install -g openclaw
  详见 https://docs.openclaw.ai/install
```

失败原因：系统中未全局安装 `openclaw` CLI 工具，命令在第一步前置检查时即中断。

## 3. CLI 源码流程分析

源文件：`node_modules/@tencent-weixin/openclaw-weixin-cli/cli.mjs`

`install` 命令共分 **4 个步骤**，按顺序执行：

### 步骤 1：检查 openclaw 是否已安装（当前失败点）

```javascript
if (!which("openclaw")) {
  error("未找到 openclaw，请先安装：");
  process.exit(1);
}
```

通过 `which openclaw` 检查全局 PATH 中是否存在 `openclaw` 可执行文件。如果不存在则直接退出。

### 步骤 2：安装微信插件

```javascript
run(`openclaw plugins install "@tencent-weixin/openclaw-weixin"`);
```

调用 `openclaw plugins install` 将微信渠道插件安装到 OpenClaw 的插件目录中。如果插件已存在（`already exists`），则自动切换为 `openclaw plugins update "openclaw-weixin"` 进行更新。

### 步骤 3：扫码登录微信

```javascript
run(`openclaw channels login --channel openclaw-weixin`, { silent: false });
```

以交互模式运行，用户需要扫描终端中显示的二维码完成微信账号绑定。`silent: false` 表示输出直接透传到终端（用于展示二维码）。

### 步骤 4：重启 OpenClaw Gateway

```javascript
run(`openclaw gateway restart`, { silent: false });
```

重启网关服务，使其加载新安装的微信渠道插件和已登录的账号。

## 4. 涉及的 npm 包

### `@tencent-weixin/openclaw-weixin-cli` (v1.0.2)

- 轻量级安装器，无任何依赖
- 仅包含一个文件 `cli.mjs`（~5.4 kB）
- 提供 `install` 和 `help` 两个子命令
- 要求 Node.js >= 22
- bin 名称：`weixin-installer`
- 发布于 2 天前，由腾讯团队维护

### `@tencent-weixin/openclaw-weixin` (v1.0.2)

- OpenClaw 微信渠道插件本体
- 依赖：`qrcode-terminal`（终端二维码生成）、`zod`（schema 校验）
- 插件 ID：`openclaw-weixin`
- 源码模块结构：
  - `api/` - API 通信、会话管理、配置缓存
  - `auth/` - 账号管理、二维码登录、设备配对
  - `cdn/` - CDN 上传、AES-ECB 加解密、图片解密
  - `media/` - 媒体下载、MIME 类型处理、SILK 音频转码
  - `messaging/` - 消息收发、斜杠命令、调试模式
  - `monitor/` - 监控
  - `storage/` - 状态持久化、同步缓冲
  - `util/` - 日志、随机数、脱敏

### `openclaw` (v2026.3.13)

- 多渠道 AI 网关，未安装在本项目中
- 包大小 94.8 MB，55 个依赖
- 支持渠道：Slack、Discord、Telegram、Line、Lark、WhatsApp 等
- 集成 MCP SDK、多家 AI 提供商（AWS Bedrock 等）
- 需要全局安装：`npm install -g openclaw`

## 5. 修复方案

要成功执行该命令，需先全局安装 `openclaw`：

```bash
# 1. 全局安装 openclaw
npm install -g openclaw

# 2. 重新执行安装命令
npx -y @tencent-weixin/openclaw-weixin-cli@latest install
```

成功后的预期流程：
1. 检测到 openclaw -> 通过
2. 安装微信插件到 openclaw 插件目录
3. 终端显示二维码，用户扫码完成微信登录
4. 重启 OpenClaw Gateway，微信渠道上线

## 6. 完整依赖关系

```
npx @tencent-weixin/openclaw-weixin-cli install
  │
  ├─ 前置条件：openclaw (全局安装)
  │    └─ openclaw plugins install @tencent-weixin/openclaw-weixin
  │         ├─ qrcode-terminal (终端二维码)
  │         └─ zod (配置校验)
  │
  ├─ openclaw channels login --channel openclaw-weixin
  │    └─ 交互式扫码登录
  │
  └─ openclaw gateway restart
       └─ 重启网关，加载新插件
```
