# ReproCase v0.6.0 — 验收报告

- **验收对象**：ReproCase v0.6.0（tag `v0.6.0`，merge commit `d85046a`）
- **验收日期**：2026-11-08
- **验收环境**：Windows 11 (Git Bash) · Node 24.19.0 · Chromium headless · GitHub Actions ubuntu/macos/windows
- **结论**：P0 引用规范化缺陷修复并验证（21 项测试）；GITHUB_STEP_SUMMARY 实现并通过结构测试（9 项）；160→181 测试全绿。外部仓库场景验收 4/10 通过（ref 解析 4 种 + 诚实错误），6 项因演示服务器跨步骤被 runner 清理而未能完成（已如实标注，用本地 CLI 等价测试补齐语义验证）。v0.5.1 tag 及历史 Release 全部原样保留。

---

## 1. P0：默认引用规范化修复

### 缺陷

`github.action_ref` 可能返回 `refs/tags/v0.5.1` 等完整引用。v0.5.1 代码仅剥离 `refs/` 前缀，留 `tags/v0.5.1` 导致 `git clone --branch tags/v0.5.1` 失败。

### 修复

规范化逻辑：`refs/tags/*` → 裸标签、`refs/heads/*` → 裸分支、通用 `refs/*` → 剥离；40 字符 SHA 走完整 clone + `git checkout` 并验证哈希匹配；Shell 注入字符与路径遍历拒绝。

### 回归测试

`tests/unit/action-v060.test.ts` — 21 项：引用格式、SHA 检出验证、注入防护、调用者 `github.ref` 隔离、规范化先于 clone 顺序。

## 2. P1：GITHUB_STEP_SUMMARY

复合 Action 新增 `Generate Job Summary` 步骤（`if: always()`），写入 `$GITHUB_STEP_SUMMARY`：

- 扫描目标、ReproCase 版本/提交、fail-on 阈值
- 按严重度 × 状态分列发现数
- 观测超时页数
- compare 结果 + 覆盖率缩水警告
- 门禁结论与推理
- 报告 artifact 引用 + trace 隐私提示

安全：HTML 实体转义、长值截断、无 Markdown 注入向量。结构测试 9 项。

## 3. 外部仓库验收

验收仓库：https://github.com/geyutu6755/reprocase-actions-demo

### 真实 CI 运行（push 触发）

| 提交 | 场景 | 结论 | 运行链接 |
| --- | --- | --- | --- |
| `4c8b59c` | 干净站点 | ✅ success | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41872542911) |
| `383449b` | 基线提交（比较门禁激活） | ✅ success | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41874278145) |
| `a690fee` | 事故注入（水合异常+缺失资源） | ❌ failure | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41875600130) |
| `0ee4269` | compare-gate job | ❌ failure | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41877130475) |
| `3acb0ef` | 修复后 | ✅ success | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42130445435) |

### v0.6.0 验证运行（verify-v051 workflow）

| Job | 场景 | CI 结论 | 分析 |
| --- | --- | --- | --- |
| `ref-tag` | reprocase-ref=v0.5.1 | ✅ success | Checked out `7e67bca` = v0.5.1 tag commit |
| `ref-sha` | reprocase-ref=SHA | ✅ success | Checked out `7e67bca` |
| `ref-invalid` | 无效引用 | ✅ success | 明确报错 + 非静默回退 |
| `scanner-error` | 不可达目标 | ✅ success | exit 2 + verdict=error 合同验证 |
| `install-baseline` | 基线文件存在 | ✅ success | |
| `scan-clean` | 干净站点 | ❌ | 服务器不可达（runner 清理） |
| `gate-no-new` | 同故障无新 | ❌ | 同上 |
| `gate-new-fault-fon-true` | fail-on-new=true + 新故障 | ❌ | 同上 |
| `gate-new-fault-fon-false` | fail-on-new=false + 新故障 | ❌ | 同上 |
| `compare-gate` | fail-on never + compare | ❌ | 同上 |

运行链接：[verify run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42136378524)

### 基础设施限制

GitHub Actions runner 在每步骤结束后执行 "Cleaning up orphan processes"，终止所有后台 Node.js 进程。已尝试：`detached: true` + `unref()`、非 detached、`nohup`、bash `&`——均被终止。**等效本地 CLI 证据**：6 项 gate-semantics 集成测试。

## 4. Gate 语义本地 CLI 验证

| 场景 | 预期退出码 | 实际 |
| --- | --- | --- |
| 基线 1 故障 + 当前同故障（无新） | 0 | ✅ 0 |
| 基线 1 故障 + 当前不同故障（新） | 1 | ✅ 1 |
| 基线 1 + 当前 1 同 + 1 新 | 1 | ✅ 1 |
| 旧故障已修复（当前无发现） | 0 | ✅ 0 |
| 无 --fail-on 标志（报告模式） | 0 | ✅ 0 |
| 基线文件不存在 | 2 | ✅ 2 |

## 5. 测试

181/181（72 unit + 109 integration/e2e）。

## 6. CI 矩阵

ubuntu Node 24 ✅ · ubuntu Node 22 ✅ · macOS Node 22 ✅ · Windows Node 22 ✅

## 7. 发布

Release: https://github.com/geyutu6755/ReproCase/releases/tag/v0.6.0

## 8. 已知限制

- npm registry 发布仍待维护者凭据
- Demo 仓库 CI 后台服务器跨步骤存活问题（GitHub Actions runner 清理行为）
- 异步水合 >1s 且此后安静的页面仍可能漏检
- action.yml `github.action_ref` 回退返回 `refs/tags/...` 格式问题——已修复但需持续监控

## 9. v0.7.0 建议

1. **GitHub Actions service container**：在复合 Action 中使用 service container 持久运行测试服务器
2. **npm 正式发布**（维护者凭据）
3. **认证扫描**（storageState）
4. **聚类级 compare**
5. **Firefox/WebKit**
