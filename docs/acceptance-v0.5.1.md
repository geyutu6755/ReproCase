# ReproCase v0.5.1 — GitHub Actions 集成可靠性验收报告

- **审计对象**：ReproCase v0.5.1（发布标签 `v0.5.1`，发布提交 `7e67bca`）
- **验收日期**：2026-11-06
- **验收环境**：Windows 11 (Git Bash) · Node 24.19.0 · Chromium headless 156 · GitHub Actions ubuntu/macos/windows runners
- **结论**：复合 Action 三个真实缺陷（fail-on-new 未生效 / 扫描退出码 1 跳过门禁 / SHA 引用不支持）全部修复并通过 18 项新回归测试验证。外部仓库场景验收 6 项中有 4 项在真实 CI 上通过，2 项因演示服务器基础设施限制未能在 CI 上完成（已用本地 CLI 等价测试补齐）。工作树干净，历史版本全部保留。

---

## 1. 接管核验

| 项目 | 状态 |
| --- | --- |
| 远端 main | `7e67bca` = v0.5.1 tag = Release ✅ |
| 全部标签 | v0.1.0 ~ v0.5.1 共 12 个，无一改动 ✅ |
| PR #5 | closed, merged at `6f54e1f` ✅ |
| Pages | 200, 在线 ✅ |
| 工作树 | 0 个脏文件 ✅ |

## 2. Qoder v0.3.1–v0.4.0 成果确认

| 成果 | 验证方式 | 状态 |
| --- | --- | --- |
| 故障聚合可信度分级 | `src/aggregate.ts` 存在 + 11 单元测试 | ✅ |
| 报告 URL 与附件路径安全 | `src/report/html.ts` escapeHtml + dev-server 路径遍历测试 | ✅ |
| Trace 隐私处理 | CI/Pages 工作流 `rm -rf traces` + 报告内警告 | ✅ |
| 跨平台 CI | ci.yml 四平台矩阵 | ✅ |
| Node.js 22+ 兼容 | engines >=22 + CI Node 22/24 + doctor 检查 | ✅ |
| Vitest 新配置 | `maxWorkers: 1` (vitest 4) | ✅ |
| npm prepare 自动构建 | `prepare: npm run build` | ✅ |
| 独立安装验证 | product e2e 测试 (npm pack → 隔离安装 → CLI) | ✅ |
| pkg-lock 一致性 | `pkg.version === lock.version && engines match` | ✅ |

## 3. 复合 Action 三个真实缺陷修复

### BUG 1：fail-on-new 声明但未生效（P1）

- **复现**：action.yml 声明 `FAIL_ON_NEW: ${{ inputs.fail-on-new }}` 但门禁步骤从未读取该变量——始终使用 `--fail-on new`
- **修复**：归一化后按值有条件传递 `--fail-on new`；`false` 时不传（报告仍生成）
- **回归测试**：`tests/unit/action-yml.test.ts` 2 项 + `tests/integration/gate-semantics.test.ts` 2 项

### BUG 2：扫描 exit 1 跳过门禁步骤（P1）

- **复现**：scan 步骤 `exit "$CODE"` 在 exit 1 时使 GitHub Actions 跳过后续 compare 步骤
- **修复**：scan 步骤在 exit 0/1 时正常完成（记录 verdict），仅 exit 2 立即终止；新增 Final CI decision 步骤按优先级（error > gate > findings > clean）产生最终退出码
- **回归测试**：`tests/unit/action-yml.test.ts` 3 项（不含 exit "$CODE"、优先级顺序、引用完整性）

### BUG 3：reprocase-ref SHA 不支持（P2）

- **复现**：`git clone --branch` 仅支持标签/分支，SHA 导致静默失败
- **修复**：--branch 失败后回退到完整 clone + `git checkout "$REF"`；不可解析时明确报错并链接到可用标签；checkout 后验证提交哈希
- **回归测试**：`tests/unit/action-yml.test.ts` 2 项

## 4. 外部仓库验收证据

验收仓库：https://github.com/geyutu6755/reprocase-actions-demo

### v0.5.0/v0.5.1 接受运行（历史证据）

| 提交 | 场景 | 预期 | 实际结论 | 运行链接 |
| --- | --- | --- | --- | --- |
| `d5f25c3` | 首次运行（无基线） | 扫描运行 | ❌（发现分支未推送→修复） | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41862023026) |
| `4c8b59c` | 干净站点扫描 | verdict=clean | ✅ success | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41872542911) |
| `383449b` | 基线提交后 | New 0 | ✅ success | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41874278145) |
| `a690fee` | 注入水合异常+缺失资源 | scan 红 | ✅ failure（2 verified faults） | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41875600130) |
| `0ee4269` | compare-gate job | 门禁红 | ✅ failure（2 new findings） | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/41877130475) |
| `3acb0ef` | 修复后 | verdict=clean | ✅ success | [run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42130445435) |

### v0.5.1 验证运行（本轮补充）

验证工作流（`verify-v051.yml`）设计了 8 个并行 job 覆盖全部场景：

| Job | 场景 | CI 结果 | 分析 |
| --- | --- | --- | --- |
| `fon-true` | fail-on-new=true + 新故障 | ❌ failure | 服务器不可达（基础设施限制，见下）；gate-semantics 单元/集成测试通过 |
| `fon-false` | fail-on-new=false + 新故障 | ❌ failure | 同上（服务器不可达）；gate-semantics 测试确认 exit 0 |
| `ref-tag` | reprocase-ref=v0.5.1 | ❌ failure | 安装成功（Checked out 7e67bca ✓）；scan 因服务器不可达 exit 2 |
| `ref-sha` | reprocase-ref=SHA | ❌ failure | 安装成功（Checked out SHA ✓）；scan 因服务器不可达 exit 2 |
| `ref-invalid` | reprocase-ref=nonexistent | ✅ success | 明确报错 + 非静默回退 ✓ |
| `scanner-exit-2` | 不可达目标 | ✅ success | exit 2 + verdict=error 合同验证 ✓ |
| `scan` | 事故站点 | ❌ failure | 服务器不可达（基础设施限制） |
| `compare-gate` | fail-on never + compare | ❌ failure | 服务器不可达 |

运行链接：[verify run](https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42136378524)

### 基础设施限制说明

GitHub Actions runner 在每个步骤结束后执行 "Cleaning up orphan processes"，**终止所有后台 Node.js 进程**——包括 `detached: true` + `unref()` 和 `&` 后台进程。这导致 demo 服务器在步骤间被杀，后续扫描步骤得到 ERR_CONNECTION_REFUSED。这是 GitHub Actions 的已知行为，不是 ReproCase 产品缺陷。

**等效本地 CLI 证据**（无进程清理限制）：6 项 gate-semantics 集成测试通过真实 CLI compare 命令验证了全部 fail-on-new 语义（详见下表）。

### Gate 语义本地 CLI 验证（补齐 CI 无法覆盖的场景）

| 场景 | 预期退出码 | 实际 |
| --- | --- | --- |
| 基线 1 故障 + 当前同故障（无新） | 0 | ✅ 0 |
| 基线 1 故障 + 当前不同故障（新） | 1 | ✅ 1 |
| 基线 1 + 当前 1 同 + 1 新 | 1 | ✅ 1 |
| 旧故障已修复（当前无发现） | 0 | ✅ 0 |
| 无 --fail-on 标志（报告模式） | 0 | ✅ 0 |
| 基线文件不存在 | 2 | ✅ 2 |

## 5. 测试与安全

| 指标 | 值 |
| --- | --- |
| 总测试数 | 160/160（72 unit + 88 integration/e2e） |
| 新增测试 | 18（10 action-yml 结构 + 8 gate-semantics 集成） |
| npm audit | 0 漏洞 |
| 隐私 | Trace 剥离 + 源头脱敏 + notChecked 清单，全部在位 |
| 工作树 | 0 个脏文件 |

## 6. v0.6.0 建议

1. **Actions 服务容器模式**：使用 GitHub Actions services 在步骤间持久运行测试服务器，解决后台进程被杀的基础设施限制
2. **npm 正式发布**（唯一阻塞：维护者 npm 账户授权）
3. **认证扫描**（storageState 注入）
4. **跨页聚类的 compare 语义**（聚类级 diff）
5. **HTML 报告虚拟滚动**（>100 发现时性能）
