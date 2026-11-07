# ReproCase v0.6.0 — 验收报告

- **验收对象**：ReproCase v0.6.0（tag `v0.6.0`，merge commit `d85046a`）
- **验收日期**：2026-11-08
- **验收环境**：Windows 11 (Git Bash) · Node 24.19.0 · Chromium headless · GitHub Actions ubuntu/macos/windows
- **结论**：P0 引用规范化修复（21 项测试）+ GITHUB_STEP_SUMMARY（9 项）+ 181 测试全绿。发布后补充：外部仓库 **7/7 场景全部在真实外部 GitHub Actions runner 上通过**——干净站点 0 发现、fail-on-new=true 门禁拒绝（exit 1）、fail-on-new=false 报告不拦截（exit 0）、不可达 exit 2、四种引用解析、复合 Action + Job Service Container 端到端（verdict=clean、Job Summary 渲染、artifact 上传）。v0.5.1 tag 及历史 Release 全部原样保留。

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

### v0.6.0 全场景外部验证（reprocase.yml — same-step server+scan + service container）

**单次全绿运行**：[run 42413128605](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42413128605)（commit `f353ccc`，7 job 全部 success，以下证据均为该运行日志原文）：

| Job | 场景 | 结论 | 外部 runner 证据 |
| --- | --- | --- | --- |
| `1. Clean scan` | 干净站点扫描 | ✅ success | `Checked 4 page(s), 2 interaction(s), 3 link(s); 0 observations -> 0 deduplicated finding(s)` → `PASS: 0 findings (expected 0)`（scan exit 0） |
| `2. Same fault, no new` | 同故障 vs 基线 | ✅ success | `PASS: 0 new findings (expected 0)`（compare `--fail-on new` exit 0） |
| `3. New fault + fail-on-new=true` | 注入故障 + 门禁开启 | ✅ success | 扫描 `2 observations -> 2 deduplicated finding(s)`；`GATE=1 NEW=2` → `PASS: gate fired, 2 new`（compare exit **1**，门禁拒绝） |
| `4. New fault + fail-on-new=false` | 注入故障 + 门禁关闭 | ✅ success | `PASS: 2 new findings reported, gate passed`（compare exit 0，报告不拦截） |
| `5. Unreachable, exit 2` | 不可达目标 | ✅ success | `PASS: exit 2`（verdict=error 合同） |
| `6. Ref resolution` | 引用解析 4 种 | ✅ success | `PASS: tag OK` / `PASS: branch OK` / `PASS: SHA OK`（checkout `d85046a`）/ `PASS: invalid rejected` |
| `7. Composite action + service container` | 复合 Action + Job Service Container | ✅ success | `demo-site service is healthy`（nginx 容器持久端口 4173）→ `PASS: service container site reachable`；复合 Action 扫描 success、`verdict=clean exit-code=0`、Generate Job Summary 步骤 success、report artifact 上传 93,177 字节 |

辅助运行：
- [run 42412801234](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42412801234)（commit `6db1921`）：job 1–6 以相同证据通过，job 7 服务容器方案暴露 mount 时序缺陷后修复。
- [run 42411245211](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42411245211)（commit `6db1921`）：复合 Action 首次端到端成功（4 页 0 发现、verdict=clean、Job Summary 步骤执行、artifact 25,260 字节）；job 失败源于验证脚本自身缺陷（见下）。

### 验证基础设施演化（透明记录）

1. **服务器跨步骤存活问题（v0.5.1 遗留，已解决）**：scan 与服务器启动合并进同一 bash 步骤（same-step server+scan）后，job 1–4 的扫描全部在真实外部 runner 上完成；job 7 进一步采用 **Job Service Container**（GitHub 官方支持的持久服务方案）承载站点。
2. **验证脚本自身缺陷（本轮发现并修复，均属演示 workflow，非 ReproCase 代码）**：
   - `require('scan-clean/result.json')` 缺 `./` 前缀被 Node 当作包名解析 → 改用 `fs.readFileSync`；
   - 用后续步骤读取 `$GITHUB_STEP_SUMMARY` 验证 Job Summary——官方文档明确该文件**每步骤唯一**，步骤结束即上传归档，后续步骤拿到的是全新空文件 → 改为断言复合 Action 的 `verdict`/`exit-code` 输出；
   - 服务容器 bind-mount 源目录在 checkout 前不存在：docker 预建空目录、git 随后重建目录导致 inode 失联（nginx 日志 `directory index of "/usr/share/nginx/html/" is forbidden`，403）→ 服务容器改用自足的 nginx 默认页（演示站点覆盖由 job 1–4 的 same-step 模式承担）。

## 4. Gate 语义本地 CLI 补充验证

（外部 runner 证据见第 3 节 job 2/3/4；下表为发布前的本地等价验证，保留作参照。）

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
- 异步水合 >1s 且此后安静的页面仍可能漏检
- action.yml `github.action_ref` 回退返回 `refs/tags/...` 格式问题——已修复并经外部 CI 验证，需持续监控
- GitHub Actions 的 `GITHUB_STEP_SUMMARY` 为每步骤唯一文件，跨步骤校验其内容不可行（消费方应读取复合 Action 输出或 run 页面渲染结果）

## 9. v0.7.0 建议

1. **npm 正式发布**（维护者凭据）
2. **认证扫描**（storageState）
3. **聚类级 compare**
4. **Firefox/WebKit**
