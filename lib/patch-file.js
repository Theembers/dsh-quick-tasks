/**
 * cordis.patch.yml 的行级编辑器。
 *
 * 只做「删除 tasks 列表里的某个任务项」这一件事：
 *   - 定位 tasks: 键
 *   - 定位该键下 "- id: <taskId>" 列表项，删除它及其所有子行
 *   - 若该列表已没有其它任务项，则把 tasks: 改写成 tasks: []
 *
 * 采用行级编辑而不是引入 YAML 依赖，原因：
 *   - 插件自身不带运行时依赖，宿主进程里也不保证能解析到 yaml/js-yaml；
 *   - 只改一行列表项，其它内容（注释、字段顺序）完全保留。
 */
import { copyFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function indentOf(line) {
  const match = /^[ \t]*/.exec(line || "");
  return match ? match[0].length : 0;
}

function isBlank(line) {
  return !line || !line.trim();
}

function isComment(line) {
  return /^[ \t]*#/.test(line || "");
}

/**
 * @param {string} file      cordis.patch.yml 绝对路径
 * @param {string} taskId    要删除的任务 id
 * @param {{backupDir?: string}} options
 * @returns {{changed: boolean, reason?: string, backup?: string|null, file: string, removedLines?: number}}
 */
export function removeTaskFromPatchFile(file, taskId, options = {}) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    return {
      changed: false,
      file,
      reason: "patch-unreadable",
      detail: String((error && error.code) || error),
    };
  }

  const lines = text.split("\n");
  const itemPattern = new RegExp(`^[ \\t]*-[ \\t]+id:[ \\t]*["']?${escapeRegExp(taskId)}["']?[ \\t]*$`);
  let itemIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (itemPattern.test(lines[i])) {
      itemIndex = i;
      break;
    }
  }
  if (itemIndex === -1) {
    return { changed: false, file, reason: "task-not-in-file" };
  }

  // 向上找所属的 tasks: 键：跳过空行、注释以及同级列表项及其子行，
  // 直到遇到缩进小于该列表项的行（说明已经跳出这个列表）
  const itemIndent = indentOf(lines[itemIndex]);
  let tasksIndex = -1;
  for (let i = itemIndex - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (isBlank(line) || isComment(line)) continue;
    if (/^[ \t]*tasks:[ \t]*$/.test(line)) {
      tasksIndex = i;
      break;
    }
    if (indentOf(line) < itemIndent) break;
  }
  if (tasksIndex === -1) {
    return { changed: false, file, reason: "not-in-tasks-list" };
  }


  // 列表项结束位置：下一个缩进 <= itemIndent 的非空行
  let itemEnd = itemIndex + 1;
  while (itemEnd < lines.length) {
    const line = lines[itemEnd];
    if (isBlank(line)) {
      itemEnd += 1;
      continue;
    }
    if (indentOf(line) <= itemIndent) break;
    itemEnd += 1;
  }
  // 末尾空行不删除
  while (itemEnd > itemIndex + 1 && isBlank(lines[itemEnd - 1])) itemEnd -= 1;

  // tasks 块的范围
  const tasksIndent = indentOf(lines[tasksIndex]);
  let blockEnd = tasksIndex + 1;
  while (blockEnd < lines.length) {
    const line = lines[blockEnd];
    if (isBlank(line)) {
      blockEnd += 1;
      continue;
    }
    if (indentOf(line) <= tasksIndent) break;
    blockEnd += 1;
  }

  // 该列表里是否还有其它任务项
  let sibling = false;
  for (let i = tasksIndex + 1; i < blockEnd; i += 1) {
    if (i >= itemIndex && i < itemEnd) continue;
    if (/^[ \t]*-[ \t]+/.test(lines[i])) {
      sibling = true;
      break;
    }
  }

  const next = lines.slice(0, itemIndex).concat(lines.slice(itemEnd));
  if (!sibling) {
    next[tasksIndex] = `${" ".repeat(tasksIndent)}tasks: []`;
  }
  const output = next.join("\n");

  let backup = null;
  if (options.backupDir) {
    try {
      mkdirSync(options.backupDir, { recursive: true });
      backup = join(options.backupDir, `cordis.patch.${Date.now()}.yml`);
      copyFileSync(file, backup);
    } catch {
      backup = null;
    }
  }

  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, output);
  renameSync(tmp, file);

  return { changed: true, file, backup, removedLines: itemEnd - itemIndex };
}
