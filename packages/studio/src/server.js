#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { MAX_PARALLEL_AGENTS } from "./parallel.js";
import {
  SessionManager,
  createOpenAIClientFactory,
  resolveCurrentSettings,
  getDefaultContextWindow,
  readSettings,
  writeSettings,
} from "@vegamo/deepcode-core";

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const softwareRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const IGNORED = new Set(["node_modules", ".git", "dist", "coverage", ".DS_Store"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function parseArgs(argv) {
  const out = { port: Number(process.env.PORT) || 3927, root: process.cwd() };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--port") out.port = Number(argv[++i]);
    else if (argv[i] === "--root") out.root = path.resolve(argv[++i] ?? "");
  }
  if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) {
    throw new Error("无效的端口");
  }
  return out;
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function workspaceRoots() {
  const root = shownRoot();
  const roots = [path.resolve(root)];
  const extras = resolveCurrentSettings(root).permissions?.addWorkingDirs ?? [];
  for (const dir of extras) {
    const abs = path.resolve(root, dir);
    if (!roots.includes(abs)) roots.push(abs);
  }
  return roots;
}

function currentWorkspaces() {
  return { cwd: path.resolve(shownRoot()), directories: workspaceRoots() };
}

function resolveWorkspacePath(candidate) {
  const root = shownRoot();
  const raw = String(candidate ?? "").trim();
  const abs = !raw || raw === "." ? path.resolve(root) : path.resolve(raw);
  const allowed = workspaceRoots().some((item) => abs === item || abs.startsWith(`${item}${path.sep}`));
  if (!allowed) throw httpError(400, "路径不在已选工作目录中");
  return abs;
}

function displayPath(abs) {
  const rel = path.relative(shownRoot(), abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return abs;
  return rel.split(path.sep).join("/");
}

function setWorkspaces(cwdInput, directoriesInput) {
  if (hasRunningWork()) throw httpError(409, "还有智能体在执行，请先停止");
  viewRoot = "";
  const directories = [];
  for (const item of directoriesInput ?? []) {
    const abs = path.resolve(String(item ?? ""));
    if (!directories.includes(abs)) directories.push(abs);
  }
  if (directories.length === 0) throw httpError(400, "至少选择一个工作目录");
  for (const dir of directories) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw httpError(400, `目录不存在: ${dir}`);
  }
  const cwd = path.resolve(String(cwdInput ?? ""));
  if (!directories.includes(cwd)) throw httpError(400, "请把其中一个目录设为当前工作目录");
  const current = readSettings() ?? {};
  const previous = current.permissions ?? {};
  writeSettings({
    ...current,
    permissions: {
      ...previous,
      addWorkingDirs: directories.filter((dir) => dir !== cwd),
    },
  });
  if (cwd !== path.resolve(projectRoot)) createManager(cwd);
}

function clip(value, max = 20000) {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…（已截断）`;
}

function shouldSend(message) {
  if (!message || message.role === "system") return false;
  if (message.role === "user" && String(message.content ?? "").trim() === "/continue") return false;
  if (message.visible === false) return false;
  return message.role === "user" || message.role === "assistant" || message.role === "tool";
}

const planCache = new Map();

function extractPlan(message) {
  const params = message?.messageParams && typeof message.messageParams === "object" ? message.messageParams : {};
  const calls = Array.isArray(params.tool_calls) ? params.tool_calls : [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    const call = calls[index];
    if (call?.function?.name !== "UpdatePlan" || typeof call.function.arguments !== "string") continue;
    try {
      const parsed = JSON.parse(call.function.arguments);
      if (typeof parsed.plan === "string" && parsed.plan.trim()) return parsed.plan;
    } catch {
      // A partial tool call is not a plan yet.
    }
  }
  return "";
}

function rememberPlan(message) {
  const sessionId = message?.sessionId;
  const plan = extractPlan(message);
  if (sessionId && plan) planCache.set(sessionId, plan);
}

function sessionPlan(sessionId) {
  if (!sessionId || !manager?.getSession(sessionId)) return "";
  if (planCache.has(sessionId)) return planCache.get(sessionId);
  let plan = "";
  try {
    const messages = manager.listSessionMessages(sessionId);
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      plan = extractPlan(messages[index]);
      if (plan) break;
    }
  } catch {
    plan = "";
  }
  planCache.set(sessionId, plan);
  return plan;
}

function slimMessage(message) {
  const params = message.messageParams && typeof message.messageParams === "object" ? message.messageParams : {};
  const toolCalls = Array.isArray(params.tool_calls)
    ? params.tool_calls.map((call) => ({
        id: typeof call?.id === "string" ? call.id : "",
        name: typeof call?.function?.name === "string" ? call.function.name : "",
        arguments: clip(typeof call?.function?.arguments === "string" ? call.function.arguments : "", 4000),
      }))
    : [];
  const fn = message.meta?.function;
  const plan = extractPlan(message);
  return {
    id: message.id,
    sessionId: message.sessionId ?? "",
    role: message.role,
    content: clip(message.content ?? ""),
    reasoning: clip(typeof params.reasoning_content === "string" ? params.reasoning_content : ""),
    toolCalls,
    ...(plan ? { plan } : {}),
    toolName: fn && typeof fn === "object" && typeof fn.name === "string" ? fn.name : "",
    paramsMd: clip(message.meta?.paramsMd ?? "", 4000),
    resultMd: clip(message.meta?.resultMd ?? message.content ?? "", 8000),
    ...fileEditFields(message),
    createTime: message.createTime,
  };
}

function fileEditFields(message) {
  const fn = message.meta?.function;
  const name = fn && typeof fn === "object" && typeof fn.name === "string" ? fn.name : "";
  if (name !== "write" && name !== "edit") return {};
  if (typeof message.content !== "string") return {};
  try {
    const parsed = JSON.parse(message.content);
    const meta = parsed?.metadata;
    const filePath = typeof meta?.file_path === "string" ? meta.file_path : "";
    const diff = typeof meta?.diff_preview === "string" ? meta.diff_preview : "";
    if (!filePath) return {};
    return { filePath, diff };
  } catch {
    return {};
  }
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function publicUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const completionDetails = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object" ? usage.completion_tokens_details : {};
  const promptDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object" ? usage.prompt_tokens_details : {};
  const prompt = numberOrZero(usage.prompt_tokens);
  const completion = numberOrZero(usage.completion_tokens);
  const total = numberOrZero(usage.total_tokens) || prompt + completion;
  if (!total && !prompt && !completion) return null;
  return {
    prompt,
    completion,
    total,
    cacheHit: numberOrZero(usage.prompt_cache_hit_tokens) || numberOrZero(promptDetails.cached_tokens),
    reasoning: numberOrZero(completionDetails.reasoning_tokens),
    requests: numberOrZero(usage.total_reqs),
  };
}

function publicUsagePerModel(usagePerModel) {
  if (!usagePerModel || typeof usagePerModel !== "object") return [];
  return Object.entries(usagePerModel)
    .map(([model, usage]) => {
      const next = publicUsage(usage);
      return next ? { model, ...next } : null;
    })
    .filter(Boolean);
}

function sessionModel(entry) {
  const usage = entry?.usagePerModel;
  if (!usage || typeof usage !== "object") return "";
  const names = Object.keys(usage);
  return names.length ? names[names.length - 1] : "";
}

function sessionContextWindow(entry) {
  const resolved = resolveCurrentSettings(shownRoot());
  const model = sessionModel(entry) || resolved.model;
  if (resolved.contextWindow !== getDefaultContextWindow(resolved.model)) return numberOrZero(resolved.contextWindow);
  return getDefaultContextWindow(model);
}

function slimSession(entry) {
  if (!entry) return null;
  const usagePerModel = publicUsagePerModel(entry.usagePerModel);
  const usage = publicUsage(entry.usage);
  if (usage && !usage.requests) usage.requests = usagePerModel.reduce((sum, item) => sum + item.requests, 0);
  return {
    id: entry.id,
    summary: entry.summary || "未命名对话",
    status: entry.status,
    failReason: entry.failReason,
    createTime: entry.createTime,
    updateTime: entry.updateTime,
    usage,
    usagePerModel,
    askPermissions: Array.isArray(entry.askPermissions) ? entry.askPermissions : [],
    cwd: typeof entry.cwd === "string" ? entry.cwd : "",
    model: sessionModel(entry),
    activeTokens: numberOrZero(entry.activeTokens),
    contextWindow: sessionContextWindow(entry),
  };
}

const MODEL_CHOICES = ["deepseek-flash", "deepseek-v4-flash", "deepseek-v4-pro"];
const PERMISSION_SCOPES = [
  "read-in-cwd",
  "read-in-tmp",
  "read-out-cwd",
  "write-in-cwd",
  "write-in-tmp",
  "write-out-cwd",
  "delete-in-cwd",
  "delete-out-cwd",
  "query-git-log",
  "mutate-git-log",
  "network",
  "mcp",
];
const WORK_MODES = {
  auto: {
    label: "全自动",
    hint: "读写、命令和联网都直接执行，适合长时间无人值守。",
    planMode: false,
    defaultMode: "allowAll",
    allow: PERMISSION_SCOPES,
    ask: [],
  },
  workspace: {
    label: "项目内自动",
    hint: "项目里的读写和命令直接执行。项目外改动、删除和改写 Git 历史会先问你。",
    planMode: false,
    defaultMode: "allowAll",
    allow: ["read-in-cwd", "read-in-tmp", "write-in-cwd", "write-in-tmp", "delete-in-cwd", "query-git-log", "network", "mcp"],
    ask: ["read-out-cwd", "write-out-cwd", "delete-out-cwd", "mutate-git-log"],
  },
  confirm: {
    label: "先确认",
    hint: "可以读取项目。修改、删除、联网和命令都会先等你允许。",
    planMode: false,
    defaultMode: "askAll",
    allow: ["read-in-cwd", "read-in-tmp", "query-git-log"],
    ask: [],
  },
  plan: {
    label: "只规划",
    hint: "先查清项目并给出方案。要改文件、删除或改写 Git 时会停下来等你确认。",
    planMode: true,
    defaultMode: "allowAll",
    allow: ["read-in-cwd", "read-in-tmp", "read-out-cwd", "query-git-log", "network"],
    ask: ["write-in-cwd", "write-in-tmp", "write-out-cwd", "delete-in-cwd", "delete-out-cwd", "mutate-git-log", "mcp"],
  },
};

function sameScopes(left, right) {
  const a = [...(left ?? [])].sort();
  const b = [...(right ?? [])].sort();
  return a.length === b.length && a.every((scope, index) => scope === b[index]);
}

function inferWorkMode(permissions, stored) {
  if (typeof stored === "string" && WORK_MODES[stored]) return stored;
  for (const [id, mode] of Object.entries(WORK_MODES)) {
    if (id === "plan") continue;
    if (permissions.defaultMode !== mode.defaultMode || !sameScopes(permissions.ask, mode.ask)) continue;
    if (sameScopes(permissions.allow, mode.allow)) return id;
    if (id === "auto" && (permissions.allow?.length ?? 0) === 0 && (permissions.ask?.length ?? 0) === 0) return id;
  }
  return permissions.defaultMode === "askAll" ? "confirm" : "auto";
}

function publicWorkModes() {
  return Object.entries(WORK_MODES).map(([id, mode]) => ({
    id,
    label: mode.label,
    hint: mode.hint,
    planMode: mode.planMode,
  }));
}

function publicSettings(root) {
  const resolved = resolveCurrentSettings(root);
  const stored = readSettings() ?? {};
  const key = resolved.apiKey ?? "";
  const models = MODEL_CHOICES.includes(resolved.model) ? MODEL_CHOICES : [resolved.model, ...MODEL_CHOICES];
  return {
    model: resolved.model,
    models,
    baseURL: resolved.baseURL,
    hasKey: Boolean(key),
    keyHint: key ? `••••${key.slice(-4)}` : "",
    thinkingEnabled: resolved.thinkingEnabled,
    reasoningEffort: resolved.reasoningEffort,
    contextWindow: numberOrZero(resolved.contextWindow),
    workMode: inferWorkMode(resolved.permissions, stored.workMode),
    workModes: publicWorkModes(),
  };
}

function applyWorkMode(modeId) {
  const mode = WORK_MODES[modeId];
  if (!mode) throw httpError(400, "未知的工作模式");
  const current = readSettings() ?? {};
  const previous = current.permissions ?? {};
  writeSettings({
    ...current,
    workMode: modeId,
    permissions: {
      allow: mode.allow,
      ask: mode.ask,
      deny: Array.isArray(previous.deny) ? previous.deny : [],
      defaultMode: mode.defaultMode,
      addWorkingDirs: Array.isArray(previous.addWorkingDirs) ? previous.addWorkingDirs : [],
    },
  });
}

let directoryPicker = null;

export function setDirectoryPicker(picker) {
  directoryPicker = picker;
}

function browseComputer(target) {
  const home = os.homedir();
  const requested = String(target ?? "").trim();
  const abs = requested ? path.resolve(requested) : home;
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw httpError(400, "目录不存在");
  const parent = path.dirname(abs);
  const directories = [];
  let entries = [];
  try {
    entries = fs.readdirSync(abs, { withFileTypes: true });
  } catch {
    throw httpError(400, "无法读取这个目录");
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    directories.push({ name: entry.name, path: path.join(abs, entry.name) });
    if (directories.length >= 400) break;
  }
  directories.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  return {
    path: abs,
    parent: parent === abs ? null : parent,
    directories,
    places: [
      { name: "主目录", path: home },
      { name: "桌面", path: path.join(home, "Desktop") },
      { name: "文稿", path: path.join(home, "Documents") },
      { name: "磁盘", path: "/" },
    ].filter((place) => fs.existsSync(place.path)),
  };
}
let projectRoot = "";
let viewRoot = "";
let manager = null;
let viewedSessionId = null;
let generation = 0;
let starting = 0;
const runs = new Map();
let queue = [];
const sessionServers = new Map();
const pendingCreates = new Set();
let groups = [];
const clients = new Set();

function groupsFile() {
  return path.join(os.homedir(), ".deepcode", "studio-groups.json");
}

function loadGroups() {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(groupsFile(), "utf8"));
  } catch {
    groups = [];
    return;
  }
  if (!all || typeof all !== "object" || Array.isArray(all)) all = {};
  const source = Array.isArray(all.tasks) ? all.tasks : Object.values(all).filter((value) => Array.isArray(value)).flat();
  const seen = new Set();
  groups = [];
  for (const group of source) {
    if (!group || typeof group.id !== "string" || !Array.isArray(group.agents) || seen.has(group.id)) continue;
    seen.add(group.id);
    groups.push({
      id: group.id,
      title: String(group.title || "任务").slice(0, 42),
      mainId: typeof group.mainId === "string" ? group.mainId : null,
      agents: group.agents
        .filter((agent) => agent && typeof agent === "object")
        .map((agent) => normalizeGroupAgent(agent, group.mainId)),
    });
    assignGroupMain(groups[groups.length - 1]);
  }
  groups = groups.slice(0, 80);
  if (!Array.isArray(all.tasks) && groups.length) saveGroups();
}

function pruneMissingGroupSessions() {
  if (!manager) return;
  const next = [];
  let changed = false;
  for (const group of groups) {
    const agents = group.agents.filter((agent) => agent.id && manager.getSession(agent.id));
    if (agents.length !== group.agents.length || !agents.length) changed = true;
    if (!agents.length) continue;
    group.agents = agents;
    assignGroupMain(group);
    next.push(group);
  }
  if (!changed) return;
  groups = next;
  saveGroups();
}

function saveGroups() {
  const file = groupsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ tasks: groups.slice(0, 80) }, null, 2));
}

function groupForSession(sessionId) {
  if (!sessionId) return null;
  return groups.find((group) => group.agents.some((agent) => agent.id === sessionId)) ?? null;
}

function pendingJobFor(sessionId) {
  const session = sessionId ? manager.getSession(sessionId) : null;
  if (!session) return null;
  for (const job of pendingCreates) {
    if (job.sessionId === sessionId) return job;
  }
  const summary = session.summary || "";
  for (const job of pendingCreates) {
    if (!job.sessionId && job.group && String(job.text || "").slice(0, 100) === summary) return job;
  }
  return null;
}

function taskVisibility(sessionId) {
  const group = groupForSession(sessionId);
  if (group) {
    const agent = group.agents.find((item) => item.id === sessionId);
    const role = group.mainId === sessionId || agent?.role === "main" ? "main" : "sub";
    return { group, role };
  }
  const job = pendingJobFor(sessionId);
  if (!job?.group) return null;
  return { group: job.group, role: job.role === "main" ? "main" : "sub" };
}

function messageBlocks(messages) {
  const active = messages.filter((message) => !message?.compacted);
  const blocks = [];
  for (let index = 0; index < active.length; index += 1) {
    const message = active[index];
    if (message.role === "tool") {
      blocks.push([message]);
      continue;
    }
    const block = [message];
    const calls = message.messageParams?.tool_calls;
    if (message.role === "assistant" && Array.isArray(calls) && calls.length > 0) {
      while (index + 1 < active.length && active[index + 1].role === "tool") block.push(active[++index]);
    }
    blocks.push(block);
  }
  return blocks;
}

function isPromptSystem(message) {
  return message.role === "system" && !message.meta?.isSummary && !message.meta?.skillCatalog;
}

function labelSharedBlock(block, agent) {
  const title = agent.title ? `「${String(agent.title).slice(0, 40)}」` : "";
  const prefix = `【子智能体${title}】\n`;
  return block.map((message, index) => {
    if (index > 0 || message.role === "tool") return message;
    return { ...message, content: `${prefix}${message.content || ""}` };
  });
}

function sharedMessagesFor(sessionId) {
  const visibility = taskVisibility(sessionId);
  if (!visibility || visibility.role !== "main") return undefined;
  const agents = visibility.group.agents.filter((agent) => agent.id && agent.id !== sessionId && agent.role !== "main");
  if (!agents.length) return undefined;
  const own = manager.listSessionMessages(sessionId);
  const lead = [];
  const ownTurns = [];
  const subTurns = [];
  for (const block of messageBlocks(own)) {
    if (block.every(isPromptSystem)) lead.push(...block);
    else ownTurns.push({ time: block[0].createTime || "", block });
  }
  const ownIds = new Set(own.map((message) => message.id));
  let included = 0;
  for (const agent of agents) {
    let messages = [];
    try {
      messages = manager.listSessionMessages(agent.id);
    } catch {
      messages = [];
    }
    for (const block of messageBlocks(messages)) {
      if (block.every((message) => ownIds.has(message.id) || isPromptSystem(message) || message.meta?.skillCatalog)) continue;
      subTurns.push({ time: block[0].createTime || "", block: labelSharedBlock(block, agent) });
      included += 1;
    }
  }
  if (!included) return undefined;
  subTurns.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  ownTurns.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  return [...lead, ...subTurns.flatMap((item) => item.block), ...ownTurns.flatMap((item) => item.block)];
}

function compactIdsFor(sessionId) {
  const visibility = taskVisibility(sessionId);
  if (!visibility || visibility.role !== "main") return [sessionId];
  const ids = [sessionId];
  for (const agent of visibility.group.agents) {
    if (agent.id && agent.id !== sessionId && agent.role !== "main" && !runs.has(agent.id)) ids.push(agent.id);
  }
  return ids;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntilStopped(sessionId) {
  const started = Date.now();
  while (runs.has(sessionId) && Date.now() - started < 3000) await sleep(40);
  return !runs.has(sessionId);
}

function subagentLine(agent) {
  const session = agent.id ? manager.getSession(agent.id) : null;
  const running = agent.id && runs.has(agent.id);
  const state = running ? "执行中" : session?.status || "空闲";
  return `${agent.id} · ${agent.title || "子智能体"} · ${state}`;
}

async function manageSubagent(mainId, args) {
  const session = manager.getSession(mainId);
  if (!session) return { ok: false, error: "找不到主智能体" };
  const visibility = taskVisibility(mainId);
  if (visibility?.role === "sub") return { ok: false, error: "只有主智能体可以管理子智能体" };
  const group = ensureGroup(session);
  for (const agent of group.agents) {
    if (agent.id === mainId) agent.role = "main";
  }
  group.mainId = mainId;
  saveGroups();
  const action = String(args?.action || "").trim();
  if (action === "list") {
    const lines = group.agents.filter((agent) => agent.id && agent.id !== mainId).map(subagentLine);
    return { ok: true, output: lines.length ? lines.join("\n") : "当前没有子智能体" };
  }
  if (action === "spawn") {
    const instruction = String(args?.instruction || args?.text || "").trim();
    if (!instruction) return { ok: false, error: "请写明要分出去的工作" };
    if (slotsUsed() >= MAX_PARALLEL_AGENTS) return { ok: false, error: "已经有 4 个智能体在执行，请稍后再分出子智能体" };
    const childId = manager.forkSession(mainId, { dropTrailingToolCall: true });
    const title = String(args?.title || instruction.split("\n")[0] || "子智能体").slice(0, 48);
    group.agents.push({ id: childId, title, role: "sub", instruction: instruction.slice(0, 4000) });
    saveGroups();
    const planMode = args?.planMode === true || (args?.planMode !== false && session.planMode === true);
    launchReply(childId, { text: instruction, planMode }, serverForSession(mainId));
    broadcastRuns();
    return {
      ok: true,
      output: `已分出子智能体 ${childId}（${title}）。它只保留分出时的上下文，之后看不到主智能体的新消息，也看不到其他子智能体。`,
    };
  }
  const target = String(args?.sessionId || "").trim();
  const agent = group.agents.find((item) => item.id === target && item.role !== "main" && target !== mainId);
  if (action === "stop") {
    if (!agent) return { ok: false, error: "只能停止本任务里的子智能体" };
    stopAgent(target);
    return { ok: true, output: `已停止子智能体 ${target}` };
  }
  if (action === "rerun") {
    if (!agent) return { ok: false, error: "只能重新执行本任务里的子智能体" };
    const instruction = String(args?.instruction || args?.text || agent.instruction || "").trim();
    if (!instruction) return { ok: false, error: "请写明重新执行的内容" };
    agent.instruction = instruction.slice(0, 4000);
    saveGroups();
    if (runs.has(target)) stopAgent(target);
    if (!(await waitUntilStopped(target))) return { ok: false, error: "这个子智能体还在停止，请稍后再重新执行" };
    const planMode = args?.planMode === true || args?.planMode === false ? args.planMode === true : manager.getSession(target)?.planMode === true;
    launchReply(target, { text: instruction, planMode }, serverForSession(target));
    return { ok: true, output: `已让子智能体 ${target} 按新参数重新执行` };
  }
  return { ok: false, error: "未知操作，只能是 spawn、stop、rerun 或 list" };
}

async function deliverToMain(sessionId, text, planMode) {
  const visibility = taskVisibility(sessionId);
  const mainId = visibility?.role === "sub" && visibility.group.mainId ? visibility.group.mainId : sessionId;
  const session = manager.getSession(mainId);
  if (!session) throw httpError(404, "找不到这段对话");
  if (session.status === "ask_permission" && (session.askPermissions?.length ?? 0) > 0) {
    throw httpError(409, "请先允许或拒绝当前操作");
  }
  if (session.status === "waiting_for_user") throw httpError(409, "请先选择上面的选项");
  focusTaskDirectory(session);
  viewedSessionId = mainId;
  holdMainReports = true;
  try {
    if (runs.has(mainId)) {
      stopAgent(mainId);
      if (!(await waitUntilStopped(mainId))) throw httpError(409, "主智能体还在停止，请稍后再发");
    }
  } finally {
    holdMainReports = false;
  }
  const serverId = serverForSession(mainId);
  rememberServer(mainId, serverId);
  const title = session.summary || text.slice(0, 48);
  if (slotsUsed() >= MAX_PARALLEL_AGENTS) {
    queue.push({ kind: "reply", sessionId: mainId, prompt: { text, planMode }, serverId, title });
    broadcastRuns();
  } else {
    launchReply(mainId, { text, planMode }, serverId);
  }
  return { id: mainId, title, role: "main" };
}

function taskIsRunning(ids, group) {
  for (const id of ids) {
    if (runs.has(id)) return true;
  }
  for (const job of pendingCreates) {
    if (job.sessionId && ids.has(job.sessionId)) return true;
    if (group && job.group?.id === group.id) return true;
  }
  return false;
}

function deleteHistoryTask(body) {
  const sessionId = body.sessionId ? String(body.sessionId) : "";
  const groupId = body.groupId ? String(body.groupId) : "";
  const group = groupId ? groups.find((item) => item.id === groupId) ?? null : null;
  if (groupId && !group) throw httpError(404, "找不到这条任务");
  if (!group && !sessionId) throw httpError(400, "找不到这条任务");
  if (!group && sessionId && !manager.getSession(sessionId) && !groupForSession(sessionId)) {
    throw httpError(404, "找不到这条任务");
  }
  const ids = new Set();
  if (group) {
    for (const agent of group.agents) {
      if (agent.id) ids.add(agent.id);
    }
  } else if (sessionId) {
    ids.add(sessionId);
  }
  if (taskIsRunning(ids, group)) throw httpError(409, "这个任务还在执行，请先停止");
  queue = queue.filter((job) => {
    if (job.sessionId && ids.has(job.sessionId)) return false;
    if (group && job.group?.id === group.id) return false;
    return true;
  });
  for (const id of ids) {
    sessionServers.delete(id);
    if (manager.getSession(id)) manager.deleteSession(id);
  }
  rememberDeletedSessions([...ids]);
  if (group) {
    groups = groups.filter((item) => item.id !== group.id);
  } else {
    for (const item of groups) {
      item.agents = item.agents.filter((agent) => agent.id !== sessionId);
    }
    groups = groups.filter((item) => item.agents.length > 0);
  }
  saveGroups();
  if (viewedSessionId && ids.has(viewedSessionId)) viewedSessionId = null;
  broadcastRuns();
  return statePayload();
}

function ensureGroup(session) {
  const existing = groupForSession(session.id);
  if (existing) return existing;
  const group = {
    id: crypto.randomUUID(),
    title: String(session.summary || "任务").slice(0, 42),
    mainId: session.id,
    agents: [{ id: session.id, title: String(session.summary || "智能体").slice(0, 48), role: "main", instruction: String(session.summary || "").slice(0, 4000) }],
  };
  groups.unshift(group);
  return group;
}

function normalizeGroupAgent(agent, mainId) {
  const id = agent.id ?? null;
  const role = agent.role === "sub" ? "sub" : agent.role === "main" || id === mainId ? "main" : "";
  return {
    id,
    title: String(agent.title || "智能体").slice(0, 48),
    role,
    instruction: String(agent.instruction || agent.title || "").slice(0, 4000),
  };
}

function assignGroupMain(group) {
  const explicit = group.agents.find((agent) => agent.role === "main" && agent.id);
  const fallback = group.agents.find((agent) => agent.id === group.mainId) || group.agents.find((agent) => agent.id) || group.agents[0];
  const main = explicit || fallback;
  for (const agent of group.agents) {
    agent.role = agent === main ? "main" : "sub";
  }
  group.mainId = main?.id || null;
}

const pendingReports = new Map();

function latestAssistantText(sessionId) {
  if (!sessionId || !manager.getSession(sessionId)) return "";
  const messages = manager.listSessionMessages(sessionId);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && String(message.content || "").trim()) {
      return String(message.content).trim().slice(0, 1200);
    }
  }
  return "";
}

function subReport(sessionId, kind, detail) {
  const group = groupForSession(sessionId);
  if (!group?.mainId || group.mainId === sessionId) return;
  const agent = group.agents.find((item) => item.id === sessionId);
  if (!agent || agent.role === "main") return;
  const text = `子智能体「${agent.title || "子智能体"}」${kind}${detail ? `\n${String(detail).trim()}` : ""}`;
  const key = `${kind}\n${String(detail || "").slice(0, 120)}`;
  if (agent.lastReport === key) return;
  agent.lastReport = key;
  const queued = pendingReports.get(group.mainId) || [];
  queued.push(text);
  pendingReports.set(group.mainId, queued);
  flushReports(group.mainId);
}

let holdMainReports = false;

function flushReports(mainId) {
  if (holdMainReports) return;
  if (!mainId || runs.has(mainId)) return;
  const lines = pendingReports.get(mainId);
  if (!lines?.length) return;
  const session = manager.getSession(mainId);
  if (!session) return;
  pendingReports.delete(mainId);
  launchReply(mainId, {
    text: `${lines.join("\n\n")}\n\n请把以上子智能体的情况整理后告诉我。`,
    planMode: session.planMode === true,
  }, serverForSession(mainId));
}

function settleAgent(sessionId, failure) {
  if (!sessionId) return;
  const session = manager.getSession(sessionId);
  const status = session?.status;
  if (failure) subReport(sessionId, "出现异常", failure);
  else if (status === "failed") subReport(sessionId, "出现异常", session?.failReason || latestAssistantText(sessionId));
  else if (status === "interrupted") subReport(sessionId, "已停止", latestAssistantText(sessionId));
  else if (status === "completed") subReport(sessionId, "已完成", latestAssistantText(sessionId));
  else if (status !== "waiting_for_user" && status !== "ask_permission") subReport(sessionId, "已结束", latestAssistantText(sessionId));
  flushReports(sessionId);
}

function observeSession(entry) {
  if (!entry?.id) return;
  if (entry.status === "waiting_for_user") subReport(entry.id, "需要选择后才能继续", "");
  else if (entry.status === "ask_permission") subReport(entry.id, "需要确认后才能继续", "");
}

function publicGroups() {
  return groups.map((group) => ({
    id: group.id,
    title: group.title,
    mainId: group.mainId || null,
    agents: group.agents.map((agent) => ({
      id: agent.id ?? null,
      title: agent.title || "智能体",
      role: agent.role === "sub" ? "sub" : "main",
      instruction: agent.instruction || agent.title || "",
    })),
  }));
}

function hasRunningWork() {
  return runs.size > 0 || starting > 0 || queue.length > 0;
}

function shownRoot() {
  return viewRoot || projectRoot;
}

function taskDirectory(session) {
  const cwd = typeof session?.cwd === "string" ? path.resolve(session.cwd) : "";
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return "";
  return cwd;
}

function focusTaskDirectory(session) {
  const cwd = taskDirectory(session);
  if (!cwd) return;
  if (hasRunningWork()) {
    viewRoot = path.resolve(cwd) === path.resolve(projectRoot) ? "" : cwd;
    return;
  }
  viewRoot = "";
  if (path.resolve(projectRoot) !== cwd) createManager(cwd);
}

function adoptViewRoot() {
  if (!viewRoot || hasRunningWork()) return;
  const next = viewRoot;
  viewRoot = "";
  if (path.resolve(next) !== path.resolve(projectRoot)) createManager(next);
}

function sessionIdForPid(pid) {
  const key = String(pid);
  for (const entry of manager.listSessions()) {
    if (entry.processes?.has?.(key)) return entry.id;
  }
  return null;
}

function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function sessionStoreDir() {
  return path.join(softwareRoot, ".deepcode", "sessions");
}

function deletedSessionsPath() {
  return path.join(sessionStoreDir(), "deleted-sessions.json");
}

function loadDeletedSessions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(deletedSessionsPath(), "utf8"));
    const ids = Array.isArray(parsed.ids) ? parsed.ids : [];
    return {
      ids: ids.filter((id) => typeof id === "string" && id),
      suppressedLegacy: parsed.suppressedLegacy === true,
    };
  } catch {
    return { ids: [], suppressedLegacy: false };
  }
}

function saveDeletedSessions(record) {
  fs.mkdirSync(sessionStoreDir(), { recursive: true });
  const ids = [];
  const seen = new Set();
  for (const id of record.ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  fs.writeFileSync(deletedSessionsPath(), JSON.stringify({ ids: ids.slice(-2000), suppressedLegacy: record.suppressedLegacy === true }, null, 2));
}

function rememberDeletedSessions(ids) {
  const record = loadDeletedSessions();
  record.ids.push(...ids);
  record.suppressedLegacy = true;
  saveDeletedSessions(record);
  for (const id of ids) purgeLegacySession(id);
}

function purgeLegacySession(id) {
  if (!id) return;
  const legacyRoot = path.join(os.homedir(), ".deepcode", "projects");
  if (!fs.existsSync(legacyRoot)) return;
  for (const code of fs.readdirSync(legacyRoot)) {
    const dir = path.join(legacyRoot, code);
    const file = path.join(dir, `${id}.jsonl`);
    const images = path.join(dir, "images", id);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    if (fs.existsSync(images)) fs.rmSync(images, { recursive: true, force: true });
    const indexPath = path.join(dir, "sessions-index.json");
    if (!fs.existsSync(indexPath)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (!Array.isArray(parsed.entries)) continue;
      const next = parsed.entries.filter((entry) => entry?.id !== id);
      if (next.length === parsed.entries.length) continue;
      parsed.entries = next;
      fs.writeFileSync(indexPath, JSON.stringify(parsed, null, 2));
    } catch {
      // A legacy index that cannot be updated is still skipped by the deleted-session list.
    }
  }
}

function legacySessionEntries() {
  const legacyRoot = path.join(os.homedir(), ".deepcode", "projects");
  const found = [];
  if (!fs.existsSync(legacyRoot)) return found;
  for (const code of fs.readdirSync(legacyRoot)) {
    const dir = path.join(legacyRoot, code);
    const legacyIndexPath = path.join(dir, "sessions-index.json");
    if (!fs.existsSync(legacyIndexPath)) continue;
    let legacy;
    try {
      legacy = JSON.parse(fs.readFileSync(legacyIndexPath, "utf8"));
    } catch {
      continue;
    }
    const origin = typeof legacy.originalPath === "string" ? legacy.originalPath : "";
    for (const entry of legacy.entries ?? []) {
      if (!entry?.id) continue;
      found.push({ dir, origin, entry });
    }
  }
  return found;
}

function importLegacySessions() {
  const destDir = sessionStoreDir();
  fs.mkdirSync(destDir, { recursive: true });
  const indexPath = path.join(destDir, "sessions-index.json");
  const indexExists = fs.existsSync(indexPath);
  let entries = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    if (Array.isArray(parsed.entries)) entries = parsed.entries;
  } catch {
    entries = [];
  }
  const record = loadDeletedSessions();
  const deleted = new Set(record.ids);
    if (indexExists && !record.suppressedLegacy) {
    const removed = [];
    for (const item of legacySessionEntries()) {
      const studioFile = path.join(destDir, `${item.entry.id}.jsonl`);
      const listed = entries.some((entry) => entry?.id === item.entry.id);
      if (!listed && !fs.existsSync(studioFile) && !deleted.has(item.entry.id)) removed.push(item.entry.id);
      if (!listed && !fs.existsSync(studioFile)) deleted.add(item.entry.id);
    }
    record.ids = [...deleted];
    record.suppressedLegacy = true;
    saveDeletedSessions(record);
    for (const id of removed) purgeLegacySession(id);
  }
  const beforeDelete = entries.length;
  entries = entries.filter((entry) => entry?.id && !deleted.has(entry.id));
  const seen = new Set(entries.map((entry) => entry.id));
  let changed = !indexExists || entries.length !== beforeDelete;
  for (const item of legacySessionEntries()) {
    const entry = item.entry;
    if (deleted.has(entry.id)) continue;
    if (seen.has(entry.id)) {
      const saved = entries.find((savedEntry) => savedEntry.id === entry.id);
      if (saved && !saved.cwd && item.origin) {
        saved.cwd = item.origin;
        changed = true;
      }
      continue;
    }
    const from = path.join(item.dir, `${entry.id}.jsonl`);
    if (!fs.existsSync(from)) continue;
    const to = path.join(destDir, `${entry.id}.jsonl`);
    if (!fs.existsSync(to)) fs.copyFileSync(from, to);
    const imagesFrom = path.join(item.dir, "images", entry.id);
    const imagesTo = path.join(destDir, "images", entry.id);
    if (fs.existsSync(imagesFrom) && !fs.existsSync(imagesTo)) fs.cpSync(imagesFrom, imagesTo, { recursive: true });
    if (!entry.cwd && item.origin) entry.cwd = item.origin;
    entries.push(entry);
    seen.add(entry.id);
    changed = true;
  }
  if (!changed) return;
  entries.sort((a, b) => String(b.updateTime || "").localeCompare(String(a.updateTime || "")));
  fs.writeFileSync(indexPath, JSON.stringify({ version: 1, entries: entries.slice(0, 200), originalPath: softwareRoot }, null, 2));
}

function createManager(root) {
  generation += 1;
  const gen = generation;
  for (const run of runs.values()) {
    if (!run.controller.signal.aborted) run.controller.abort();
  }
  runs.clear();
  queue = [];
  starting = 0;
  viewedSessionId = null;
  if (manager) {
    try {
      manager.interruptActiveSession();
      manager.dispose();
    } catch {
      // The previous project session is already being replaced.
    }
  }
  projectRoot = root;
  loadGroups();
  const next = new SessionManager({
    projectRoot: root,
    sessionStorageDir: sessionStoreDir(),
    createOpenAIClient: createOpenAIClientFactory(root),
    getResolvedSettings: () => resolveCurrentSettings(root),
    renderMarkdown: (text) => text,
    onAssistantMessage: (message) => {
      if (gen !== generation || !shouldSend(message)) return;
      rememberPlan(message);
      broadcast({ type: "message", sessionId: message.sessionId ?? "", message: slimMessage(message) });
    },
    onSessionEntryUpdated: (entry) => {
      if (gen !== generation) return;
      observeSession(entry);
      broadcast({ type: "session", session: slimSession(entry) });
    },
    onLlmStreamProgress: (progress) => {
      if (gen !== generation) return;
      broadcast({
        type: "stream",
        sessionId: progress.sessionId ?? "",
        phase: progress.phase,
        preview: clip(progress.previewText ?? "", 8000),
        tokens: progress.formattedTokens,
      });
    },
    onLlmRetry: (event) => {
      if (gen !== generation) return;
      broadcast({ type: "retry", message: event.error, attempt: event.attempt, maxRetries: event.maxRetries });
    },
    onProcessStdout: (pid, chunk) => {
      if (gen !== generation) return;
      broadcast({ type: "stdout", sessionId: sessionIdForPid(pid) ?? "", chunk: clip(String(chunk), 4000) });
    },
    getSharedSessionMessages: (sessionId) => sharedMessagesFor(sessionId),
    getCompactSessionIds: (sessionId) => compactIdsFor(sessionId),
    onManageSubagent: (sessionId, args) => manageSubagent(sessionId, args),
  });
  manager = next;
  pruneMissingGroupSessions();
  const settings = resolveCurrentSettings(root);
  void next.initMcpServers(settings.mcpServers).catch((error) => {
    if (gen !== generation) return;
    console.error("MCP 初始化失败:", error instanceof Error ? error.message : error);
  });
}

function gpuFile() {
  return path.join(os.homedir(), ".deepcode", "studio-gpu.json");
}

let gpuState = { activeId: "", servers: [] };

function normalizeGpuServer(server) {
  if (!server || typeof server !== "object") return null;
  const name = String(server.name ?? "").trim().slice(0, 40);
  let host = String(server.host ?? "").trim().slice(0, 200);
  const user = String(server.user ?? "").trim().slice(0, 64);
  const note = String(server.note ?? "").trim().slice(0, 80);
  let port = Number(server.port) || 22;
  const embedded = /^([^:]+):(\d+)$/.exec(host);
  if (embedded) {
    host = embedded[1];
    if (!Number(server.port) || Number(server.port) === 22) port = Number(embedded[2]);
  }
  if (!name || !host || !/^[\w.:%-]+$/.test(host) || host.startsWith("-")) return null;
  if (user && !/^[\w.-]+$/.test(user)) return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  const auth = server.auth === "key" ? "key" : server.auth === "password" ? "password" : "";
  const keyPath = String(server.keyPath ?? "").trim().replace(/[\r\n]/g, "").slice(0, 400);
  const password = typeof server.password === "string" ? server.password.replace(/[\r\n]/g, "").slice(0, 256) : "";
  const id = typeof server.id === "string" && server.id ? server.id : crypto.randomUUID();
  return { id, name, host, port, user, note, auth, keyPath, password };
}

function publicGpuServer(server) {
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    user: server.user,
    note: server.note,
    auth: server.auth || "",
  };
}

function loadGpu() {
  try {
    const parsed = JSON.parse(fs.readFileSync(gpuFile(), "utf8"));
    const servers = Array.isArray(parsed.servers) ? parsed.servers.map(normalizeGpuServer).filter(Boolean).slice(0, 40) : [];
    const activeId = servers.some((server) => server.id === parsed.activeId) ? parsed.activeId : "";
    gpuState = { activeId, servers };
    const stored = JSON.stringify({ activeId: parsed.activeId ?? "", servers: parsed.servers ?? [] });
    if (stored !== JSON.stringify(gpuState)) saveGpu();
  } catch {
    gpuState = { activeId: "", servers: [] };
  }
}

function saveGpu() {
  const file = gpuFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(gpuState, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

function publicGpu() {
  return { activeId: gpuState.activeId, servers: gpuState.servers.map(publicGpuServer) };
}

const GPU_FIELDS = [
  "index",
  "name",
  "utilization.gpu",
  "utilization.memory",
  "memory.used",
  "memory.total",
  "temperature.gpu",
  "power.draw",
  "power.limit",
  "fan.speed",
  "driver_version",
];

function runCommand(command, args, timeoutMs = 12000, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: env ? { ...process.env, ...env } : undefined });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      const error = new Error("查询超时");
      error.code = "ETIMEDOUT";
      reject(error);
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const error = new Error((stderr || stdout || `退出码 ${code}`).trim());
        error.code = code;
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}

function isLocalHost(host) {
  const name = String(host ?? "").trim().toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1" || name === os.hostname().toLowerCase();
}

function metric(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text || text === "[N/A]" || text === "N/A") return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function parseGpuStatus(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [index, name, utilization, memoryUtilization, memoryUsed, memoryTotal, temperature, power, powerLimit, fan, driver] = line.split(",").map((part) => part.trim());
      return {
        index: metric(index),
        name: name || "GPU",
        utilization: metric(utilization),
        memoryUtilization: metric(memoryUtilization),
        memoryUsed: metric(memoryUsed),
        memoryTotal: metric(memoryTotal),
        temperature: metric(temperature),
        power: metric(power),
        powerLimit: metric(powerLimit),
        fan: metric(fan),
        driver: driver && driver !== "[N/A]" ? driver : "",
      };
    });
}

function explainGpuError(error, local, secret = "") {
  let message = error instanceof Error ? error.message : String(error);
  if (secret) message = message.split(secret).join("••••");
  if (error?.code === "ENOENT") return local ? "本机没有 nvidia-smi" : "本机没有 ssh 命令";
  if (error?.code === "ETIMEDOUT" || /timed out|timeout|查询超时/i.test(message)) return "连接超时";
  if (/UNPROTECTED PRIVATE KEY|bad permissions/i.test(message)) return "密钥文件权限过宽，请先收紧后再连接";
  if (/Permission denied|Authentication failed|publickey/i.test(message)) return "登录失败，请检查密码或密钥";
  if (/nvidia-smi: command not found|nvidia-smi: not found/i.test(message)) return "服务器上没有 nvidia-smi";
  if (/Could not resolve|No route|Connection refused|Host is down/i.test(message)) return "连不上这台服务器";
  return message.slice(0, 180) || "无法读取 GPU 状态";
}

function expandHome(value) {
  const text = String(value ?? "").trim();
  if (text === "~") return os.homedir();
  if (text.startsWith("~/")) return path.join(os.homedir(), text.slice(2));
  return text;
}

function createAskpass(secret) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deepcode-ssh-"));
  const file = path.join(dir, "askpass.sh");
  fs.writeFileSync(file, "#!/bin/sh\nprintf '%s\\n' \"$GPU_SSH_SECRET\"\n", { mode: 0o700 });
  return {
    env: {
      SSH_ASKPASS: file,
      SSH_ASKPASS_REQUIRE: "force",
      GPU_SSH_SECRET: secret,
      DISPLAY: process.env.DISPLAY || "1",
    },
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function sshInvocation(server, remoteArgs) {
  const args = [
    "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=accept-new",
    "-p", String(server.port || 22),
  ];
  let ask = null;
  if (server.auth === "key") {
    args.push("-o", "IdentitiesOnly=yes", "-o", "PreferredAuthentications=publickey", "-i", server.keyPath);
    if (server.password) ask = createAskpass(server.password);
    else args.push("-o", "BatchMode=yes");
  } else if (server.auth === "password") {
    args.push("-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "PubkeyAuthentication=no", "-o", "NumberOfPasswordPrompts=1");
    if (server.password) ask = createAskpass(server.password);
    else args.push("-o", "BatchMode=yes");
  } else {
    args.push("-o", "BatchMode=yes");
  }
  args.push(server.user ? `${server.user}@${server.host}` : server.host, ...remoteArgs);
  return { args, env: ask?.env, cleanup: ask ? ask.cleanup : () => {} };
}

async function queryGpu(server) {
  const query = [`--query-gpu=${GPU_FIELDS.join(",")}`, "--format=csv,noheader,nounits"];
  const local = isLocalHost(server.host);
  if (local) return parseGpuStatus(await runCommand("nvidia-smi", query));
  const ssh = sshInvocation(server, ["nvidia-smi", ...query]);
  try {
    return parseGpuStatus(await runCommand("ssh", ssh.args, 12000, ssh.env));
  } finally {
    ssh.cleanup();
  }
}

function statePayload() {
  const root = shownRoot();
  return {
    projectRoot: root,
    projectName: path.basename(root),
    home: os.homedir(),
    desktop: path.join(os.homedir(), "Desktop"),
    workspaces: currentWorkspaces(),
    canPickDirectories: Boolean(directoryPicker),
    settings: publicSettings(root),
    sessions: manager.listSessions().map(slimSession),
    activeSessionId: viewedSessionId,
    busy: Boolean(viewedSessionId && runs.has(viewedSessionId)),
    runningIds: [...runs.keys()],
    queued: queue.length,
    groups: publicGroups(),
    gpu: publicGpu(),
    gpuTasks: publicGpuTasks(),
  };
}

function broadcastRuns() {
  broadcast({
    type: "status",
    runningIds: [...runs.keys()],
    queued: queue.length,
    groups: publicGroups(),
    sessions: manager.listSessions().map(slimSession),
    activeSessionId: viewedSessionId,
    busy: Boolean(viewedSessionId && runs.has(viewedSessionId)),
    gpuTasks: publicGpuTasks(),
  });
}

function slotsUsed() {
  return runs.size + starting;
}

function serversFromActive() {
  const servers = gpuState.servers;
  if (!servers.length) return [];
  const start = Math.max(0, servers.findIndex((server) => server.id === gpuState.activeId));
  return [...servers.slice(start), ...servers.slice(0, start)];
}

function assignServers(count) {
  const order = serversFromActive();
  if (!order.length) return Array.from({ length: count }, () => "");
  if (count <= 1) return [order[0].id];
  return Array.from({ length: count }, (_, index) => order[index % order.length].id);
}

function rememberServer(sessionId, serverId) {
  if (sessionId && serverId) sessionServers.set(sessionId, serverId);
}

function serverForSession(sessionId) {
  return sessionServers.get(sessionId) || assignServers(1)[0] || "";
}

function jobTitle(job) {
  if (job?.title) return String(job.title).slice(0, 48);
  const text = job?.text || job?.prompt?.text || "";
  return String(text).split("\n")[0].slice(0, 48) || "任务";
}

function taskLabel(sessionId, fallback) {
  const session = sessionId ? manager.getSession(sessionId) : null;
  const summary = session?.summary;
  if (summary) return String(summary).slice(0, 48);
  return fallback || "任务";
}

function publicGpuTasks() {
  const tasks = [];
  for (const [sessionId, run] of runs) {
    if (!run.serverId) continue;
    tasks.push({ sessionId, serverId: run.serverId, title: taskLabel(sessionId, "任务"), state: "running" });
  }
  for (const job of queue) {
    if (!job.serverId || (job.sessionId && runs.has(job.sessionId))) continue;
    tasks.push({
      sessionId: job.sessionId || "",
      serverId: job.serverId,
      title: jobTitle(job),
      state: "queued",
    });
  }
  for (const job of pendingCreates) {
    if (!job.serverId || (job.sessionId && runs.has(job.sessionId))) continue;
    tasks.push({
      sessionId: job.sessionId || "",
      serverId: job.serverId,
      title: jobTitle(job),
      state: "running",
    });
  }
  return tasks;
}

function claimAgent(job, sessionId, controller) {
  if (!sessionId || runs.has(sessionId)) return;
  const serverId = job?.serverId || sessionServers.get(sessionId) || "";
  runs.set(sessionId, { controller, serverId });
  rememberServer(sessionId, serverId);
  if (job) job.sessionId = sessionId;
  if (job?.group && job.group.agents[job.index]) {
    const agent = job.group.agents[job.index];
    agent.id = sessionId;
    if (job.role === "main") {
      for (const item of job.group.agents) item.role = item === agent ? "main" : "sub";
      job.group.mainId = sessionId;
    }
    saveGroups();
  }
  broadcastRuns();
}

function launchCreate(job) {
  starting += 1;
  const controller = new AbortController();
  const active = manager;
  const gen = generation;
  pendingCreates.add(job);
  broadcastRuns();
  const before = new Set(active.listSessions().map((entry) => entry.id));
  const summary = job.text.slice(0, 100);
  let sessionId = "";
  let claimed = false;
  let resolveId = () => {};
  const idReady = new Promise((resolve) => {
    resolveId = resolve;
  });
  const claim = (id) => {
    if (claimed || !id || gen !== generation) return;
    claimed = true;
    sessionId = id;
    starting = Math.max(0, starting - 1);
    clearInterval(finder);
    claimAgent(job, id, controller);
    resolveId(id);
  };
  const finder = setInterval(() => {
    if (gen !== generation) return;
    const found = active.listSessions().find((entry) => !before.has(entry.id) && entry.summary === summary);
    if (found) claim(found.id);
  }, 40);
  void (async () => {
    let failure = "";
    try {
      const id = await active.createSession({ text: job.text, planMode: Boolean(job.planMode) }, controller);
      claim(id);
    } catch (error) {
      if (gen === generation && !controller.signal.aborted && error?.name !== "AbortError") {
        failure = error instanceof Error ? error.message : String(error);
        broadcast({
          type: "error",
          sessionId,
          message: failure,
        });
      }
    } finally {
      clearInterval(finder);
      pendingCreates.delete(job);
      if (!claimed) {
        starting = Math.max(0, starting - 1);
        resolveId("");
      }
      if (gen === generation && sessionId && runs.get(sessionId)?.controller === controller) {
        runs.delete(sessionId);
        broadcast({ type: "done", sessionId, session: slimSession(active.getSession(sessionId)) });
      }
      if (gen === generation) {
        settleAgent(sessionId, failure);
        broadcastRuns();
        pumpQueue();
      }
    }
  })();
  return idReady;
}

function launchReply(sessionId, prompt, serverId = "") {
  if (runs.has(sessionId) || !manager.getSession(sessionId)) return;
  const controller = new AbortController();
  const active = manager;
  const gen = generation;
  const bound = serverId || serverForSession(sessionId);
  rememberServer(sessionId, bound);
  runs.set(sessionId, { controller, serverId: bound });
  broadcastRuns();
  void (async () => {
    let failure = "";
    try {
      await active.replySession(sessionId, prompt, controller);
    } catch (error) {
      if (gen === generation && !controller.signal.aborted && error?.name !== "AbortError") {
        failure = error instanceof Error ? error.message : String(error);
        broadcast({
          type: "error",
          sessionId,
          message: failure,
        });
      }
    } finally {
      if (gen === generation && runs.get(sessionId)?.controller === controller) {
        runs.delete(sessionId);
        broadcast({ type: "done", sessionId, session: slimSession(active.getSession(sessionId)) });
        settleAgent(sessionId, failure);
        broadcastRuns();
        pumpQueue();
      }
    }
  })();
}

function pumpQueue() {
  while (queue.length > 0 && slotsUsed() < MAX_PARALLEL_AGENTS) {
    const job = queue.shift();
    if (job.kind === "reply") launchReply(job.sessionId, job.prompt, job.serverId);
    else void launchCreate(job);
  }
}

function enqueueCreate(job) {
  if (slotsUsed() >= MAX_PARALLEL_AGENTS) {
    queue.push(job);
    broadcastRuns();
    return Promise.resolve("");
  }
  return launchCreate(job);
}

function stopAgent(sessionId) {
  const run = runs.get(sessionId);
  if (run && !run.controller.signal.aborted) run.controller.abort();
  if (manager.getSession(sessionId)) manager.interruptSession(sessionId);
}

function listDir(rel) {
  if (!String(rel ?? "").trim()) {
    const roots = workspaceRoots();
    if (roots.length > 1) {
      return roots.map((abs) => ({
        name: `${path.basename(abs) || abs}${abs === path.resolve(projectRoot) ? " · 当前" : ""}`,
        path: abs,
        type: "dir",
      }));
    }
  }
  const abs = resolveWorkspacePath(rel || ".");
  if (!fs.statSync(abs).isDirectory()) throw httpError(400, "不是目录");
  const items = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const child = path.join(abs, entry.name);
    items.push({
      name: entry.name,
      path: displayPath(child),
      type: entry.isDirectory() ? "dir" : "file",
    });
  }
  items.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return items.slice(0, 500);
}

function searchFiles(query) {
  const needle = query.trim().toLowerCase();
  const hits = [];
  const stack = [...workspaceRoots()];
  let walked = 0;
  while (stack.length > 0 && hits.length < 80 && walked < 8000) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      walked += 1;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(abs);
        continue;
      }
      const shown = displayPath(abs);
      if (shown.toLowerCase().includes(needle) || entry.name.toLowerCase().includes(needle)) hits.push(shown);
    }
  }
  return hits;
}

function readProjectFile(rel) {
  const abs = resolveWorkspacePath(rel);
  const stat = fs.statSync(abs);
  if (!stat.isFile()) throw httpError(400, "不是文件");
  if (stat.size > 1024 * 1024) throw httpError(400, "文件超过 1MB，请在外部编辑器打开");
  const ext = path.extname(abs).toLowerCase();
  if (IMAGE_EXT.has(ext)) return { path: rel, image: true, size: stat.size };
  const buf = fs.readFileSync(abs);
  if (buf.includes(0)) return { path: rel, binary: true, size: stat.size };
  return { path: rel, content: buf.toString("utf8"), size: stat.size };
}

function writeProjectFile(rel, content) {
  if (typeof rel !== "string" || !rel.trim()) throw httpError(400, "缺少文件路径");
  if (typeof content !== "string") throw httpError(400, "文件内容无效");
  const abs = resolveWorkspacePath(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

async function verifyDeepSeekAccount(apiKey, baseURL) {
  const root = String(baseURL || "https://api.deepseek.com").replace(/\/$/, "");
  const headers = { Authorization: `Bearer ${apiKey}` };
  const signal = AbortSignal.timeout(15000);
  let balanceResponse;
  try {
    balanceResponse = await fetch(`${root}/user/balance`, { headers, signal });
  } catch {
    throw httpError(502, "无法连接接口地址");
  }
  if (balanceResponse.ok) {
    const data = await balanceResponse.json();
    const balances = Array.isArray(data.balance_infos)
      ? data.balance_infos.map((item) => ({
          currency: typeof item.currency === "string" ? item.currency : "",
          total: typeof item.total_balance === "string" ? item.total_balance : "",
        }))
      : [];
    return { available: data.is_available !== false, balances };
  }
  if (balanceResponse.status === 401 || balanceResponse.status === 403) {
    throw httpError(401, "API Key 无效，无法登录");
  }
  let modelsResponse;
  try {
    modelsResponse = await fetch(`${root}/models`, { headers, signal: AbortSignal.timeout(15000) });
  } catch {
    throw httpError(502, "无法连接接口地址");
  }
  if (modelsResponse.status === 401 || modelsResponse.status === 403) {
    throw httpError(401, "API Key 无效，无法登录");
  }
  if (!modelsResponse.ok) {
    throw httpError(401, "无法登录，请检查 API Key 和接口地址");
  }
  return { available: true, balances: [] };
}

function sendJson(res, code, body) {
  res.writeHead(code, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw httpError(413, "请求体过大");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "请求不是有效的 JSON");
  }
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, statePayload());
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/tree") {
    sendJson(res, 200, { entries: listDir(url.searchParams.get("path") ?? "") });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/search") {
    const query = url.searchParams.get("q") ?? "";
    sendJson(res, 200, { paths: query.trim().length < 2 ? [] : searchFiles(query) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/file") {
    sendJson(res, 200, readProjectFile(url.searchParams.get("path") ?? ""));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/raw") {
    const abs = resolveWorkspacePath(url.searchParams.get("path") ?? "");
    const stat = fs.statSync(abs);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw httpError(400, "无法预览该文件");
    const ext = path.extname(abs).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "content-length": stat.size,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    });
    fs.createReadStream(abs).pipe(res);
    return;
  }
  if (req.method === "PUT" && url.pathname === "/api/file") {
    const body = await readBody(req);
    writeProjectFile(body.path, body.content);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/task-plan") {
    const id = url.searchParams.get("sessionId") ?? "";
    if (!manager.getSession(id)) throw httpError(404, "找不到这段任务");
    sendJson(res, 200, { sessionId: id, plan: sessionPlan(id) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/messages") {
    const id = url.searchParams.get("sessionId") ?? "";
    const messages = manager.listSessionMessages(id).filter(shouldSend).map(slimMessage);
    sendJson(res, 200, { messages });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/pick-directories") {
    if (!directoryPicker) throw httpError(501, "请从目录列表中选择");
    const directories = await directoryPicker();
    sendJson(res, 200, { directories: Array.isArray(directories) ? directories : [] });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/browse") {
    sendJson(res, 200, browseComputer(url.searchParams.get("path") ?? ""));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/workspaces") {
    const body = await readBody(req);
    const directories = Array.isArray(body.directories) ? body.directories : [];
    setWorkspaces(body.cwd, directories);
    sendJson(res, 200, statePayload());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/project") {
    if (hasRunningWork()) throw httpError(409, "还有智能体在执行，请先停止");
    viewRoot = "";
    const body = await readBody(req);
    const next = path.resolve(String(body.path ?? ""));
    if (!fs.existsSync(next) || !fs.statSync(next).isDirectory()) throw httpError(400, "目录不存在");
    createManager(next);
    sendJson(res, 200, statePayload());
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/session") {
    const body = await readBody(req);
    const id = body.id ? String(body.id) : null;
    const session = id ? manager.getSession(id) : null;
    if (id && !session) throw httpError(404, "找不到这段对话");
    if (session) focusTaskDirectory(session);
    viewedSessionId = id;
    const messages = id ? manager.listSessionMessages(id).filter(shouldSend).map(slimMessage) : [];
    sendJson(res, 200, { ...statePayload(), messages });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/session/delete") {
    const body = await readBody(req);
    sendJson(res, 200, deleteHistoryTask(body));
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/chat") {
    const body = await readBody(req);
    const text = String(body.text ?? "").trim();
    if (!text) throw httpError(400, "请输入内容");
    const requested = body.sessionId ? String(body.sessionId) : "";
    const parentId = body.parentSessionId ? String(body.parentSessionId) : "";
    const planMode = body.planMode === true;
    if (!requested && !parentId) adoptViewRoot();
    if (parentId || requested) {
      const anchor = parentId || requested;
      const agent = await deliverToMain(anchor, text, planMode);
      sendJson(res, 200, { agents: [agent], mainId: agent.id });
      return;
    }
    const title = text.split("\n")[0].slice(0, 48);
    const serverId = assignServers(1)[0] || "";
    const id = await enqueueCreate({
      kind: "create",
      text,
      planMode,
      title,
      serverId,
    });
    if (id) viewedSessionId = id;
    broadcastRuns();
    sendJson(res, 200, { agents: [{ id: id || null, title, role: "main" }] });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/permission") {
    const body = await readBody(req);
    const sessionId = body.sessionId ? String(body.sessionId) : viewedSessionId;
    const session = sessionId ? manager.getSession(sessionId) : null;
    const asks = session?.askPermissions ?? [];
    if (!session || asks.length === 0) throw httpError(400, "当前没有待确认的操作");
    if (runs.has(sessionId)) throw httpError(409, "这个智能体还在执行");
    const decisions = Array.isArray(body.decisions) ? body.decisions : [];
    viewedSessionId = sessionId;
    const serverId = serverForSession(sessionId);
    rememberServer(sessionId, serverId);
    const prompt = {
      text: "/continue",
      planMode: session.planMode === true,
      permissions: asks.map((ask) => {
        const picked = decisions.find((item) => item && item.toolCallId === ask.toolCallId);
        const permission = picked ? (picked.permission === "deny" ? "deny" : "allow") : body.decision === "deny" ? "deny" : "allow";
        return { toolCallId: ask.toolCallId, permission };
      }),
    };
    if (slotsUsed() >= MAX_PARALLEL_AGENTS) {
      queue.push({ kind: "reply", sessionId, prompt, serverId, title: session.summary || "任务" });
      broadcastRuns();
      sendJson(res, 200, { ok: true, queued: true });
      return;
    }
    launchReply(sessionId, prompt, serverId);
    sendJson(res, 200, { ok: true, queued: false });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/revert-file") {
    const body = await readBody(req);
    const sessionId = body.sessionId ? String(body.sessionId) : viewedSessionId;
    const session = sessionId ? manager.getSession(sessionId) : null;
    if (!session) throw httpError(404, "找不到这个任务");
    const abs = resolveWorkspacePath(body.path);
    try {
      manager.restoreFileBeforeEdits(sessionId, abs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "No earlier version is recorded for this file.") throw httpError(400, "这个文件没有可退回的改动记录");
      if (message === "No file history for this session.") throw httpError(400, "找不到这次任务的文件记录");
      throw httpError(400, message);
    }
    sendJson(res, 200, { ok: true, path: displayPath(abs) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/answers") {
    const body = await readBody(req);
    const sessionId = body.sessionId ? String(body.sessionId) : viewedSessionId;
    const session = sessionId ? manager.getSession(sessionId) : null;
    if (!session || session.status !== "waiting_for_user") throw httpError(400, "当前没有需要选择的问题");
    if (runs.has(sessionId)) throw httpError(409, "这个智能体还在执行");
    const answers = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
    const entries = Object.entries(answers)
      .map(([question, answer]) => [String(question).replace(/\s+/g, " ").trim(), String(answer ?? "").replace(/\s+/g, " ").trim()])
      .filter(([question, answer]) => question && answer);
    if (!entries.length) throw httpError(400, "请先选择一个选项");
    const lines = [`Questions ${entries.length}/${entries.length} answered`];
    for (const [question, answer] of entries) {
      lines.push(` - ${question}`);
      lines.push(`   answer: ${answer}`);
    }
    viewedSessionId = sessionId;
    const serverId = serverForSession(sessionId);
    rememberServer(sessionId, serverId);
    const prompt = { text: lines.join("\n"), planMode: session.planMode === true, isAnswers: true };
    if (slotsUsed() >= MAX_PARALLEL_AGENTS) {
      queue.push({ kind: "reply", sessionId, prompt, serverId, title: session.summary || "任务" });
      broadcastRuns();
      sendJson(res, 200, { ok: true, queued: true });
      return;
    }
    launchReply(sessionId, prompt, serverId);
    sendJson(res, 200, { ok: true, queued: false });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/agent-control") {
    const body = await readBody(req);
    const sessionId = body.sessionId ? String(body.sessionId) : "";
    const session = sessionId ? manager.getSession(sessionId) : null;
    if (!session) throw httpError(404, "找不到这个智能体");
    const group = groupForSession(sessionId);
    const agent = group?.agents.find((item) => item.id === sessionId) || null;
    if (body.action === "stop") {
      stopAgent(sessionId);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (body.action !== "rerun") throw httpError(400, "未知操作");
    const text = String(body.text || agent?.instruction || session.summary || "").trim();
    if (!text) throw httpError(400, "请填写要执行的内容");
    if (agent) {
      agent.instruction = text.slice(0, 4000);
      agent.role = "sub";
      saveGroups();
    }
    if (runs.has(sessionId)) stopAgent(sessionId);
    const started = Date.now();
    while (runs.has(sessionId) && Date.now() - started < 3000) {
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    if (runs.has(sessionId)) throw httpError(409, "这个智能体还在停止，请稍后再重新执行");
    const planMode = body.planMode === true || body.planMode === false ? body.planMode === true : session.planMode === true;
    launchReply(sessionId, { text, planMode }, serverForSession(sessionId));
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/interrupt") {
    const body = await readBody(req);
    const sessionId = body.sessionId ? String(body.sessionId) : viewedSessionId;
    if (!sessionId) throw httpError(400, "没有正在执行的智能体");
    stopAgent(sessionId);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/gpu-status") {
    const id = url.searchParams.get("id") || gpuState.activeId;
    const server = gpuState.servers.find((item) => item.id === id);
    if (!server) throw httpError(404, "找不到这台服务器");
    const local = isLocalHost(server.host);
    try {
      const gpus = await queryGpu(server);
      sendJson(res, 200, { id: server.id, checkedAt: new Date().toISOString(), gpus, error: "" });
    } catch (error) {
      sendJson(res, 200, {
        id: server.id,
        checkedAt: new Date().toISOString(),
        gpus: [],
        error: explainGpuError(error, local, server.password),
      });
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/gpu-servers") {
    const body = await readBody(req);
    const server = normalizeGpuServer(body);
    if (!server) throw httpError(400, "请填写名称和地址");
    if (server.auth === "password" && !server.password) throw httpError(400, "请填写登录密码");
    if (server.auth === "key") {
      const keyPath = expandHome(server.keyPath);
      if (!keyPath || keyPath.startsWith("-")) throw httpError(400, "请填写密钥文件");
      if (!fs.existsSync(keyPath) || !fs.statSync(keyPath).isFile()) throw httpError(400, "找不到密钥文件");
      server.keyPath = keyPath;
    } else {
      server.keyPath = "";
    }
    if (gpuState.servers.some((item) => item.host === server.host && item.port === server.port && item.user === server.user)) {
      throw httpError(400, "这台服务器已经添加过");
    }
    gpuState.servers.unshift(server);
    if (!gpuState.activeId) gpuState.activeId = server.id;
    saveGpu();
    sendJson(res, 200, { gpu: publicGpu() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/gpu-servers/select") {
    const body = await readBody(req);
    const id = String(body.id ?? "");
    if (id && !gpuState.servers.some((server) => server.id === id)) throw httpError(404, "找不到这台服务器");
    gpuState.activeId = id;
    saveGpu();
    sendJson(res, 200, { gpu: publicGpu() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/gpu-servers/remove") {
    const body = await readBody(req);
    const id = String(body.id ?? "");
    gpuState.servers = gpuState.servers.filter((server) => server.id !== id);
    if (gpuState.activeId === id) gpuState.activeId = gpuState.servers[0]?.id ?? "";
    saveGpu();
    sendJson(res, 200, { gpu: publicGpu() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/login") {
      const body = await readBody(req);
      const apiKey = String(body.apiKey ?? "").trim();
      const baseURL = String(body.baseURL ?? "https://api.deepseek.com").trim();
      if (!apiKey) throw httpError(400, "请输入 API Key");
      const account = await verifyDeepSeekAccount(apiKey, baseURL);
      const current = readSettings() ?? {};
      writeSettings({
        ...current,
        env: { ...(current.env ?? {}), API_KEY: apiKey, BASE_URL: baseURL },
      });
      sendJson(res, 200, { settings: publicSettings(projectRoot), account });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      const current = readSettings() ?? {};
      const env = { ...(current.env ?? {}) };
      delete env.API_KEY;
      writeSettings({ ...current, env });
      sendJson(res, 200, { settings: publicSettings(projectRoot) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/work-mode") {
    const body = await readBody(req);
    applyWorkMode(String(body.mode ?? ""));
    sendJson(res, 200, { settings: publicSettings(projectRoot) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/settings") {
    const body = await readBody(req);
    const current = readSettings() ?? {};
    const env = { ...(current.env ?? {}) };
    if (typeof body.model === "string" && body.model.trim()) env.MODEL = body.model.trim();
    if (typeof body.baseURL === "string" && body.baseURL.trim()) env.BASE_URL = body.baseURL.trim();
    if (typeof body.apiKey === "string" && body.apiKey.trim()) env.API_KEY = body.apiKey.trim();
    const reasoning = body.reasoningEffort === "low" || body.reasoningEffort === "high" ? body.reasoningEffort : "max";
    writeSettings({
      ...current,
      env,
      thinkingEnabled: body.thinkingEnabled !== false,
      reasoningEffort: reasoning,
    });
    sendJson(res, 200, { settings: publicSettings(projectRoot) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
res.write(": connected\n\n");
      req.socket.setTimeout(0);
      clients.add(res);
    const timer = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(timer);
      }
    }, 15000);
    req.on("close", () => {
      clearInterval(timer);
      clients.delete(res);
    });
    return;
  }
  throw httpError(404, "未找到接口");
}

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const abs = path.resolve(publicDir, rel);
  if (abs !== publicDir && !abs.startsWith(`${publicDir}${path.sep}`)) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": MIME[path.extname(abs)] ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(abs).pipe(res);
}

export function startStudio({ port = 3927, root = process.cwd() } = {}) {
  const project = path.resolve(root);
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    return Promise.reject(new Error(`目录不存在: ${project}`));
  }
  loadGpu();
  importLegacySessions();
  createManager(project);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) {
      handleApi(req, res, url).catch((error) => {
        if (res.headersSent) return;
        const status = Number(error?.statusCode) || 500;
        sendJson(res, status, { error: error instanceof Error ? error.message : String(error) });
      });
      return;
    }
    serveStatic(res, decodeURIComponent(url.pathname));
  });
  server.requestTimeout = 0;
  server.headersTimeout = 0;
  server.timeout = 0;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://127.0.0.1:${actualPort}`,
        port: actualPort,
        server,
      });
    });
  });
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  const options = parseArgs(process.argv.slice(2));
  startStudio(options)
    .then(({ url }) => {
      console.log(`DeepSeek Agent 已启动: ${url}`);
      console.log(`项目目录: ${projectRoot}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
