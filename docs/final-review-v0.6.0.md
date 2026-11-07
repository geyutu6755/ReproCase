# ReproCase 持续开发与独立终审报告（v0.6.0）

- **终审日期**：2026-11-08
- **终审对象**：ReproCase v0.6.0（tag `v0.6.0` = `d85046a`）+ main 文档追加（`0b8f961`）
- **终审方式**：独立复审者视角——不依赖开发期样例，构建全新独立测试站点（`rc-audit`，11 页、8 类植入场景）与规模站点（`rc-scale`，41 页），全部实测
- **最终结论**：**PASS** —— 无已知未处理的 P0/P1 问题；两项 P3 记录在案（见 §7）

---

## 1. 实际版本、分支、提交与发布状态（实测核验）

| 项 | 实测值 |
| --- | --- |
| main | `0b8f961`，与 origin/main 同步，工作树干净 |
| tag v0.6.0 | `d85046a`（未移动），package.json 版本 0.6.0 与 tag 内容一致 |
| tag v0.5.1 / v0.5.0 | `7e67bca` / `6f54e1f`（原样保留，共 26 个远程 tag） |
| Release | v0.6.0 / v0.5.1 / v0.5.0 全部 published、非 draft |
| Pages | https://geyutu6755.github.io/ReproCase/ → HTTP 200 |
| 外部验收仓库 | 最新运行 `42413128605` = success |

## 2. 原定 v0.6.0 各阶段完成情况

| 阶段 | 状态 |
| --- | --- |
| P0 引用规范化（refs/tags、SHA、注入防护） | ✅ 21 项回归测试 + 外部 CI tag/branch/SHA/invalid 四态实测 |
| P1 GITHUB_STEP_SUMMARY | ✅ 9 项结构测试；外部 job 7 中 summary 步骤 success（跨步骤校验限制已写入文档 §8） |
| 外部仓库 7/7 场景 | ✅ run 42413128605 全绿（默认配置、明确版本、新/已有故障、fail-on-new 两态、扫描器错误、不可达、Artifact+Summary、same-step 服务启停、不可信 ref 拒绝） |
| 发布（tag/Release/Pages/CHANGELOG） | ✅ 一致性核验通过（§6） |

## 3. 曾遇到的阻塞及解决方式

| 阻塞 | 定性 | 解决 |
| --- | --- | --- |
| demo 仓库 5 个 job 失败 | 演示 workflow 自身缺陷（`require()` 路径解析、跨步骤读 `GITHUB_STEP_SUMMARY`、服务容器 mount 时序） | 逐一根因修复，3 次推送后 7/7 全绿；全程未改 ReproCase 代码 |
| scale 扫描误写主仓 `out/` | 终审脚本自身 shell 解析失误（`&` 使 `cd` 进入后台子 shell） | 核实为未跟踪产物后删除，主仓恢复干净 |
| npm 正式发布 | 维护者凭据（外部阻塞） | 保持已记录的已知限制 |

## 4–6. 独立复审结果（A–F 六项）

### A. 核心功能正确性（全新站点实测）

- **检出**：7 类植入故障全部 3/3 复现——交互 TypeError（pricing 按钮）、hash-SPA 视图切换异常（dashboard，带完整 3 步点击路径归属）、URL secret 泄漏异常（profile）、markup 形态异常文本（xss）、页面 404、站内死链、Shadow DOM 内断图（gallery，open shadow root 穿越成功）
- **零误报**：clean 对照页 0 发现；规模站点 9 个发现与植入位置（i%7→5 个 JS 异常、i%9→4 个断图）逐一对应
- **compare 语义**：New=1→exit 1；已修复（页面保留、故障移除）→ Resolved=1 confirmed；页面删除（覆盖缩水）→ Resolved=1 **unconfirmed** 并明确标注 "COVERAGE SHRANK"——覆盖率感知语义诚实
- **复现链**：生成的 7 个 Playwright 测试在独立环境实跑 **7/7 通过（13.5s）**，测试标题同样携带脱敏
- **退出码合同**：0（无发现/never）/ 1（有发现）/ 2（入口不可达）实测正确

### B. 安全与隐私（实测）

- **破坏性操作边界**：`POST /api/destroy`（"Delete all my records" 按钮）**0 次请求**；`subscribe`/`delete` 均属 HARD 危险关键词，三级策略（hard 禁止 / soft 需 allowSelectors / denySelectors）执行正确
- **扫描范围边界**：跨端口目标（`http://127.0.0.1:59999/bomb.html`）**0 次请求**——samePort 范围钉住生效
- **Secret 脱敏**：URL 查询参数 token 在 pageUrl、message、stack、result.json、report.html、issues.md、per-issue 文件、生成测试标题中全部 `***` 化；全工件 grep 原始 token 零泄漏
- **HTML 注入**：异常消息含 `<img src=x onerror=alert(1)>` 时，嵌入 JSON 的 `<` 全部 `\u003c` 转义（script 上下文正确防御）；原始标签未进入 DOM
- **畸形输入**：`maxPages:-5`、`windowMs:"banana"` → 明确 `[warn] Ignoring …` + 回退默认，不崩溃；缺失 config → exit 2 + ENOENT 指引
- **请求审计**：服务器端全量请求日志与 `notChecked` 披露清单（表单提交、认证页、第三方资源、跨源 iframe、closed shadow root、无障碍、性能）一致

### C. 用户体验（新用户身份闭环实测）

`init`（二次运行拒绝覆盖并提示 `--force`）→ `doctor`（Node/Chromium/config/可达性/可写性五查，失败项给出精确修复建议）→ `scan --url`（免配置快速路径）→ 中文输出路径（`我的项目报告/中文输出`）正常写入全部产物 → `issues.md`（置信度、复现比、逐项格式化）→ `compare`（人读 HTML diff + JSON）→ GitHub Actions run 页面摘要（外部 job 7 验证）。文档：README Quick Start 命令逐条可用；`docs/cli.md`、`docs/architecture.md`、报告截图均存在。

### D. 测试有效性

- **181/181 实跑全绿**（23 文件，358s，含真实浏览器集成与 e2e；非缓存结果）
- 0 个 `.skip/.todo/.only`；负向/注入/不可达/晚到故障测试确认存在（4 个文件）
- 时序依赖仅 18 处局部有界等待，套件实测稳定
- `npm test` 只跑 unit（125）；全量需 `npm run test:all`——README/CI 均已使用正确入口，无需修改

### E. 性能与稳定性（41 页规模实测）

- 42 页扫描 129s（≈3.1s/页），9 发现去重正确，`observationTimeouts: 0`
- 报告体积 52KB（42 页/9 发现），无膨胀
- 扫描结束后 **0 个 Chromium 残留进程**——浏览器上下文正确释放

### F. 发布与工程一致性

`package.json` = `package-lock.json` = tag 内容 = Release = 0.6.0；engines `>=22`；bin/files 正确；npm pack 干跑 275KB（dist + 双语 README + CHANGELOG + LICENSE + examples）；CHANGELOG `[0.6.0] — 2026-11-08` 在档；CI 四 OS 矩阵对最新 main 全绿（run 42413509016 success）。

## 7. 发现的问题（全部已定性处理）

| 级别 | 问题 | 处理 |
| --- | --- | --- |
| P0/P1 | 无 | — |
| P2 | 无（候选"表单内按钮覆盖"经代码与行为双重核查后降级，见下） | — |
| P3-1 | `report.html` 在 JS 禁用时为空壳（无 `<noscript>` 回退） | 记录；报告定位为交互式离线文档，JS 为默认环境 |
| P3-2 | 表单内 `type="button"`（安全标签）与表单内 hash 链接被 `closest('form')` 一并跳过（`src/util/selectors.ts:206`）——保守方向的覆盖缺口 | 记录；不建议在已外部验收的 v0.6.x 上变更探索行为，留待后续版本评估（危险关键词三级策略独立于该层，安全边界不受影响） |
| 澄清 | dashboard `Cannot set properties of null` 非产品误报——测试页自身把 DOM 访问置于 throw 之前，视图被扫描器后续点击替换后该行真实抛错；归属与点击路径记录完全正确 | 测试页缺陷，非产品缺陷 |

## 8. 外部 GitHub Actions 实测链接（真实 runner，非本地模拟）

- 全绿运行（7/7）：https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42413128605
- 辅助运行（6/7 + 复合 Action 首次端到端）：https://github.com/geyutu6755/reprocase-actions-demo/actions/runs/42412801234 、 /42411245211
- 主仓 CI（四 OS）：run 42413509016（success）
- 本轮反向验收（全新独立站点）：本地实测，证据为本报告 §4–6 所列命令/退出码/审计日志；与外部 runner 证据分开标注，无混用

## 9. 未解决事项及原因

1. **npm registry 正式发布**——等待维护者 npm 凭据（外部授权阻塞，非代码问题）
2. **P3-1 / P3-2**——按 §7 处理原则记录，不阻塞发布质量
3. **异步水合 >1s 且此后安静的页面**仍可能漏检——已在 README/验收文档如实披露的设计限制

## 10. 最终判定

**PASS** —— 所有关键验收通过：核心检测功能在新独立场景零误报、安全边界（破坏性操作/越界/脱敏/注入）全部实测成立、181 测试实跑全绿、四 OS CI 全绿、外部 runner 7/7、发布资产与 Git 状态一致、无已知未处理 P0/P1 问题。无真实代码缺陷需修复，故不创建 v0.6.1（符合发布规则第 4 条）。
