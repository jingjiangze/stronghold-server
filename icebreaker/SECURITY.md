# 安全策略

联机服务器（`packages/server`）接受来自浏览器的 WebSocket 消息。如果你发现可以让服务器崩溃、冒充其他玩家或房主、绕过房间与大厅的校验、读取或写入服务器文件等问题，请**不要公开发 issue**，而是通过 GitHub 的 [私下报告漏洞](https://github.com/ArknightsDevs/Icebreaker-Games/security/advisories/new) 告诉我们，附上复现步骤。

我们会尽快确认并修复，修复发布后再公开说明。

只支持 `main` 分支的最新提交。服务器请放在反向代理之后并启用 HTTPS，不要不加防护地直接暴露到公网。
