# dsh-quick-tasks

DSH 左侧栏「后台任务」面板：管理需要后台运行的本地服务，一键启动 / 停止 / 重启，并显示运行状态、端口、PID、运行时长与实时日志。随 DSH 一起退出时，被托管的服务会一起停止。

## 已实现

- 左侧栏入口（`sidebar.panellist`，order 20，位于「自动化任务」之后），图标右下角 6px 状态点：绿=运行中、蓝=启动中、红=异常/端口冲突、灰=未运行。
- 主面板（root `main` keyed slot，key `dsh-quick-tasks`）：任务卡片 + 状态徽标 + 端口/PID/运行时长 + AI Key 配置状态 + 启动/停止/重启/打开页面/查看日志/复制日志路径/删除。
- 删除任务：卡片操作区末尾的红色「删除」按钮。防误触用两步确认——第一次点击按钮变成实心红底的「确认删除？」，8 秒内再点一次才真正执行（期间可点别的按钮或等超时取消）。删除会做三件事：停掉该服务进程、把任务从插件 `cordis.patch.yml` 的 `config.tasks` 里整块删掉、清掉 `state.json` 里的 PID 记录；改配置前会自动备份到 `~/.dsh/dsh-quick-tasks/backups/cordis.patch.<时间戳>.yml`。
- 「通过对话添加服务」入口（面板头部按钮）：点击后调 `ctx.uiWorkspace.startSession(undefined, { prompt, whenDraftExists: "append" })` 新建/复用空白会话，把「需求占位 + 自动附加的插件维护说明」预填进草稿；用户把需求写进占位处后发送，最终消息 = 需求 + 维护说明。说明覆盖插件结构、`config.tasks` 字段、热重载与 API 验证步骤、失败排查、完成后的 README 更新要求，让新会话里的 agent 能独立完成接入。DSH 没有“发送后改写消息”的钩子，这是官方同款做法（同「创建你的插件」入口）。
- 宿主半侧（Cordis 插件，`inject: ["webServer"]`）：
  - `GET  /api/dsh-quick-tasks/state` 状态快照
  - `GET  /api/dsh-quick-tasks/logs?taskId=<任务id>&tail=200` 日志尾部
  - `POST /api/dsh-quick-tasks/start|stop|restart|delete`（JSON `{taskId}`）
- 进程托管（attached 模式）：`spawn` 独立进程组 → SIGTERM 等待 → SIGKILL 兜底；`process.on("exit")` 在宿主退出时同步杀进程树，所以**退出 DSH 会同时停止服务**。
- 崩溃/被 SIGKILL 时：实例 PID 落盘到 `~/.dsh/dsh-quick-tasks/state.json`，下次启动时 `#adopt` 校验 PID + 命令行 + 端口后接管，不会重复起服务。
- 日志：`~/.dsh/dsh-quick-tasks/logs/<任务id>.log`，64MB 轮转，面板内嵌日志视图（3s 刷新）。
- 安全：所有写操作校验自定义头 `x-dsh-quick-tasks: 1`、回环地址、`sec-fetch-site`、Host 与 Origin 同 authority；JSON body 上限 64KB。

## 文件结构

```
dsh-quick-tasks/
├── package.json          # dsh.bundle.patch + dsh.client 声明
├── cordis.patch.yml      # 插入插件行 + 任务清单配置
├── lib/
│   ├── index.js          # 宿主半侧：WebServer 路由 + 任务管理
│   ├── task-manager.js   # 进程启停 / 状态 / 日志 / 状态文件 / 删除任务
│   ├── patch-file.js     # cordis.patch.yml 行级编辑器（删除 config.tasks 里的某个任务项）
│   └── client.js         # 浏览器半侧：__ModuleLoader__ CJS 工厂 + 面板与侧栏图标
└── LICENSE
```

## 安装

标准方式（必须**完全退出** DeepSeek Harness 后执行）：

```bash
DSH="/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
"$DSH" plugin --profile desktop add github:Theembers/dsh-quick-tasks
```

安装后插件会出现在插件列表里，需要启用该 bundle。桌面 profile 用的是应用自带的 CLI（普通 npm 版 `dsh` 会拒绝 `--profile desktop`）。

改完 `lib/client.js` 后刷新页面即可（dsh-client-hmr 会自动替换 bundle）；改 `lib/index.js`、`lib/task-manager.js`、`lib/patch-file.js` 等宿主代码没有 watch，正常需要退出并重启 DSH。急用时可以让 dsh-hmr 热重载配置树来重新 apply 插件（改一下 profile 的 `cordis.patch.yml` 触发），这样宿主侧新代码会立刻生效——热重载不会杀掉已托管的服务进程，重启后按 `state.json` 里的 PID 继续接管。

## 配置任务

任务清单写在插件 `cordis.patch.yml` 的 `config.tasks` 里，字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 唯一 id，面板与 API 都用它 |
| `label` / `description` | 展示文案 |
| `mode` | `attached`（默认，随 DSH 退出）或 `detached`（退出时保留） |
| `cwd` | 工作目录 |
| `node` | Node 绝对路径（默认 `/opt/homebrew/bin/node`） |
| `argv` | 启动参数，第一项相对 `cwd` 解析，其余原样传给 Node |
| `port` / `url` | 端口与访问地址 |
| `healthPath` | 健康检查路径（GET，2xx 视为就绪，返回 JSON 可展示 AI 配置） |
| `readyTimeoutMs` / `stopTimeoutMs` | 就绪等待 / 停止超时 |
| `logPath` | 日志文件路径 |

改完由 dsh-hmr 热重载配置树，一般不需要重启。

> 仓库里自带的 `cordis.patch.yml` 是作者本机的实例配置。装到别的机器后，请把 `config.tasks` 改写成你自己的服务，或改成 `tasks: []`（面板会显示空态，不影响插件其它功能）。

## 验证（装好后直接调接口）

```bash
BASE=http://127.0.0.1:51419   # 端口以你实际的 DSH 实例为准

curl -s $BASE/api/dsh-quick-tasks/state

curl -s -X POST $BASE/api/dsh-quick-tasks/start \
  -H 'content-type: application/json' \
  -H 'x-dsh-quick-tasks: 1' \
  -d '{"taskId":"<任务id>"}'

curl -s "$BASE/api/dsh-quick-tasks/logs?taskId=<任务id>&tail=200"

curl -s -X POST $BASE/api/dsh-quick-tasks/stop \
  -H 'content-type: application/json' \
  -H 'x-dsh-quick-tasks: 1' \
  -d '{"taskId":"<任务id>"}'
```

写操作必须带 `x-dsh-quick-tasks: 1` 头并来自回环地址，否则返回 403。

## 通过对话添加服务

面板头部「通过对话添加服务」按钮：

1. 调 `ctx.uiWorkspace.startSession(undefined, { prompt: ADD_SERVICE_DRAFT, whenDraftExists: "append" })`，在最近工作区新建（或复用空白）会话并打开会话界面。
2. 草稿内容是一段可直接发送的模板：最上面是自动附加的《DSH「后台任务」插件维护说明》，最下面是「【需求】请在这里写你要添加的服务，替换本行后直接发送」占位——需求写在说明的下边。
3. 用户把需求写进占位处后发送；最终发给 agent 的消息 = 维护说明 + 需求。若复用的空白会话里已有草稿，`whenDraftExists: "append"` 会把整段内容追加在已有内容之后。
4. 维护说明包含：插件路径与先读文件、`config.tasks` 字段表（含 attached 模式）、dsh-hmr 热重载、`/api/dsh-quick-tasks/state|logs|start` 的 curl 验证（写操作需 `x-dsh-quick-tasks: 1` 头）、常见失败排查、README 与交付要求；新服务需要特殊进程管理时要求先说明原因再扩展。

依赖：客户端插件 `inject` 增加 `"uiWorkspace"`，`package.json` 的 `dsh.client.inject` 增加 `@deepseek-ai/dsh-client-ui-workspace`；Workspace 服务不可用时按钮报错而不是崩溃。

## 已知限制

- 目前只完整验证过单个任务的场景；多任务渲染已按列表写，未做完整实测。
- 删除功能改的是插件自带的 `cordis.patch.yml`（`dsh.bundle.patch` 指向的文件）。若把任务写在别处（例如 profile 自己的 patch 文件），删除会提示 `patch-edit-failed`，需要手动改配置。
- 侧栏 pin / 选中状态是 DSH 内存态，插件重载后会重置。
- 宿主被 SIGKILL 且从未重启时，服务会作为孤儿存活（下次启动 DSH 时自动接管）。
- `process.on("exit")` 只覆盖正常退出路径；DSH 的 SIGTERM/SIGINT 关停走的是宿主优雅退出，已实测进程树被清理。

## License

MIT
