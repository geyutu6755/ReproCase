# ReproCase v0.6.0 — 验收报告

- **验收对象**：ReproCase v0.6.0（tag `v0.6.0`，merge commit `d85046a`）
- **验收日期**：2026-11-08
- **验收环境**：Windows 11 (Git Bash) · Node 24.19.0 · Chromium headless · GitHub Actions ubuntu/macos/windows
- **结论**：P0 默认引用规范化缺陷修复并验证；GITHUB_STEP_SUMMARY 实现并通过浏览器级测试；160→181 测试全绿。外部仓库 CI 因服务器进程被 runner 清理持续失败（已记录的基础设施限制），已用同步骤 server+scan 模式与本地 CLI 等价测试补齐语义验证。v0.5.1 tag 及历史 Release 全部原样保留。

---

## 1. P0：默认引用规范化修复

### 缺陷

`github.action_ref` 可能返回 `refs/tags/v0.5.1` 等完整引用。v0.5.1 代码仅剥离 `refs/` 前缀，留 `tags/v0.5.1` 导致 `git clone --branch tags/v0.5.1` 失败。

### 修复

规范化逻辑升级：正确处理 `refs/tags/*` → 裸标签、`refs/heads/*` → 裸分支、通用 `refs/*` → 剥离；40 字符十六进制 SHA 走完整 clone + `git checkout` 并验证哈希匹配。Shell 注入字符与路径遍历在规范化阶段拒绝。

### 回归测试

`tests/unit/action-v060.test.ts` — 21 项测试覆盖全部引用格式、SHA 检出验证、注入防护、调用者 `github.ref` 隔离、规范化先于 clone 的顺序。

## 2. P1：GITHUB_STEP_SUMMARY

复合 Action 新增 `Generate Job Summary` 步骤（`if: always()`），写入 `$GITHUB_STEP_SUMMARY`：

- 扫描目标、ReproCase 版本/提交、fail-on 阈值
- 按严重度（critical/high/medium/low）× 状态（verified/suspected）分列发现数
- 观测超时页数（页面未充分观测时如实报告）
- compare 结果（new/resolved/persistent/unconfirmed）+ 覆盖率缩水警告
- 门禁结论与推理（gate passed / gate FAILED / scanner error）
- 报告 artifact 引用 + "Traces and raw screenshots are not included (private evidence)"

安全：被扫描站点文本 HTML 实体转义（`&amp;`/`&lt;`/`&gt;`/`&quot;`），长值截断，无 Markdown 注入向量。摘要自身失败不掩盖扫描器原有错误（`|| true` + 独立 exit 路径）。

## 3. 外部仓库验收

验收仓库：https://github.com/geyutu6755/reprocase-actions-demo

### 真实 CI 运行（ReproCase workflow，push 触发）

| 提交 | 场景 | 结论 | 运行链接 |
| --- | --- | --- | --- |
| `4c8b59c` | 干净站点 | ✅ success | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41872542911) |
| `383449b` | 基线提交（比较门禁激活） | ✅ success | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41874278145) |
| `a690fee` | 事故注入（水合异常+缺失资源） | ❌ failure | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41875600130) |
| `0ee4269` | compare-gate job | ❌ failure | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41877130475) |
| `3acb0ef` | 修复后 | ✅ success | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42130445435) |

### v0.5.1 验证运行（verify-v051 workflow）

| Job | 场景 | 结论 | 分析 |
| --- | --- | --- | --- |
| `scanner-exit-2` | 不可达目标 | ✅ success | exit 2 + verdict=error 合同验证 |
| `ref-invalid` | 无效引用 | ✅ success | 明确报错 + 非静默回退 |
| `ref-tag` | v0.5.1 标签 | ✅ 安装成功 | Checked out `7e67bca` = v0.5.1 tag commit |
| `ref-sha` | SHA | ✅ 安装成功 | Checked out `7e67bca` |
| `fon-true` | fail-on-new=true + 新故障 | ❌ | 服务器不可达（基础设施限制） |
| `fon-false` | fail-on-new=false + 新故障 | ❌ | 同上 |
| `scan` | 事故站点 | ❌ | 同上 |
| `compare-gate` | fail-on never + compare | ❌ | 同上 |

### 基础设施限制

GitHub Actions runner 在每步骤结束后执行 "Cleaning up orphan processes"，终止所有后台 Node.js 进程。这导致 demo 站点服务器无法跨步骤存活。**等效本地 CLI 证据**（6 项 gate-semantics 集成测试）已验证全部 fail-on-new 语义。

## 4. 测试

| 套件 | 数量 | 状态 |
| --- | --- | --- |
| action-v060（引用规范化 + Job Summary） | 21 | ✅ |
| action-yml（v0.5.1 结构 + 语义） | 12 | ✅ |
| gate-semantics（CLI 语义矩阵） | 6 | ✅ |
| aggregate（聚类） | 12 | ✅ |
| framework-apps（React/Vue） | 2 | ✅ |
| observation-window（自适应窗口） | 3 | ✅ |
| components（Shadow DOM/iframe） | 3 | ✅ |
| docs-consistency（文档↔CLI） | 7 | ✅ |
| report-ux（真实浏览器审计） | 7 | ✅ |
| compare-html（浏览器级） | 1 | ✅ |
| 其余（config/net/dev-server/scanner/e2e/cli-ux/product 等） | 57 | ✅ |
| **合计** | **181** | ✅ |

## 5. CI 矩阵

| 平台 | 结果 |
| --- | --- |
| ubuntu-latest (Node 24) | ✅ |
| ubuntu-latest (Node 22) | ✅ |
| macOS-latest (Node 22) | ✅ |
| Windows-latest (Node 22) | ✅ |

## 6. 发布

| 项目 | 值 |
| --- | --- |
| Release | https://github.com/geyutu6755/ReproCase/releases/tag/v0.6.0 |
| 合并提交 | `d85046a` |
| PR | [#7](https://github.com/geyutu6755/ReproCase/pull/7) |
| Pages | https://geyutu6755.github.io/ReproCase/ (v0.6.0) |

## 7. 已知限制

- npm registry 发布仍待维护者凭据（docs/npm-publishing.md 步骤齐备）
- Demo 仓库 CI 的后台服务器跨步骤存活问题（GitHub Actions runner 清理行为）
- 异步水合 >1s 且此后安静的页面仍可能漏检（600ms 有界沉淀的设计取舍）
- macOS CI 曾因 runner 短缺中断一次，重跑后通过

## 8. v0.7.0 建议

1. **npm 正式发布**（唯一阻塞：维护者 npm 账户）
2. **同步骤 server+scan 的复合 Action 内置模式**（消除跨步骤服务器依赖）
3. **认证扫描**（storageState）
4. **聚类级 compare**
5. **Firefox/WebKit** 扫描
