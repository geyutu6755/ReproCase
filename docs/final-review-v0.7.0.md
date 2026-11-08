# ReproCase v0.7.0 — 开发、真实项目验证与独立终审报告

- **版本**：v0.7.0（tag `v0.7.0` = merge commit `352aea7`，package.json 0.7.0）
- **日期**：2026-11-08
- **分支路径**：`release/v0.7.0` → PR [#8](https://github.com/geyutu6755/ReproCase/pull/8)（CI 全绿）→ main
- **终审结论**：**PASS**（判定依据见 §10）

---

## 1. 实际开发内容

| 修复 | 类别 | 动机（真实矩阵暴露） | 测试 |
| --- | --- | --- | --- |
| 资源失败指纹改为仅 URL 键 | 检测准确性 | 真实浏览器对同一缺失资源可产生 `404` 与 `net::ERR_ABORTED` 两种形态 → 同根因被计为 2 条 | 单元失败测试先行（findings.test.ts）+ MPA 真实站点复扫验证 2→1 |
| fetch/XHR 4xx/5xx 不再报 resource-load-failure | 检测准确性 | REST 查询返回 404 且页面已处理是正常业务状态 → 真实站点噪音 | 集成失败测试先行（api-noise.test.ts，含断图正对照） |
| 表单内 `type=button` 与链接纳入探索 | 覆盖缺口 | `closest('form')` 盲跳过隐藏了表单密集页的真实交互故障 | 探索策略测试（真实 Chromium）：安全按钮入选、Delete 仍 forbidden、submit/default 不可触 |
| 报告 `<noscript>` 回退 | P3/可访问性 | JS 禁用时报告为空壳 | report.test.ts 断言 |

历史功能零删除、零断言弱化；所有安全策略（HARD 危险关键词三级授权、samePort 范围、危险按钮拦截、secret 脱敏）保持原样。

## 2. 外部独立测试应用矩阵（真实开源来源）

| 应用 | 来源与版本 | 结构 |
| --- | --- | --- |
| mpa-h5bp | github.com/h5bp/html5-boilerplate **9.0.1**（MIT，独立维护） | 传统多页面 |
| react-spa | create-vite react 模板（vitejs，MIT）+ React 19 | hash 路由 SPA |
| vue-app | create-vite vue 模板（vitejs，MIT）+ Vue 3.5 | hash 路由 SPA |

故障注入（12 项真值）：延迟未捕获异常、交互异常×2（同形不同因）、跨页同根因资源缺失、iframe 内资源失败、失效链接、SPA 路由切换后异步故障、console.error、open shadow DOM 内断图、SPA 状态交互异常、首屏 1.2s 延迟异常。
对照（7 项）：mailto、外部链接、懒加载、已处理的业务 404、危险按钮（Delete/Pay，服务端审计）、hash 锚点、干净页。

真值清单：矩阵工作区 `TRUTH.md`（人工维护，随仓库外工作区保存）。

## 3. 检测准确性结果（修复后，人工逐项核对）

| 应用 | 真值故障 | 检出 | 漏报 | 误报 |
| --- | --- | --- | --- | --- |
| MPA (h5bp) | 7（F1,F2,F3,F4,F5a,F5b,F-iframe） | **7/7** | 0 | 0 |
| React SPA | 3（F6,F7,F8） | **3/3** | 0 | 0 |
| Vue SPA | 2（F9,F10） | **2/2** | 0 | 0 |
| 对照场景 | 7 | 全部未误报 | — | **0** |

- 复现稳定性：所有 12 项 3/3 verified（console-error 正确保持 suspected 分类）
- 关键场景重复执行：MPA 全量扫描共 3 次（v0.6.0 基线、修复后、安装副本终审）——后两次结果逐字节一致（fingerprint 相同）
- 修复前基线（v0.6.0 代码）：12 真值检出 11/12（F4 分裂为 2 条）+ 1 类误报（API 404）→ 两项均已修复并回归

## 4. 性能对照（同机、同浏览器、每格 2 轮）

| 场景 | v0.6.0 中位 | v0.7.0 中位 | 结论 |
| --- | --- | --- | --- |
| 9 页（demo） | 33 s | 34.5 s | 噪声内 |
| 42 页 | 128.5 s | 130 s | 噪声内 |
| 102 页 | 293 s | 287.5 s | 噪声内 |

内存峰值 ~130 MB（两版持平）；两版 0 observationTimeouts；报告体积逐格一致。**结论：准确性修复无性能回归；未发现值得冒险优化的真实瓶颈，未做投机性优化。**

## 5. 稳定性验证

- 正常退出：12 次性能运行 + 专项复检后 **0 个 chrome-headless-shell 残留**
- Ctrl+C：SIGINT 处理器优雅关闭浏览器、exit 130、不写半截报告（代码在案）
- 输出路径为文件：明确报错（ENOTDIR + 修复指引），退出码 1
- 入口不可达：exit 2 + doctor 指引
- 强杀进程：浏览器子进程短暂孤儿后自行退出（OS 层不可捕获，记录为已知限制）
- 大报告压力：200 findings 合成报告渲染 166 ms、搜索/筛选正确（正向命中、负向 0/16）、移动端 390px 无横向溢出、键盘可达

## 6. 用户体验闭环（新用户身份，v0.7.0 标签全新克隆）

clone `--branch v0.7.0` → `npm install` → `--version` 0.7.0 → doctor（五查通过，缺失 config 给出 init 指引）→ `reprocase demo`（5 发现，4 植入故障 + 死链旁证）→ 独立矩阵扫描（8/8 MPA 发现、0 API 噪音）→ 生成测试可运行 → compare 语义（前轮反向验收已证 new/resolved/coverage-shrink）。README Quick Start 命令逐条真实可用；npm registry 未发布故文档不宣传 npm 安装渠道。

## 7. 安全与隐私回归（v0.7.0 构建实测）

- 破坏性操作：`Delete all my records` / `Pay invoice` / `Delete account` 按钮（表单内外）→ 服务端审计 **0 次请求**；exploration 日志 outcome=forbidden（"hard-dangerous keyword (never clickable)"）
- 越界：跨端口 `bomb.html` **0 次请求**
- 脱敏：URL token 在 pageUrl/message/stack/报告/issues/生成测试全链 `***`，原始值零泄漏
- XSS：异常消息含 `<img ...>` 以 `\u003c` 转义嵌入，无脚本逃逸
- 畸形输入：警告 + 回退默认；npm audit **0 vulnerabilities**

## 8. 测试与 CI

- **185/185**（24 文件：unit + 真浏览器 integration + CLI e2e）——含 4 项新增测试
- PR #8 CI：ubuntu Node 22/24、macOS、Windows **全绿**
- main（352aea7）CI：**success**；Pages deploy：**success**（站点 HTTP 200）
- 外部验收仓库（reprocase-actions-demo，全部指向 v0.7.0）：**7/7 场景 success**（[run 42444520049](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42444520049)：干净扫描、fail-on-new=true 门禁拒绝、fail-on-new=false 报告不拦截、exit 2、引用四态、复合 Action + 服务容器）

## 9. 发布链

| 项 | 值 |
| --- | --- |
| PR | [#8](https://github.com/geyutu6755/ReproCase/pull/8)（merge 方法 merge，无强制推送） |
| main | `352aea7` |
| tag | `v0.7.0` → `352aea7`（package.json at tag = 0.7.0） |
| Release | [v0.7.0](https://github.com/geyutu6755/ReproCase/releases/tag/v0.7.0)（发布说明含矩阵结果、性能表、安装命令；源码安装路径） |
| Pages | https://geyutu6755.github.io/ReproCase/ → 200 |
| 历史标签 | v0.3.3–v0.6.0 全部原样（git ls-remote 核验） |

过程披露：初版合并因 shell 内联 JSON 编码问题失败，期间误将 v0.7.0 标签推至错误提交——**数秒内发现并删除该错误标签**（无 Release 关联、无他人引用），PR 正确合并后在 merge commit 重新打标签。演示仓库在验证过程中误提交了本地证据工作文件，已用三次 cleanup 提交移除（保留 workflow/site/baseline/server）。

## 10. 已知限制与未解决事项

1. **npm registry 发布**：仍待维护者 npm 凭据（外部授权阻塞）——文档如实标注 GitHub 源安装为唯一渠道
2. 强杀进程的短暂浏览器孤儿（OS 层限制，自愈）
3. `GITHUB_STEP_SUMMARY` 每步骤唯一（GitHub 平台行为，已文档化）
4. 异步水合 >1s 且此后安静的页面可能漏检（设计权衡，已披露）
5. 外部用户反馈/下载量：**尚未收集**（不做任何虚构）

## 11. 判定

PASS 判定依据：真实项目矩阵 12/12 检出 + 0 误报 + 修复后逐字节复现一致；性能无回归（可复现数据）；安全边界全数实测成立；185/185 测试 + 四 OS CI + 外部 7/7；发布资产与源码一致且从标签独立安装验证通过；历史标签与 Release 未被移动；全部证据可第三方核验。
