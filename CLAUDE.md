# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个用于学习和研究 `@tencent-weixin/openclaw-weixin`（微信渠道 AI 网关插件）的项目。包含一个完整的微信机器人 Demo，实现了二维码登录、消息收发和上下文管理。

## 常用命令

```bash
# 安装根目录依赖
yarn install

# 运行 Demo 机器人
cd demo && yarn install && npm start   # 即 npx tsx bot.ts

# 检查依赖最新版本
npm view @tencent-weixin/openclaw-weixin version
npm view @tencent-weixin/openclaw-weixin-cli version
```

项目无构建步骤，使用 `tsx` 直接运行 TypeScript。无测试和 lint 配置。

## 架构

- **demo/weixin-api.ts** — 框架无关的微信 API 封装层，处理 HTTP 请求、认证和类型定义
- **demo/bot.ts** — 交互式机器人应用，调用 API 层实现登录→轮询→CLI 交互流程

消息流：扫码登录 → 获取 token → 后台长轮询 `getUpdates()` → 缓存每个用户的 `context_token` → CLI 发送消息时使用对应 token

## 关键设计

- API 基础地址 `https://ilinkai.weixin.qq.com`，认证使用 Bearer token（ilink_bot_token 类型）
- 所有 API 调用通过 `AbortController` 控制超时
- `context_token` 按用户 ID 缓存在 Map 中，是回复消息的必要凭证
- 消息轮询使用 `get_updates_buf` 游标保证消息有序
- 支持 5 种消息类型：TEXT、IMAGE、VOICE、FILE、VIDEO

## 语言要求

本项目文档和注释使用中文。
