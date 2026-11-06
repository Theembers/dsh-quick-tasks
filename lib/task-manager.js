import { execFileSync, spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { connect } from "node:net";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

import { removeTaskFromPatchFile } from "./patch-file.js";

const DSH_HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
export const STATE_DIR = join(DSH_HOME, "dsh-quick-tasks");
export const STATE_FILE = join(STATE_DIR, "state.json");
export const BACKUP_DIR = join(STATE_DIR, "backups");
const MAX_LOG_BYTES = 64 * 1024 * 1024;
const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/** 任务清单所在的 patch 文件（可用环境变量指向测试副本）。 */
export const PKG_PATCH_FILE =
  process.env.DSH_QUICK_TASKS_PATCH_FILE || join(PKG_ROOT, "cordis.patch.yml");

export class HttpError extends Error {
  constructor(status, code, message, hint) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

export function defaultNodePath() {
  const candidates = [
    process.env.DSH_QUICK_TASKS_NODE,
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return "node";
}

const ZIWEI_CWD = join(homedir(), ".dsh-space", "ziwei", "ziwei-doushu");

export const DEFAULT_TASKS = [
  {
    id: "ziwei",
    label: "紫微斗数服务",
    description: "本地排盘与 AI 解读服务",
    mode: "attached",
    cwd: ZIWEI_CWD,
    node: defaultNodePath(),
    argv: ["node_modules/.bin/next", "dev", "--port", "3100"],
    port: 3100,
    url: "http://127.0.0.1:3100",
    healthPath: "/api/interpret",
    readyTimeoutMs: 120000,
    stopTimeoutMs: 5000,
    logPath: join(STATE_DIR, "logs", "ziwei.log"),
  },
];

function expandHome(value) {
  if (typeof value !== "string" || !value) return value;
  if (value === "~") return homedir();
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

export function normalizeTasks(configured) {
  // configured 未提供时才退回内置默认任务；一旦配置里给出了列表，就以配置为准，
  // 这样在面板里删除任务后任务不会因为内置默认值而复活。
  // DEFAULT_TASKS 仍然作为「同 id 任务的字段模板」参与补全。
  const source =
    configured === undefined
      ? DEFAULT_TASKS.map((task) => ({ ...task, argv: [...task.argv] }))
      : Array.isArray(configured)
        ? configured
        : [];
  const templates = new Map(
    DEFAULT_TASKS.map((task) => [task.id, { ...task, argv: [...task.argv] }]),
  );
  const byId = new Map();
  for (const raw of source) {
    if (!raw || typeof raw !== "object" || !raw.id) continue;
    const id = String(raw.id);
    const base = byId.get(id) || {};
    byId.set(id, {
      ...base,
      ...raw,
      id,
      argv: Array.isArray(raw.argv) ? raw.argv.map(String) : base.argv ? [...base.argv] : [],
    });
  }
  return [...byId.values()].map((task) => {
    const port = Number(task.port) || 3100;
    const argv =
      task.argv && task.argv.length
        ? task.argv.map(String)
        : ["node_modules/.bin/next", "dev", "--port", String(port)];
    return {
      ...task,
      id: String(task.id),
      label: task.label || String(task.id),
      description: task.description || "",
      mode: task.mode === "detached" ? "detached" : "attached",
      cwd: expandHome(task.cwd || ""),
      node: expandHome(task.node || defaultNodePath()),
      argv,
      port,
      url: task.url || `http://127.0.0.1:${port}`,
      healthPath: task.healthPath === undefined ? "/" : String(task.healthPath),
      logPath: expandHome(task.logPath || join(STATE_DIR, "logs", `${task.id}.log`)),
      readyTimeoutMs: Number(task.readyTimeoutMs) || 120000,
      stopTimeoutMs: Number(task.stopTimeoutMs) || 5000,
    };
  });
}

function loadState() {
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, "utf8"));
    if (parsed && parsed.version === 1 && parsed.tasks && typeof parsed.tasks === "object") {
      return parsed;
    }
  } catch {
    /* 首次运行或状态文件损坏 */
  }
  return { version: 1, tasks: {} };
}

function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, STATE_FILE);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

function cmdlineOf(pid) {
  try {
    return execFileSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      timeout: 2000,
    }).trim();
  } catch {
    return "";
  }
}

function killTree(pid, signal) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, signal);
    return;
  } catch {
    /* 不是进程组长时退回单进程 */
  }
  try {
    process.kill(pid, signal);
  } catch {
    /* 已经退出 */
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function portOpen(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(300, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function fetchHealth(task) {
  if (!task.healthPath) return { ok: true, body: null };
  let url;
  try {
    url = new URL(task.healthPath, task.url).toString();
  } catch {
    return { ok: false, error: "bad-health-url" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      redirect: "manual",
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, error: error && error.name ? error.name : "health-error" };
  } finally {
    clearTimeout(timer);
  }
}

function buildEnv() {
  const keep = ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "SHELL", "USER", "LOGNAME", "TERM"];
  const env = {};
  for (const key of keep) {
    if (process.env[key]) env[key] = process.env[key];
  }
  env.PATH = ["/opt/homebrew/bin", "/usr/local/bin", env.PATH].filter(Boolean).join(":");
  return env;
}

function resolveCommand(task) {
  const first = task.argv && task.argv[0];
  if (!first) return "";
  return isAbsolute(first) ? first : join(task.cwd, first);
}

function ensureLogDir(task) {
  mkdirSync(dirname(task.logPath), { recursive: true });
}

function rotateLog(logPath) {
  try {
    const stat = statSync(logPath);
    if (stat.size < MAX_LOG_BYTES) return;
    try {
      renameSync(logPath, `${logPath}.1`);
    } catch {
      /* 目标存在时忽略 */
    }
    writeFileSync(logPath, "");
  } catch {
    /* 日志尚不存在 */
  }
}

function readTail(file, maxBytes = 65536) {
  try {
    const fd = openSync(file, "r");
    try {
      const size = fstatSync(fd).size;
      if (size <= 0) return "";
      const start = Math.max(0, size - maxBytes);
      const length = size - start;
      const buffer = Buffer.alloc(length);
      readSync(fd, buffer, 0, length, start);
      let text = buffer.toString("utf8");
      if (start > 0) {
        const newline = text.indexOf("\n");
        if (newline >= 0) text = text.slice(newline + 1);
      }
      return text;
    } finally {
      closeSync(fd);
    }
  } catch {
    return "";
  }
}

const managers = new Set();
let exitHookInstalled = false;

function installExitHook() {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const manager of managers) {
      try {
        manager.killAllSync();
      } catch {
        /* 退出路径上不再抛错 */
      }
    }
  });
}

export class TaskManager {
  #tasks;
  #state;
  #queues;

  constructor(tasks) {
    this.#tasks = tasks;
    this.#state = loadState();
    this.#queues = new Map();
    this.#adopt();
    managers.add(this);
    installExitHook();
  }

  get tasks() {
    return this.#tasks;
  }

  #task(id) {
    const task = this.#tasks.find((item) => item.id === id);
    if (!task) throw new HttpError(404, "unknown-task", `未知任务：${id}`, "检查插件的 tasks 配置");
    return task;
  }

  #looksLike(task, pid) {
    const line = cmdlineOf(pid);
    if (!line) return false;
    const command = resolveCommand(task);
    const commandHit = line.includes("next") || (command && line.includes(command));
    const portHit = line.includes(String(task.port));
    return Boolean(commandHit && portHit);
  }

  #adopt() {
    let changed = false;
    for (const task of this.#tasks) {
      const record = this.#state.tasks[task.id];
      if (!record || !record.pid) continue;
      if (pidAlive(record.pid) && this.#looksLike(task, record.pid)) continue;
      this.#state.tasks[task.id] = {
        ...record,
        pid: null,
        lastExit: record.lastExit || { code: null, signal: "unknown", at: Date.now() },
      };
      changed = true;
    }
    if (changed) {
      try {
        saveState(this.#state);
      } catch {
        /* 只读场景下忽略 */
      }
    }
  }

  #enqueue(id, fn) {
    const previous = this.#queues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    this.#queues.set(id, next);
    next
      .catch(() => {})
      .finally(() => {
        if (this.#queues.get(id) === next) this.#queues.delete(id);
      });
    return next;
  }

  start(id) {
    return this.#enqueue(id, () => this.#start(id));
  }

  stop(id) {
    return this.#enqueue(id, () => this.#stop(id));
  }

  restart(id) {
    return this.#enqueue(id, async () => {
      try {
        await this.#stop(id);
      } catch (error) {
        if (error instanceof HttpError && error.code === "foreign") throw error;
        /* 未运行时直接继续启动 */
      }
      return this.#start(id);
    });
  }

  /** 删除任务：先改配置文件，再停进程，最后从内存里摘掉。 */
  remove(id) {
    return this.#enqueue(id, () => this.#remove(id));
  }

  async #remove(id) {
    const task = this.#task(id);
    const patch = removeTaskFromPatchFile(PKG_PATCH_FILE, id, { backupDir: BACKUP_DIR });
    if (!patch.changed) {
      throw new HttpError(
        500,
        "patch-edit-failed",
        `无法从配置文件删除任务：${id}`,
        patch.reason === "task-not-in-file"
          ? "该任务不在 cordis.patch.yml 的 tasks 列表里，请手动编辑配置文件"
          : "检查 cordis.patch.yml 是否存在且可写",
      );
    }

    const record = this.#state.tasks[id];
    let stop = "not-running";
    if (record && record.pid && pidAlive(record.pid)) {
      try {
        await this.#stop(id);
        stop = "stopped";
      } catch {
        stop = "stop-failed";
      }
    } else if (await portOpen(task.port)) {
      stop = "foreign-kept";
    }

    this.#tasks = this.#tasks.filter((item) => item.id !== id);
    delete this.#state.tasks[id];
    try {
      saveState(this.#state);
    } catch {
      /* 忽略写盘失败 */
    }

    return { ok: true, status: "removed", id, label: task.label, stop, patch };
  }

  async #start(id) {
    const task = this.#task(id);
    const existing = this.#state.tasks[id];
    if (existing && existing.pid && pidAlive(existing.pid)) {
      return { ok: true, status: "running", pid: existing.pid };
    }
    if (await portOpen(task.port)) {
      const health = await fetchHealth(task);
      if (health.ok) {
        return {
          ok: true,
          status: "foreign",
          message: `端口 ${task.port} 上已有外部实例在运行，插件不会重复启动`,
        };
      }
      throw new HttpError(
        409,
        "port-conflict",
        `端口 ${task.port} 已被占用`,
        "先停止占用该端口的进程，或在 cordis.patch.yml 里换一个端口",
      );
    }
    const node = task.node;
    if (!existsSync(node)) {
      throw new HttpError(
        500,
        "node-missing",
        "找不到 Node.js 可执行文件",
        "在 cordis.patch.yml 的 tasks[].node 里指定绝对路径，例如 /opt/homebrew/bin/node",
      );
    }
    const command = resolveCommand(task);
    if (!existsSync(command)) {
      throw new HttpError(
        500,
        "command-missing",
        "找不到启动程序",
        `检查 tasks[].cwd 与 argv：${command}`,
      );
    }
    ensureLogDir(task);
    rotateLog(task.logPath);
    const fd = openSync(task.logPath, "a");
    let child;
    try {
      child = spawn(node, [command, ...task.argv.slice(1)], {
        cwd: task.cwd,
        detached: true,
        stdio: ["ignore", fd, fd],
        env: buildEnv(),
      });
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
    } catch (error) {
      closeSync(fd);
      const detail = error && (error.code || error.message) ? String(error.code || error.message) : "unknown";
      throw new HttpError(500, "spawn-failed", `启动失败：${detail}`, "查看插件日志与任务配置");
    }
    closeSync(fd);
    child.unref();

    const record = {
      pid: child.pid,
      startedAt: Date.now(),
      instanceId: randomUUID(),
      cwd: task.cwd,
      argv: [command, ...task.argv.slice(1)],
      node,
      port: task.port,
      logPath: task.logPath,
      lastExit: null,
    };
    child.once("exit", (code, signal) => {
      const current = this.#state.tasks[id];
      if (current && current.instanceId === record.instanceId) {
        current.pid = null;
        current.lastExit = { code: code ?? null, signal: signal ?? null, at: Date.now() };
        try {
          saveState(this.#state);
        } catch {
          /* 忽略写盘失败 */
        }
      }
    });
    this.#state.tasks[id] = record;
    saveState(this.#state);
    return { ok: true, status: "starting", pid: record.pid };
  }

  async #stop(id) {
    const task = this.#task(id);
    const record = this.#state.tasks[id];
    if (!record || !record.pid) {
      if (await portOpen(task.port)) {
        throw new HttpError(
          409,
          "foreign",
          "端口上的服务不是本插件启动的",
          "请手动停止该进程；或等它退出后再由插件接管",
        );
      }
      return { ok: true, status: "stopped" };
    }
    const pid = record.pid;
    if (!pidAlive(pid)) {
      this.#clearPid(id, "exited");
      return { ok: true, status: "stopped" };
    }
    killTree(pid, "SIGTERM");
    const deadline = Date.now() + task.stopTimeoutMs;
    while (pidAlive(pid) && Date.now() < deadline) await sleep(100);
    let forced = false;
    if (pidAlive(pid)) {
      forced = true;
      killTree(pid, "SIGKILL");
      const hardDeadline = Date.now() + 1000;
      while (pidAlive(pid) && Date.now() < hardDeadline) await sleep(50);
    }
    const stillAlive = pidAlive(pid);
    this.#clearPid(id, forced ? "SIGKILL" : "SIGTERM");
    if (stillAlive) {
      throw new HttpError(500, "stop-failed", "进程未能在超时内退出", `请手动结束 PID ${pid}`);
    }
    return { ok: true, status: "stopped", forced };
  }

  #clearPid(id, signal) {
    const record = this.#state.tasks[id];
    if (!record) return;
    this.#state.tasks[id] = {
      ...record,
      pid: null,
      lastExit: { code: null, signal, at: Date.now() },
    };
    try {
      saveState(this.#state);
    } catch {
      /* 忽略写盘失败 */
    }
  }

  async snapshot() {
    const tasks = [];
    for (const task of this.#tasks) tasks.push(await this.#describe(task));
    return { ok: true, now: Date.now(), tasks };
  }

  async #describe(task) {
    const record = this.#state.tasks[task.id] || {};
    const now = Date.now();
    const alive = record.pid ? pidAlive(record.pid) : false;
    const open = await portOpen(task.port);
    const health = open ? await fetchHealth(task) : { ok: false, error: "port-closed" };
    let status = "stopped";
    if (alive && health.ok) status = "running";
    else if (alive) status = now - (record.startedAt || now) < task.readyTimeoutMs ? "starting" : "unhealthy";
    else if (open) status = health.ok ? "foreign" : "port-conflict";
    const output = {
      id: task.id,
      label: task.label,
      description: task.description,
      mode: task.mode,
      port: task.port,
      url: task.url,
      status,
      pid: alive ? record.pid : null,
      startedAt: record.startedAt || null,
      uptimeMs: alive && record.startedAt ? now - record.startedAt : null,
      health: health.ok ? health.body || true : null,
      healthError: health.ok ? null : health.error || null,
      lastExit: record.lastExit || null,
      logPath: task.logPath,
      error: null,
    };
    if (status === "port-conflict") {
      output.error = {
        code: "port-conflict",
        message: `端口 ${task.port} 被占用，且健康检查未通过`,
        hint: "可能是其它程序占用了端口，先确认占用进程",
      };
    } else if (status === "unhealthy") {
      output.error = {
        code: "unhealthy",
        message: `进程在运行，但 ${task.healthPath} 健康检查未通过`,
        hint: "查看日志，确认 Next.js 是否编译失败或端口被改",
      };
    }
    return output;
  }

  logs(id, count = 200) {
    const task = this.#task(id);
    const text = readTail(task.logPath);
    const lines = text.split(/\r?\n/);
    const limit = Math.max(1, Math.min(2000, Number(count) || 200));
    return { ok: true, taskId: task.id, logPath: task.logPath, lines: lines.slice(-limit) };
  }

  killAllSync() {
    for (const task of this.#tasks) {
      if (task.mode === "detached") continue;
      const record = this.#state.tasks[task.id];
      if (record && record.pid && pidAlive(record.pid)) killTree(record.pid, "SIGKILL");
    }
  }
}
