# ReproCase

[![CI](https://github.com/geyutu6755/ReproCase/actions/workflows/ci.yml/badge.svg)](https://github.com/geyutu6755/ReproCase/actions/workflows/ci.yml)
[![GitHub Pages demo](https://img.shields.io/badge/%E6%BC%94%E7%A4%BA-%E5%9C%A8%E7%BA%BF%E6%8A%A5%E5%91%8A-2563eb)](https://geyutu6755.github.io/ReproCase/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**网站自动故障检测与复现工具。** ReproCase 在真实浏览器中扫描网站，发现具有客观证据的故障，
对每个故障进行独立重复验证，并生成可重复执行的 Playwright 回归测试，以及同时面向人类和
AI 编程助手的报告。

English documentation: [README.md](README.md)

## 检测什么

| 故障类型 | 采集的证据 | 默认严重程度 |
| --- | --- | --- |
| 未捕获 JS 异常（含未处理的 Promise 拒绝） | 消息、堆栈、精确点击路径、截图、浏览器 Trace | high |
| 页面加载失败（HTTP ≥ 400 或导航错误） | 状态码 / 错误文本、截图 | high |
| 第一方资源加载失败（脚本、图片、CSS 等） | 资源 URL、状态码 / 网络错误、截图 | medium |
| 无效内部链接 | 目标 URL、状态码、所有引用页面 | medium |
| 横向溢出（桌面 + 移动视口） | scrollWidth 与 clientWidth 对比、越界元素、截图 | low |
| Console 错误 | 消息、页面、可复现性 | suspected（提示性质） |

每个发现都会被标注为 **verified**（在独立浏览器运行中复现成功）或 **suspected**
（观察到一次但未证明可复现）。ReproCase 不伪造结果、不判定业务逻辑正确性，
并始终列出它**没有**检查的内容。

## 快速开始

```bash
# 30 秒体验 —— 扫描内置演示网站（含 4 个植入故障）：
git clone https://github.com/geyutu6755/ReproCase.git
cd ReproCase && npm install && npx playwright install chromium && npm run build
npx reprocase demo            # 输出 reprocase-demo-report/report.html 并自动打开
```

扫描任何你被授权测试的网站：

```bash
npx reprocase scan --url http://localhost:3000/ --out my-report
npx reprocase scan --config reprocase.config.json --fail-on verified
```

> 退出码：`0` 无达到阈值的发现 · `1` 存在发现 · `2` 扫描失败（配置错误、入口不可达）。
> 适合 CI 集成 —— 详见 [docs/cli.md](docs/cli.md)。

[**在线演示报告**](https://geyutu6755.github.io/ReproCase/) —— 由 CI 流水线在每次推送到
`main` 时针对内置演示网站自动生成。

## 一次扫描产出什么

```
my-report/
├── report.html            自包含可离线打开的 HTML 报告（另有 index.html）
├── result.json            机器可读的扫描结果
├── issues.md              覆盖全部发现的 GitHub Issue Markdown
├── issues/<id>.md         每个发现一个可直接粘贴的 Issue
├── generated-tests/       可直接运行的 Playwright 复现测试 + 配置 + 说明
└── artifacts/
    ├── screenshots/       证据截图
    └── traces/            Playwright Trace（用 playwright show-trace 打开）
```

生成的 Playwright 测试**断言故障仍然存在**：Bug 存在时测试通过（证明可稳定复现），
修复后测试失败 —— 失败本身提示你换入文件中注释掉的“修复后”断言，把文件变成
永久的回归守卫。

## 默认安全与隐私

- 仅允许 `localhost` 目标，除非主机被显式列入 `allowedDomains`。
- 只读优先探索：不填表单、不提交、始终关闭对话框、绝不点击危险按钮（支付 / 删除 / 提交 / 发送等）。
- 硬性预算：最大页面数、最大深度、每页最大交互数、运行超时、请求间隔。不会无限爬取。
- 报告中的 URL 会脱敏（token / password / email / session 等查询参数被遮蔽）。
- Trace 仅对 localhost 目标自动采集。**Trace 与截图可能包含未经脱敏的页面内容、URL 和查询参数 —— 公开分享本报告前请先人工审查。**

完整设计见 [docs/architecture.md](docs/architecture.md)。

## 文档

- [安装指南](docs/installation.md)
- [CLI 使用说明](docs/cli.md)
- [配置说明](docs/configuration.md)（[示例配置](reprocase.config.example.json)）
- [架构说明](docs/architecture.md)
- [贡献指南](CONTRIBUTING.md) · [变更日志](CHANGELOG.md) · [许可证（MIT）](LICENSE)

## 本地开发

```bash
npm install
npx playwright install chromium
npm run build      # tsc -> dist/
npm test           # 单元测试
npm run test:all   # 单元 + 集成（真实浏览器）+ CLI 端到端
```

测试套件会扫描内置演示网站，断言四种植入故障全部被检出、干净对照页零误报，
并且生成的测试能通过真实 Playwright 运行器复现每个故障。

## 状态

v0.1.1 —— 安全修复版本（扫描作用域固定、计划/堆栈源头脱敏、探索覆盖修复、证据分享警告）。详见
[变更日志](CHANGELOG.md) 与[独立审计报告](docs/audit-2026-10-31-v0.1.0.md)。
已知限制见变更日志及每份报告中的“未检测项目”部分。

## 许可证

[MIT](LICENSE) © ReproCase contributors
