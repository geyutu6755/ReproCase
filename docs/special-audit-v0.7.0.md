# ReproCase v0.7.0 最终专项审计报告（A/B/C 三项独立反向验证）

- **日期**：2026-11-11
- **对象**：v0.7.0 新引入的检测逻辑（资源去重、fetch/XHR 过滤、表单探索策略）
- **方法**：源码审查 → 可控故障注入 → 真实 Chromium 扫描 → 预期/实际对照 → 风险判断
- **审计站点**：本地隔离站点 `rc-audit2`（6 页 + API 端点 + 服务端逐请求审计日志 + 状态标记文件）
- **结论**：**无 P0/P1 缺陷，不需要 v0.7.1**；修正一处 P3 文档口径；将一项固有产品边界写入文档

---

## 问题 A：资源失败去重（URL 键聚合）

### 源码审查
- 指纹：`['resource-load-failure', normalizeUrl(resourceUrl)]`（v0.7.0 修改点）
- `normalizeUrl` 仅剥离 hash、**保留 query** → 不同查询参数的资源不会错误合并
- 合并语义（`FindingCollector.observe`）：`observedCount` 递增、`pages` 逐页累积、首个观测的 evidence 保留、截图累积、steps 取更长路径

### 正反样例实测（真实扫描，全 3/3 复现）

| 样例 | 预期 | 实测 |
| --- | --- | --- |
| 同一缺失 URL 同页出现两次 | 1 条 | ✅ 1 条 |
| 同一缺失 URL 跨页（a-dedup + a-dup2） | 1 条，pages 含两页 | ✅ `pages: [a-dedup.html, a-dup2.html]`，`observedCount: 2` |
| 不同资源（missing-a.png） | 独立一条 | ✅ 独立 |
| **同路径不同 query（q.png?v=1 vs ?v=2）** | **两条（不同根因不合并）** | ✅ 两条独立 |
| 同 URL 不同失败形态（404 vs ERR_ABORTED） | 1 条 | ✅（v0.7.0 单元测试 + MPA 实测已证） |

证据保留核查：合并后保留首观测证据（HTTP 404）、pages 完整、observedCount=2。**未发现错误合并不同根因的样例。**

## 问题 B：fetch/XHR 误报与漏报（六场景）

| 场景 | 预期 | 实测 |
| --- | --- | --- |
| B1 已处理的业务 404（fetch catch → 友好提示） | 不报 | ✅ 不报 |
| B2 **未处理的 API 500**（.json() reject，无 catch） | 以客户端可见故障报告 | ✅ pageerror 捕获 unhandled rejection：「Unexpected token … is not valid JSON」verified 3/3 |
| B3 网络级失败（fetch 死端口） | 报告 | ✅ 「Failed to fetch」verified 3/3（requestfailed 通道未被过滤逻辑触及） |
| B4 API 错误引发 console.error | console-error 通道 | ✅ [LOW][suspected] 3/3 |
| B5 API 错误引发未捕获异常 | js-exception 通道 | ✅ 「B5Uncaught: item render crashed after API error」verified 3/3 |
| B6 正常业务响应（200） | 不报 | ✅ 不报 |

**结论：HTTP 状态本身（fetch/XHR 上的 4xx/5xx）与应用实际故障被正确区分；四个客户端可见错误通道（未处理拒绝/网络失败/console/未捕获异常）全部保持有效，过滤逻辑未隐藏任何可靠故障证据。** 已知取舍（有意设计）：页面从不读取响应体的静默 500 在客户端无可见故障，超出"浏览器可观测"范围（`notChecked` 披露）。

## 问题 C：表单内按钮安全（服务端请求审计）

| 控件 | 探索结果 | 服务端审计 |
| --- | --- | --- |
| 表单内 Delete my account / Pay invoice / Log out | outcome=**forbidden**（hard-dangerous） | 0 请求 |
| 表单外 Remove all data | forbidden | 0 请求 |
| submit 按钮 / 默认类型按钮 / input[type=submit] | 不进入候选 | 0 请求 |
| 嵌套表单内 type=button（Refresh preview / Inner action） | explored（v0.7.0 新覆盖正常工作） | 无副作用 |
| **全字段无痕伪装按钮**（text「Load preview」、id="preview-loader"、无 name/aria，JS 点击时 POST） | **explored → POST /api/preview-destroy 发出** | `HIT-POST-preview-destroy` |
| 页面加载自动 beacon（POST） | 页面自身行为（任何访问者都触发） | 非扫描器行为 |

**判定（真实产品限制，非 v0.7.0 回归）**：按钮安全性依据可见 text + aria-label/title/value + id + name 判定；文案与属性完全无痕、点击时才发出破坏性请求的控件**无法在点击前识别**——这是交互式扫描的本质边界（v0.6.0 同样存在；v0.5.1 的表单盲跳过只是偶然覆盖了该实例）。已通过 README 中英文「默认安全与隐私」段落如实文档化，并指向 `exploration.denySelectors` 作为用户侧防护。**坚持安全优先：未为此放宽任何 Delete/Pay/Logout/Submit 保护。**

## 文档口径修正（P3，本轮唯一代码接触）

- 发现：issues.md legend 写「suspected = observed but not proven reproducible」，但 console-error 实际 3/3 复现仍保持 suspected（保守置信策略）——文案与语义矛盾。
- 修正：`src/report/issue.ts` + `src/types.ts` 改为「Suspected = observed but held back from verified by the confidence policy: either not yet proven reproducible, or reproducible-but-informational (console errors can be intentional application logging)」。已在新扫描产物中验证生效。
- verified/suspected/3/3 的其余口径核查一致：3/3 指独立验证次数，verified 为全部通过且非 console 类；suspected 保留理由见新文案。

## 测试与 CI

- 全量回归：**185/185**（24 文件，356s）——文案修正后无任何测试破坏
- 提交：`eabaaa0`（main，push 触发四 OS CI）
- 专项证据：审计站点扫描 result.json + 服务端逐请求日志 + 状态标记文件（本地工作区 rc-audit2，保留备查）

## 是否需要 v0.7.1

**不需要**：三项审计未发现检测逻辑缺陷；唯一代码变更是一行用户可见文案的准确性修正（P3）+ 文档，不构成发布门槛。历史标签/Release 全部未动。

## v0.8.0 可安全继承的基线

- main = `eabaaa0`（含 v0.7.0 全部功能 + 本轮文案/文档修正），185/185 测试，四 OS CI
- 外部验收：demo 仓库 7/7（run 42444520049，v0.7.0 标签）
- 已知限制清单（诚实继承）：无痕破坏性按钮边界、GITHUB_STEP_SUMMARY 每步骤唯一、>1s 静默异步水合漏检窗口、强杀进程短暂孤儿、npm 发布待维护者凭据
- 建议方向（不承诺）：聚合级 compare、认证扫描（storageState）、Firefox/WebKit
