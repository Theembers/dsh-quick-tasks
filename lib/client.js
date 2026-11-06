/**
 * dsh-quick-tasks 浏览器侧入口。
 * 注意：这不是 ESM 模块，不能有顶层 import/export；
 * 运行时由宿主注入 window.__ModuleLoader__.load，factory 内才能 require 平台种子模块。
 */
window.__ModuleLoader__.load({
  id: "dsh-quick-tasks",
  factory: function (require) {
    const React = require("react");
    const el = React.createElement;

    const NS = "dsh-quick-tasks";
    const PANEL_ID = "dsh-quick-tasks";
    const API = "/api/dsh-quick-tasks";
    const POLL_MS = 4000;

    /**
     * 「通过对话添加服务」预填草稿。
     * 上半段是插件维护说明（自动附加），下半段是需求占位；
     * 用户把需求占位替换成自己的需求后直接发送，说明留在需求上方。
     */
    const ADD_SERVICE_DRAFT = `【DSH「后台任务」插件维护说明（自动附加，请保留在前）】

这是「后台任务」面板的对话式添加服务流程。目标插件是 ~/.dsh-space/plugins/dsh-quick-tasks/，当前只接入了 ziwei（紫微斗数，3100 端口）。

1. 先读实现再动手：lib/task-manager.js（进程托管/状态机/日志/健康探针）、lib/index.js（REST 与安全校验）、cordis.patch.yml（任务配置）、README.md（字段与验收）。
2. 一般只改 cordis.patch.yml 里 \`- id: dsh-quick-tasks\` 的 config.tasks，追加一个任务项，字段：
   id（唯一短 id）、label、description、mode（attached=随 DSH 退出停止，默认；只有用户明确要求退出后继续运行才用 detached）、cwd（服务目录绝对路径）、node（Node 绝对路径，默认 /opt/homebrew/bin/node）、argv（首项相对 cwd，如 ["node_modules/.bin/next","dev","--port","3200"]）、port、url、healthPath（返回 2xx 视为就绪；JSON 会在面板展示 configured/provider/model）、readyTimeoutMs（默认 120000）、stopTimeoutMs（默认 5000）、logPath（绝对路径）。
   反过来看，面板卡片上的「删除」按钮等价于把 config.tasks 里对应的 \`- id: <任务id>\` 整块删掉（配置文件会先备份到 ~/.dsh/dsh-quick-tasks/backups）；删掉后该任务不再出现在面板里。
3. 保存后 dsh-hmr 自动热重载配置树，无需重启；面板点「刷新」出现新卡片。
4. 验证：GET http://127.0.0.1:51419/api/dsh-quick-tasks/state 能看到任务；启动需带自定义头 POST：
   curl -s -H 'x-dsh-quick-tasks: 1' -H 'content-type: application/json' -d '{"taskId":"<id>"}' http://127.0.0.1:51419/api/dsh-quick-tasks/start
   然后 GET /state 轮询到 running；GET /logs?taskId=<id> 看日志；失败先看 logPath。
5. 常见失败：端口占用（port-conflict）、cwd 不存在、node 路径错、argv 错；healthPath 不通会一直 starting 直到 readyTimeoutMs 后变 unhealthy。
6. 新服务不是 Node 启动、或需要特殊进程管理时，先说明原因，再扩展 task-manager，并保持现有 REST、安全校验与 attached 语义不变。
7. 完成后更新 README.md 的「已接入任务」，把改动文件、任务 id、端口、验证结果告诉用户。不要改 ziwei，不要动 profile 接线（软链与 dsh.profile.bundles 已配好）。

────────
【需求】请在这里写你要添加的服务，替换本行后直接发送
（写清楚：服务名称、目录、启动命令、端口、健康检查路径；例如“加一个 xxx 服务，cd 到 /path，用 npm run start 启动，端口 3200，健康检查 /health”）`;

    const DICT = {
      zh: {
        title: "后台任务",
        subtitle: "启动本机常驻服务；DSH 退出时会一并停止",
        addViaChat: "通过对话添加服务",
        addViaChatHint: "打开新会话，把你的需求写进草稿后发送；插件维护说明会自动附在需求前面",
        addViaChatFailed: "无法创建新会话：Workspace 服务不可用或当前没有可用工作区",
        refresh: "刷新",
        start: "启动",
        stop: "停止",
        restart: "重启",
        open: "打开页面",
        logs: "查看日志",
        hideLogs: "收起日志",
        copyPath: "复制日志路径",
        copied: "已复制",
        empty: "还没有配置任务",
        loading: "加载中…",
        failed: "操作失败",
        lastExit: "上次退出",
        logEmpty: "暂无日志",
        noHint: "",
        delete: "删除",
        deleteConfirm: "确认删除？",
        deleteHint: "删除会停掉该服务，并把任务从 cordis.patch.yml 里移除",
        deleteNeedsRestart: "删除接口尚未生效，请重启 DSH 后再试",
        status: {
          stopped: "未运行",
          starting: "启动中",
          running: "运行中",
          unhealthy: "运行异常",
          "port-conflict": "端口冲突",
          foreign: "外部实例",
          error: "出错",
        },
        aiConfigured: "AI 解读已配置",
        aiMissing: "AI 解读未配置",
        aiHint: "在 ziwei-doushu/.env.local 里配置 API Key 后重启服务",
        port: "端口",
        pid: "PID",
        uptime: "已运行",
        logPath: "日志",
      },
      en: {
        title: "Background tasks",
        subtitle: "Start local services here; they stop when DSH quits",
        addViaChat: "Add service via chat",
        addViaChatHint: "Opens a new session; the plugin maintenance notes are prepended to your draft",
        addViaChatFailed: "Could not start a new session: Workspace service unavailable or no usable workspace",
        refresh: "Refresh",
        start: "Start",
        stop: "Stop",
        restart: "Restart",
        open: "Open page",
        logs: "Show logs",
        hideLogs: "Hide logs",
        copyPath: "Copy log path",
        copied: "Copied",
        empty: "No tasks configured",
        loading: "Loading…",
        failed: "Action failed",
        lastExit: "Last exit",
        logEmpty: "No logs yet",
        noHint: "",
        delete: "Delete",
        deleteConfirm: "Confirm delete?",
        deleteHint: "Deleting stops the service and removes the task from cordis.patch.yml",
        deleteNeedsRestart: "Delete API is not active yet — restart DSH and try again",
        status: {
          stopped: "Stopped",
          starting: "Starting",
          running: "Running",
          unhealthy: "Unhealthy",
          "port-conflict": "Port conflict",
          foreign: "External instance",
          error: "Error",
        },
        aiConfigured: "AI configured",
        aiMissing: "AI not configured",
        aiHint: "Set an API key in ziwei-doushu/.env.local, then restart",
        port: "Port",
        pid: "PID",
        uptime: "Uptime",
        logPath: "Log",
      },
    };

    const STYLE = `
.dqt-page {
  box-sizing: border-box; height: 100%; min-height: 0; display: flex; flex-direction: column;
  overflow: hidden; color: var(--dsw-alias-label-primary, #1f2328); background: var(--dsw-alias-bg-base, transparent);
}
[data-platform="darwin"] .dqt-page { padding-top: var(--dsh-frame-top-clearance, 48px); }
.dqt-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 20px clamp(16px, 3vw, 32px) 10px; }
.dqt-title { margin: 0; font-size: 16px; font-weight: 600; line-height: 1.4; }
.dqt-sub { margin: 4px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary, #8b949e); }
.dqt-head-actions { display: flex; gap: 8px; align-items: center; flex: 0 0 auto; }
.dqt-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 6px clamp(16px, 3vw, 32px) 40px; }
.dqt-btn { box-sizing: border-box; height: 28px; padding: 0 12px; border-radius: var(--dsw-radius-sm, 6px);
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.28)); background: transparent;
  color: var(--dsw-alias-label-primary, #1f2328); font-size: 12px; cursor: pointer; white-space: nowrap; }
.dqt-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(127,127,127,.10)); }
.dqt-btn:disabled { opacity: .45; cursor: default; }
.dqt-btn-primary { background: var(--dsw-alias-button-primary-fill, #2f6feb); border-color: transparent; color: #fff; }
.dqt-btn-primary:hover:not(:disabled) { filter: brightness(1.05); background: var(--dsw-alias-button-primary-fill, #2f6feb); }
.dqt-btn-ghost { border-color: transparent; }
.dqt-card { border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.22)); border-radius: var(--dsw-radius-md, 10px);
  background: var(--dsw-alias-bg-layer-1, rgba(127,127,127,.04)); padding: 14px 16px; margin: 12px 0; }
.dqt-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dqt-name { font-size: 14px; font-weight: 600; }
.dqt-badge { font-size: 12px; padding: 1px 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3, rgba(127,127,127,.12)); }
.dqt-badge.running { color: var(--dsw-alias-state-success-primary, #2da44e); }
.dqt-badge.starting { color: var(--dsw-alias-state-business-primary, #2f6feb); }
.dqt-badge.unhealthy, .dqt-badge.port-conflict { color: var(--dsw-alias-state-error-primary, #d1242f); }
.dqt-badge.foreign { color: var(--dsw-alias-state-warn-primary, #bf8700); }
.dqt-meta { margin: 8px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #57606a); display: flex; gap: 10px; flex-wrap: wrap; }
.dqt-meta code, .dqt-health code { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); }
.dqt-health { margin: 6px 0 0; font-size: 12px; color: var(--dsw-alias-label-secondary, #57606a); }
.dqt-health.ok { color: var(--dsw-alias-state-success-primary, #2da44e); }
.dqt-health.bad { color: var(--dsw-alias-state-warn-primary, #bf8700); }
.dqt-error { margin: 10px 0 0; padding: 8px 10px; border-radius: var(--dsw-radius-sm, 6px); font-size: 12px;
  border: 1px solid var(--dsw-alias-state-error-primary, #d1242f); color: var(--dsw-alias-state-error-primary, #d1242f);
  background: var(color-mix(in srgb, var(--dsw-alias-state-error-primary, #d1242f) 10%, transparent)); }
.dqt-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
.dqt-btn-danger-ghost { color: var(--dsw-alias-state-error-primary, #d1242f); }
.dqt-btn-danger-ghost:hover:not(:disabled) {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d1242f) 12%, transparent);
  color: var(--dsw-alias-state-error-primary, #d1242f); }
.dqt-btn-danger { background: var(--dsw-alias-state-error-primary, #d1242f); border-color: transparent; color: #fff; }
.dqt-btn-danger:hover:not(:disabled) { background: var(--dsw-alias-state-error-primary, #d1242f); filter: brightness(1.05); }
.dqt-log { margin-top: 10px; border: 1px solid var(--dsw-alias-border-l1, rgba(127,127,127,.16));
  border-radius: var(--dsw-radius-sm, 6px); background: var(--dsw-alias-bg-base, rgba(127,127,127,.03)); }
.dqt-log pre { margin: 0; padding: 10px 12px; max-height: 40vh; overflow: auto; font-size: 11px; line-height: 1.5;
  font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); white-space: pre-wrap; word-break: break-all; }
.dqt-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary, #8b949e); margin-top: 6px; }
.dqt-empty { margin-top: 24px; font-size: 13px; color: var(--dsw-alias-label-tertiary, #8b949e); }
`;

    /* ---------------- 状态 store ---------------- */
    let state = { tasks: [], now: 0, loading: true, error: null };
    const listeners = new Set();

    function emit() {
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          /* 订阅方异常不影响其它订阅 */
        }
      }
    }
    function setState(patch) {
      state = Object.assign({}, state, patch);
      emit();
    }
    function getSnapshot() {
      return state;
    }
    function subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }

    async function call(path, body) {
      const init = body
        ? {
            method: "POST",
            headers: { "content-type": "application/json", "x-dsh-quick-tasks": "1" },
            body: JSON.stringify(body),
          }
        : { method: "GET" };
      const response = await fetch(API + path, init);
      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }
      if (!response.ok || (data && data.ok === false)) {
        const error = new Error((data && data.error && data.error.message) || "请求失败");
        error.code = data && data.error && data.error.code;
        error.hint = data && data.error && data.error.hint;
        error.status = response.status;
        throw error;
      }
      return data;
    }

    async function refresh() {
      try {
        const data = await call("/state");
        setState({ tasks: data.tasks || [], now: data.now || Date.now(), loading: false, error: null });
      } catch (error) {
        setState({ loading: false, error: error });
      }
    }

    /* ---------------- 工具函数 ---------------- */
    function tFactory(ctx) {
      const bound = ctx.locale.bind(NS);
      const dict = DICT;
      return function t(key) {
        const value = bound ? bound(key) : undefined;
        if (value && value !== key) return value;
        const parts = String(key).split(".");
        let node = dict.zh;
        for (const part of parts) {
          node = node && node[part];
        }
        return node || key;
      };
    }

    function formatUptime(ms) {
      if (!ms || ms < 0) return "-";
      const totalSeconds = Math.floor(ms / 1000);
      const seconds = totalSeconds % 60;
      const minutes = Math.floor(totalSeconds / 60) % 60;
      const hours = Math.floor(totalSeconds / 3600);
      if (hours > 0) return hours + "h " + minutes + "m";
      if (minutes > 0) return minutes + "m " + seconds + "s";
      return seconds + "s";
    }

    function formatTime(ts) {
      if (!ts) return "-";
      try {
        return new Date(ts).toLocaleString("zh-CN", { hour12: false });
      } catch {
        return String(ts);
      }
    }

    function statusText(t, status) {
      return t("status." + status);
    }

    function statusColor(status) {
      if (status === "running") return "var(--dsw-alias-state-success-primary, #2da44e)";
      if (status === "starting") return "var(--dsw-alias-state-business-primary, #2f6feb)";
      if (status === "unhealthy" || status === "port-conflict") return "var(--dsw-alias-state-error-primary, #d1242f)";
      if (status === "foreign") return "var(--dsw-alias-state-warn-primary, #bf8700)";
      return "var(--dsw-alias-label-tertiary, #8b949e)";
    }

    function Dot(props) {
      return el("span", {
        style: {
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: 999,
          flex: "0 0 auto",
          background: statusColor(props.status),
        },
      });
    }

    /* ---------------- 侧栏入口图标 ---------------- */
    function SidebarIcon(props) {
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);
      const size = (props && props.size) || 16;
      const first = snapshot.tasks && snapshot.tasks[0];
      const status = first && first.status;
      return el(
        "span",
        { style: { position: "relative", display: "inline-flex", width: size, height: size } },
        el(
          "svg",
          {
            width: size,
            height: size,
            viewBox: "0 0 16 16",
            fill: "none",
            "aria-hidden": true,
          },
          el("rect", {
            x: 1.6,
            y: 2.4,
            width: 12.8,
            height: 3.2,
            rx: 1.2,
            stroke: "currentColor",
            strokeWidth: 1.3,
          }),
          el("rect", {
            x: 1.6,
            y: 8.2,
            width: 12.8,
            height: 3.2,
            rx: 1.2,
            stroke: "currentColor",
            strokeWidth: 1.3,
          }),
        ),
        el("span", {
          style: {
            position: "absolute",
            right: 0,
            bottom: 0,
            width: 6,
            height: 6,
            borderRadius: 999,
            background: statusColor(status),
          },
        }),
      );
    }

    /* ---------------- 面板 ---------------- */
    function LogView(props) {
      const { taskId, t } = props;
      const [lines, setLines] = React.useState(null);
      const [error, setError] = React.useState(null);

      const load = React.useCallback(async () => {
        try {
          const data = await call("/logs?taskId=" + encodeURIComponent(taskId) + "&tail=200");
          setLines(data.lines || []);
          setError(null);
        } catch (err) {
          setError(err);
        }
      }, [taskId]);

      React.useEffect(() => {
        load();
        const timer = setInterval(load, 3000);
        return () => clearInterval(timer);
      }, [load]);

      return el(
        "div",
        { className: "dqt-log" },
        el(
          "pre",
          null,
          error
            ? String(error.message || error)
            : lines && lines.length
              ? lines.join("\n")
              : t("logEmpty"),
        ),
      );
    }

    function TaskCard(props) {
      const { task, t, busy, onAction, onOpen } = props;
      const [showLog, setShowLog] = React.useState(false);
      const [copied, setCopied] = React.useState(false);
      const [confirmDelete, setConfirmDelete] = React.useState(false);
      const armTimer = React.useRef(null);

      React.useEffect(() => () => clearTimeout(armTimer.current), []);
      const running = task.status === "running" || task.status === "starting";
      const health = task.health && typeof task.health === "object" ? task.health : null;
      const aiConfigured = health && Object.prototype.hasOwnProperty.call(health, "configured")
        ? Boolean(health.configured)
        : null;

      async function copyPath() {
        try {
          await navigator.clipboard.writeText(task.logPath || "");
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* 剪贴板不可用时忽略 */
        }
      }

      const children = [
        el(
          "div",
          { className: "dqt-card-head", key: "head" },
          el(Dot, { status: task.status }),
          el("span", { className: "dqt-name" }, task.label || task.id),
          el("span", { className: "dqt-badge " + task.status }, statusText(t, task.status)),
        ),
        el(
          "div",
          { className: "dqt-meta", key: "meta" },
          el("span", null, t("port") + " " + task.port),
          task.pid ? el("span", null, t("pid") + " " + task.pid) : null,
          task.uptimeMs != null
            ? el("span", null, t("uptime") + " " + formatUptime(task.uptimeMs))
            : null,
          task.lastExit
            ? el("span", null, t("lastExit") + " " + formatTime(task.lastExit.at))
            : null,
        ),
      ];

      if (task.description) {
        children.push(el("div", { className: "dqt-health", key: "desc" }, task.description));
      }

      if (aiConfigured !== null) {
        children.push(
          el(
            "div",
            { className: "dqt-health " + (aiConfigured ? "ok" : "bad"), key: "health" },
            aiConfigured
              ? t("aiConfigured") + (health.provider ? "（" + health.provider + (health.model ? " / " + health.model : "") + "）" : "")
              : t("aiMissing") + " · " + t("aiHint"),
          ),
        );
      } else if (task.healthError) {
        children.push(el("div", { className: "dqt-health", key: "herr" }, task.healthError));
      }

      if (task.error) {
        children.push(
          el("div", { className: "dqt-error", key: "err" }, task.error.message + (task.error.hint ? " · " + task.error.hint : "")),
        );
      }

      const buttons = [];
      if (!running) {
        buttons.push(
          el(
            "button",
            {
              key: "start",
              className: "dqt-btn dqt-btn-primary",
              disabled: Boolean(busy[task.id]),
              onClick: () => onAction(task.id, "start"),
            },
            busy[task.id] ? t("loading") : t("start"),
          ),
        );
      } else {
        buttons.push(
          el(
            "button",
            {
              key: "stop",
              className: "dqt-btn",
              disabled: Boolean(busy[task.id]),
              onClick: () => onAction(task.id, "stop"),
            },
            busy[task.id] ? t("loading") : t("stop"),
          ),
          el(
            "button",
            {
              key: "restart",
              className: "dqt-btn",
              disabled: Boolean(busy[task.id]),
              onClick: () => onAction(task.id, "restart"),
            },
            t("restart"),
          ),
        );
      }
      if (task.url && task.status === "running") {
        buttons.push(
          el("button", { key: "open", className: "dqt-btn dqt-btn-ghost", onClick: () => onOpen(task.url) }, t("open")),
        );
      }
      buttons.push(
        el("button", { key: "logs", className: "dqt-btn dqt-btn-ghost", onClick: () => setShowLog((value) => !value) }, showLog ? t("hideLogs") : t("logs")),
      );
      buttons.push(
        el("button", { key: "copy", className: "dqt-btn dqt-btn-ghost", onClick: copyPath }, copied ? t("copied") : t("copyPath")),
      );
      buttons.push(
        el(
          "button",
          {
            key: "delete",
            className: "dqt-btn " + (confirmDelete ? "dqt-btn-danger" : "dqt-btn-ghost dqt-btn-danger-ghost"),
            title: t("deleteHint"),
            disabled: Boolean(busy[task.id]),
            onClick: () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                armTimer.current = setTimeout(() => setConfirmDelete(false), 8000);
                return;
              }
              clearTimeout(armTimer.current);
              setConfirmDelete(false);
              onAction(task.id, "delete");
            },
          },
          confirmDelete ? t("deleteConfirm") : t("delete"),
        ),
      );

      children.push(el("div", { className: "dqt-actions", key: "actions" }, buttons));
      if (showLog) children.push(el(LogView, { key: "log", taskId: task.id, t }));

      return el("section", { className: "dqt-card" }, children);
    }

    function Panel(props) {
      const { t, onAddViaChat } = props;
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot);
      const [busy, setBusy] = React.useState({});
      const [actionError, setActionError] = React.useState(null);

      React.useEffect(() => {
        refresh();
        const timer = setInterval(refresh, POLL_MS);
        const onVisibility = () => {
          if (document.visibilityState === "visible") refresh();
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
          clearInterval(timer);
          document.removeEventListener("visibilitychange", onVisibility);
        };
      }, []);

      async function onAction(taskId, action) {
        setBusy((value) => Object.assign({}, value, { [taskId]: true }));
        setActionError(null);
        try {
          await call("/" + action, { taskId });
        } catch (error) {
          // 宿主未重启时 /delete 路由还不存在，会拿到一个没有 JSON 体的 404/401
          if (
            action === "delete" &&
            error.code !== "unknown-task" &&
            (!error.status || error.status === 404 || error.status === 401)
          ) {
            const failure = new Error(t("deleteNeedsRestart"));
            failure.hint = t("deleteHint");
            setActionError(failure);
          } else {
            setActionError(error);
          }
        } finally {
          setBusy((value) => {
            const next = Object.assign({}, value);
            delete next[taskId];
            return next;
          });
          await refresh();
        }
      }

      function onOpen(url) {
        try {
          window.open(url, "_blank", "noopener,noreferrer");
        } catch {
          /* 弹窗被拦截时忽略 */
        }
      }

      async function handleAddViaChat() {
        setActionError(null);
        try {
          await onAddViaChat();
        } catch (error) {
          setActionError(error);
        }
      }

      const tasks = snapshot.tasks || [];
      const body = [];
      if (actionError) {
        body.push(
          el(
            "div",
            { className: "dqt-error", key: "aerr" },
            t("failed") + "：" + (actionError.message || String(actionError)) + (actionError.hint ? " · " + actionError.hint : ""),
          ),
        );
      }
      if (!tasks.length) {
        body.push(el("div", { className: "dqt-empty", key: "empty" }, snapshot.loading ? t("loading") : t("empty")));
      } else {
        for (const task of tasks) {
          body.push(
            el(TaskCard, { key: task.id, task, t, busy, onAction, onOpen }),
          );
        }
      }

      return el(
        "div",
        { className: "dqt-page" },
        el(
          "header",
          { className: "dqt-head" },
          el(
            "div",
            null,
            el("h1", { className: "dqt-title" }, t("title")),
            el("p", { className: "dqt-sub" }, t("subtitle")),
          ),
          el(
            "div",
            { className: "dqt-head-actions" },
            el(
              "button",
              { className: "dqt-btn", onClick: handleAddViaChat, title: t("addViaChatHint") },
              t("addViaChat"),
            ),
            el("button", { className: "dqt-btn dqt-btn-ghost", onClick: () => refresh(), title: t("refresh") }, t("refresh")),
          ),
        ),
        el("div", { className: "dqt-scroll" }, body),
      );
    }

    /* ---------------- 注册 ---------------- */
    function apply(ctx) {
      if (!document.getElementById("dqt-style")) {
        const style = document.createElement("style");
        style.id = "dqt-style";
        style.textContent = STYLE;
        document.head.appendChild(style);
      }

      const t = tFactory(ctx);
      try {
        ctx.locale.register(NS, DICT);
      } catch {
        /* 重复注册或 locale 服务不可用时退回内置字典 */
      }

      refresh();
      const timer = setInterval(refresh, POLL_MS);
      ctx.effect(() => () => clearInterval(timer), "quick-tasks:poll");

      function addViaChat() {
        const workspace = ctx.uiWorkspace;
        if (!workspace || typeof workspace.startSession !== "function") {
          return Promise.reject(new Error(t("addViaChatFailed")));
        }
        try {
          return Promise.resolve(
            workspace.startSession(void 0, {
              prompt: ADD_SERVICE_DRAFT,
              whenDraftExists: "append",
            }),
          );
        } catch (error) {
          return Promise.reject(error);
        }
      }

      ctx.slots.inject("sidebar.panellist", () =>
        ctx.slots.register(
          {
            name: "sidebar.panellist",
            id: PANEL_ID,
            order: 20,
            locale: NS,
            label: () => t("title"),
          },
          SidebarIcon,
        ),
      );

      ctx.slots.inject("main", () =>
        ctx.slots.register(
          {
            name: "main",
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ t, onAddViaChat: addViaChat }),
          },
          Panel,
        ),
      );
    }

    return {
      name: "dsh-quick-tasks",
      inject: ["slots", "locale", "uiWorkspace"],
      apply,
    };
  },
});
