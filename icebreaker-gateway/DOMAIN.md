# curong.jiangjiangze.icu —— 促融共竞外壳域名

Pages 项目 `icebreaker-gateway`（子域 `icebreaker-gateway.pages.dev`），
DNS `CNAME curong.jiangjiangze.icu -> icebreaker-gateway.pages.dev`（proxied）。

⚠ zone 有一条 `*.jiangjiangze.icu → <tunnel>.cfargotunnel.com`（proxied）通配符，
未显式配置的子域全被它吞掉。2026-10-25 审计确认 `curong` 当时返回的是该隧道后端
o2p-platform 的兜底说明页，其自述 Web 入口是 `p2p.jiangjiangze.icu`，
`curong` 本身无专属 DNS 记录、无活冲突 ⇒ 接管安全。

**两步缺一不可**（`superbig.jiangjiangze.icu` 正是只做第一步的反面教材：
DNS 有 CNAME，但 Pages 项目侧自定义域状态 `deactivated`）：
1. DNS 建显式 CNAME（精确记录优先于通配符）；
2. `POST /accounts/<acc>/pages/projects/icebreaker-gateway/domains` 注册该域。

壳页 iframe 指向 `https://jingjiangze-stronghold-protocol.ms.show/icebreaker/`
（游戏容器，域名不变），CSP 五条指令零改。
