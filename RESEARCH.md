# BTW 竞品调研（pi 生态 side-conversation 包）

调研日期：2026-11-13。来源：pi.dev/packages、npm registry、socket.dev、GitHub 仓库。

## "btw" 是什么

`/btw <question>`：在主 agent 干活时问一个侧问题（side question），答案不进主会话上下文，
需要时显式回传（注入全文 / 摘要 / 笔记）。概念来自 Claude Code 的 `/btw` 与 Codex 的 `/side`，
pi 生态里已经是一个竞争激烈的品类，至少 8 个实现。

## 已有实现（按下载量）

### 1. pi-btw (dbachelder) — 36.8K/mo，事实标准
- repo: github.com/dbachelder/pi-btw，v0.8.1，MIT，entry `extensions/btw.ts`
- **架构：真 pi sub-session**（in-memory session state + transcript events + 独立工具面），
  overlay 的 transcript/状态行由 sub-session 事件驱动，流式不靠刮屏
- 三种线程模式：
  - `/btw` 继承主会话上下文，全工具 read/bash/edit/write
  - `/btw:tangent` 无上下文（brainstorm）
  - `/btw:ask` 继承上下文但**结构性只读**（read/grep/find/ls，无 bash/edit/write）
- UI：模态 shell（自带 composer + transcript），Alt+/ 切焦点（`PI_BTW_FOCUS_KEYS` 可重映射），
  Alt+w 窗口/全宽布局，Esc 两段语义（流式中先中止、再关闭），置顶居中主会话仍可见
- 上下文隔离：hidden custom entries 持久化——跨 reload/重启恢复线程，
  主 agent 的 LLM 上下文永远看不到
- 回传：`/btw:inject`（全文回注，主忙则排队）、`/btw:summarize`（thinking off 摘要回注）、
  `--save`（单次交换写为可见 session note）
- `/btw:model` / `/btw:thinking` 侧聊专属覆盖（可配便宜模型）；凭证缺失回落主模型
- 可选扩展工具：`~/.pi/agent/btw.json` 声明 `extensions: ["npm:pi-web-access"]`，
  默认零扩展防递归；`/btw:ask` 永不加载扩展
- SSH workspace 支持（对接 pi-ssh-remote，独立连接，不跑其扩展工厂）
- in-modal slash 路由：BTW 生命周期命令归 BTW，其余 `/xxx` 交给子会话处理
- `/side` 别名（对齐 Codex）；附带 skill 提高可发现性
- 代码体量：btw.ts 单文件 102KB；测试 151KB+（runtime/sdk/ssh/completion 分文件）

### 2. @narumitw/pi-btw — 24.3K/mo
- repo: github.com/narumiruna/pi-extensions（monorepo workspace）
- 差异点在 **UI 工作区**：fullscreen / side-left / side-right 三布局 + 可拖拽记住比例的分栏
- F9 "Import main updates"：手动预览+确认导入主线程新增上下文（绝不自动）
- 回传粒度可选：最新答案 / 问题后缀 / 精确范围 / 全线程
- Mermaid fence 渲染为宽度安全的 Unicode 图（无浏览器无网络）
- transcript 搜索、follow-up、queued steering、in-memory resume
- 设置 `~/.pi/agent/pi-btw.json`（model 用 `provider/model-id` 格式）
- 仅 TUI 模式；`/btw` 无参数时打开管理器（选上下文/设置）

### 3. @nguyenquangthai/pi-btw
- **架构：RPC 子进程**（`pi --mode rpc --no-session`），进程级隔离，零上下文膨胀
- **9 个并行 slot**：`/btw 2 <q>`、Alt+1-9 直跳、Alt+I 注入、Alt+X 清除、Alt+H/L 切换
- 上下文策略可配：smart / last-n / budget / compact / none / full + maxContextTokens 预算
- per-answer token/成本统计；历史浏览器；slot 状态跨 resume//fork/重启持久
- per-slot 模型覆盖（便宜模型跑侧问）
- 流式 TTFT < 500ms

### 4. @pify/btw — Pify 套件成员
- 定位："read-only, codebase-aware side agent in a widget"
- in-memory sub-session：继承主会话 + 项目 system prompt/context files，
  零扩展（不能递归），只读工具 read/grep/find/ls
- 流式 widget 在编辑器上方；思考流只显尾巴，落定后折叠为 `💭 thought N lines`
- `--save` 笔记**静默保存**，即使主 agent 忙也不触发主回合；side agent 不重读自己的笔记
- 诚实的局限文档：无写工具时模型会"叙述编辑"或打印 tool-call JSON 假象，
  summarize 会把这种虚构带进主会话

### 5-8. 其余
- **@juicesharp/rpiv-btw**（9.3K/mo）：rpiv 套件，一次性侧问给同一主模型，不污染主对话
- **@fradser/pi-btw**：卖点 "Unlike Claude Code's /btw, 可真调只读工具验证代码库事实"
- **@pandi-coding-agent/btw**（12/wk）：最小实现——读当前分支 + `completeSimple()`
  一次性调用、无工具、答案进可关闭 overlay、永不入 history；长会话靠 provider 截断
- **@xzzpig/pi-btw**：pi.dev 在列（未深挖）

## 已收敛的"标配"（做新实现必须有的）

1. `/btw <q>` 立即执行，主 agent 忙时也能用，不打断主回合
2. 线程/答案默认对主 agent 上下文不可见（hidden entries / 进程隔离 / 过滤）
3. 显式回传通道：inject 全文 / summarize 摘要 / --save 笔记
4. 侧聊专属 model + thinking 覆盖（常见动机：用便宜模型省钱）
5. 继承主会话 vs contextless（tangent）两种模式
6. 工具面分级：全工具 / 结构性只读 / 无工具
7. 持久化：跨 reload、重启、fork 恢复线程
8. 附带一个 skill 帮模型识别"该用侧聊"的场景

## 架构流派

| 流派 | 代表 | 优点 | 代价 |
|---|---|---|---|
| 真 sub-session（in-process） | dbachelder、pify | 事件驱动流式、工具面可控、slash 全兼容 | 实现最复杂（100KB+） |
| RPC 子进程 | nguyenquangthai | 进程隔离最彻底、天然并行 slot | RPC 协议自己维护、UI 桥接 |
| 一次性 completeSimple | pandi、rpiv | 百行级实现 | 无工具无后续、长会话截断 |

## 差异化空间（现有实现没占的）

- 图片/截图侧问（贴个 UI 截图问"这个按钮该放哪"）
- 结构化回传：侧聊产出直接落成 patch/draft 文件而不是注入文本
- 跨会话共享 btw 线程（team/pair 场景）
- 自动路由：判断"这个问题该进主线程还是侧聊"（可结合 skill）
- 侧聊模板/预设（review 模式=只读+lint 工具， brainstorm 模式=tangent+web）
- 语音输入侧问
- Web/远程 UI（dbachelder 只做了 DSH 桥接，原生 web 面板仍是空的）

## 建议的本地起步路径

```bash
mkdir -p extensions skills/btw
# package.json 声明 pi manifest：{ "extensions": ["./extensions/btw.ts"], "skills": ["./skills"] }
# 本地试用：pi -e /Users/hsu/workspace/pi-btw
```

pi 扩展 API 细节见 pi 文档 docs/extensions.md 与 examples/extensions/。
