import { HttpError, TaskManager, normalizeTasks } from "./task-manager.js";

export const name = "dsh-quick-tasks";
export const inject = ["webServer"];

const API = "/api/dsh-quick-tasks";

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function readJsonBody(request, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new HttpError(413, "body-too-large", "请求体过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        const value = JSON.parse(text);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new Error("not-an-object");
        }
        resolve(value);
      } catch {
        reject(new HttpError(400, "bad-json", "请求体必须是 JSON 对象"));
      }
    });
    request.on("error", (error) => reject(error));
  });
}

function isTrustedAction(request) {
  const headers = request.headers || {};
  const remote = (request.socket && request.socket.remoteAddress) || "";
  const loopback = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
  if (!loopback) return false;
  if (headers["x-dsh-quick-tasks"] !== "1") return false;
  const site = headers["sec-fetch-site"];
  if (site && site !== "same-origin") return false;
  const host = headers.host;
  if (!host) return false;
  const origin = headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * 宿主侧 Cordis 插件入口。
 * 路由：
 *   GET  /api/dsh-quick-tasks/state
 *   GET  /api/dsh-quick-tasks/logs?taskId=ziwei&tail=200
 *   POST /api/dsh-quick-tasks/start    {taskId}
 *   POST /api/dsh-quick-tasks/stop     {taskId}
 *   POST /api/dsh-quick-tasks/restart  {taskId}
 *   POST /api/dsh-quick-tasks/delete   {taskId}
 */
export function apply(ctx, config = {}) {
  const tasks = normalizeTasks(config && config.tasks);
  const manager = new TaskManager(tasks);
  const log = (level, message) => {
    try {
      const logger = ctx.logger;
      if (logger && typeof logger[level] === "function") logger[level](`[dsh-quick-tasks] ${message}`);
    } catch {
      /* 日志失败不影响主流程 */
    }
  };
  log("info", `已加载，任务：${tasks.map((task) => task.id).join(", ")}`);

  const handle = (fn) => async (request, response) => {
    try {
      await fn(request, response);
    } catch (error) {
      if (error instanceof HttpError) {
        sendJson(response, error.status, {
          ok: false,
          error: { code: error.code, message: error.message, hint: error.hint || undefined },
        });
        return;
      }
      log("warn", String((error && error.stack) || error));
      sendJson(response, 500, {
        ok: false,
        error: { code: "internal", message: "插件内部错误" },
      });
    }
  };

  const route = (suffix, handler) =>
    ctx.effect(
      () => ctx.webServer.register({ kind: "exact", path: API + suffix, handler }),
      `dsh-quick-tasks:${suffix}`,
    );

  route(
    "/state",
    handle(async (request, response) => {
      if (request.method !== "GET" && request.method !== "HEAD") {
        throw new HttpError(405, "method-not-allowed", "仅支持 GET");
      }
      sendJson(response, 200, await manager.snapshot());
    }),
  );

  route(
    "/logs",
    handle(async (request, response) => {
      if (request.method !== "GET") throw new HttpError(405, "method-not-allowed", "仅支持 GET");
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const taskId = url.searchParams.get("taskId") || manager.tasks[0]?.id;
      const tail = url.searchParams.get("tail") || "200";
      if (!taskId) throw new HttpError(404, "unknown-task", "没有可查询的任务");
      sendJson(response, 200, manager.logs(taskId, tail));
    }),
  );

  const mutate = (action) =>
    handle(async (request, response) => {
      if (request.method !== "POST") throw new HttpError(405, "method-not-allowed", "仅支持 POST");
      if (!isTrustedAction(request)) {
        throw new HttpError(403, "forbidden", "请求未通过同源校验", "请从 DSH 页面内操作");
      }
      const body = await readJsonBody(request);
      const taskId = body.taskId ? String(body.taskId) : "";
      if (!taskId) throw new HttpError(400, "bad-request", "缺少 taskId");
      if (!manager.tasks.some((task) => task.id === taskId)) {
        throw new HttpError(404, "unknown-task", `未知任务：${taskId}`);
      }
      sendJson(response, 200, await manager[action](taskId));
    });

  route("/start", mutate("start"));
  route("/stop", mutate("stop"));
  route("/restart", mutate("restart"));
  route("/delete", mutate("remove"));

  log("info", `REST 路由已注册：${API}/*`);
}
