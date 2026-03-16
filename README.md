# Endfield Google Bridge Extension

Chrome 扩展：用于自动捕获 OAuth 回调参数并提交到你的后端 Google 登录桥接接口。

## 功能

- 自动监听 Google 登录回调链路
- 自动提取 `channelId` / `token` 参数
- 自动调用后端 `POST /login/skport/google/complete`
- 弹窗支持配置后端地址（默认：`https://end-api.shallow.ink`）

## 安装（开发者模式）

1. 打开 Chrome 的 `chrome://extensions`
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `endfield-third-brige` 文件夹

## 使用

1. 点击扩展图标，确认 `Backend Base URL`
2. 点击「保存自动配置」
3. 回到你的业务前端，发起 Google 登录
4. 扩展会在回调时自动提交登录参数

## 版本与发布

- 扩展版本以 `manifest.json` 的 `version` 字段为准
- 仓库内包含 GitHub Actions 工作流，可在发布时自动打包扩展

## 安全说明

- 本仓库仅包含通用桥接能力，不包含内部服务实现细节
- 请在你的部署环境中配置后端鉴权、限流与审计策略
