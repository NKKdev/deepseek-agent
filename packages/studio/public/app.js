const $ = (selector) => document.querySelector(selector);

const state = {
  projectRoot: "",
  projectName: "",
  home: "",
  desktop: "",
  settings: null,
  sessions: [],
  activeSessionId: null,
  busy: false,
  runningIds: [],
  groups: [],
  agentPanelOpen: true,
  queued: 0,
  historyQuery: "",
  gpu: { activeId: "", servers: [] },
  gpuTasks: [],
  questionPicks: {},
  permissionPicks: {},
  sideOpen: false,
  sideTab: "files",
  taskExpanded: false,
  plans: {},
  tabs: [],
  activePath: null,
  expanded: new Set(),
  treeCache: new Map(),
  messages: [],
  preview: "",
  streaming: false,
  stdout: "",
  asks: [],
  filter: "",
};

let searchTimer = 0;
let toastTimer = 0;

function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2400);
}

async function api(url, options) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

let viewGeneration = 0;
const paintQueue = [];
let paintFrame = 0;
let markdownSeq = 0;
const markdownJobs = new Map();
let markdownBatch = [];
let markdownTimer = 0;
const markdownWorker = new Worker("/markdown-worker.js");

markdownWorker.onmessage = (event) => {
  const jobs = markdownJobs.get(event.data?.id);
  markdownJobs.delete(event.data?.id);
  if (!jobs) return;
  const html = Array.isArray(event.data?.html) ? event.data.html : [];
  jobs.forEach((job, index) => deliverMarkdown(job, html[index] ?? ""));
};

markdownWorker.onerror = () => {
  for (const jobs of markdownJobs.values()) {
    for (const job of jobs) deliverMarkdown(job, "");
  }
  markdownJobs.clear();
};

function deliverMarkdown(job, html) {
  if (job.generation !== viewGeneration) return;
  schedulePaint(() => {
    if (job.generation !== viewGeneration || !job.body.isConnected) return;
    if (html) job.body.innerHTML = html;
    else job.body.textContent = job.text;
  });
}

function flushMarkdownBatch() {
  markdownTimer = 0;
  const jobs = markdownBatch.splice(0, 4);
  if (!jobs.length) return;
  const id = ++markdownSeq;
  markdownJobs.set(id, jobs);
  markdownWorker.postMessage({ id, texts: jobs.map((job) => job.text) });
  if (markdownBatch.length) markdownTimer = setTimeout(flushMarkdownBatch, 0);
}

function requestMarkdown(body, text, generation) {
  markdownBatch.push({ body, text, generation });
  if (!markdownTimer) markdownTimer = setTimeout(flushMarkdownBatch, 0);
}

function schedulePaint(work) {
  paintQueue.push(work);
  if (!paintFrame) paintFrame = requestAnimationFrame(runPaint);
}

function runPaint() {
  paintFrame = 0;
  if (document.body.classList.contains("resizing")) {
    if (paintQueue.length) paintFrame = requestAnimationFrame(runPaint);
    return;
  }
  const start = performance.now();
  while (paintQueue.length && performance.now() - start < 8) paintQueue.shift()();
  if (paintQueue.length) paintFrame = requestAnimationFrame(runPaint);
}

function mountMarkdown(parent, text, generation) {
  const body = document.createElement("div");
  body.className = "edit-body";
  parent.append(body);
  const source = String(text ?? "");
  if (!source.trim()) return body;
  requestMarkdown(body, source, generation);
  return body;
}

function frameWork(step) {
  requestAnimationFrame(() => {
    const start = performance.now();
    while (performance.now() - start < 8) {
      if (step() === false) return;
    }
    frameWork(step);
  });
}

function applyState(data) {
  state.projectRoot = data.projectRoot;
  state.projectName = data.projectName;
  state.home = data.home;
  state.desktop = data.desktop;
  state.workspaces = data.workspaces ?? { cwd: data.projectRoot, directories: [data.projectRoot] };
  state.canPickDirectories = Boolean(data.canPickDirectories);
  state.settings = data.settings;
  state.sessions = data.sessions ?? [];
  state.activeSessionId = data.activeSessionId;
  state.runningIds = data.runningIds ?? [];
  state.groups = data.groups ?? [];
  state.queued = data.queued ?? 0;
  if (data.gpu) state.gpu = data.gpu;
  if (Array.isArray(data.gpuTasks)) state.gpuTasks = data.gpuTasks;
  state.busy = state.runningIds.includes(state.activeSessionId);
  $("#projectName").textContent = data.projectName;
  $("#rootLabel").textContent = data.workspaces?.directories?.length > 1
    ? `${data.projectRoot} · ${data.workspaces.directories.length} 个目录`
    : data.projectRoot;
  renderControls();
  renderWorkspaces();
  $("#keyBanner").hidden = data.settings.hasKey;
  const account = $("#accountLabel");
  if (account) account.textContent = data.settings.hasKey ? `已登录 ${data.settings.keyHint}` : "未登录";
  const base = $("#loginBase");
  if (base && data.settings.baseURL && document.activeElement !== base) base.value = data.settings.baseURL;
  const login = $("#login");
  if (login) login.hidden = data.settings.hasKey;
  document.title = `${data.projectName} — DeepSeek Agent`;
  renderControls();
  renderHistory();
  renderAgentBar();
  renderUsageBar();
  renderRunState();
  renderGpu();
  syncInert();
}

function renderControls() {
  const settings = state.settings;
  const modelSelect = $("#modelSelect");
  const modeSelect = $("#workMode");
  if (!settings || !modelSelect || !modeSelect) return;
  const models = settings.models?.length ? settings.models : [settings.model];
  const modelKey = models.join("\n");
  if (modelSelect.dataset.models !== modelKey) {
    modelSelect.replaceChildren();
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      modelSelect.append(option);
    }
    modelSelect.dataset.models = modelKey;
  }
  const modes = settings.workModes ?? [];
  const modeKey = modes.map((mode) => mode.id).join("\n");
  if (modeSelect.dataset.modes !== modeKey) {
    modeSelect.replaceChildren();
    for (const mode of modes) {
      const option = document.createElement("option");
      option.value = mode.id;
      option.textContent = mode.label;
      modeSelect.append(option);
    }
    modeSelect.dataset.modes = modeKey;
  }
  if (document.activeElement !== modelSelect) modelSelect.value = settings.model;
  if (document.activeElement !== modeSelect && settings.workMode) modeSelect.value = settings.workMode;
  const hint = $("#modeHint");
  if (hint) hint.textContent = modes.find((mode) => mode.id === settings.workMode)?.hint ?? "";
}

function isRunning(id) {
  return Boolean(id && state.runningIds.includes(id));
}

function sessionById(id) {
  return state.sessions.find((session) => session.id === id) ?? null;
}

function upsertSession(session) {
  if (!session?.id) return;
  const index = state.sessions.findIndex((item) => item.id === session.id);
  if (index === -1) state.sessions.unshift(session);
  else state.sessions[index] = { ...state.sessions[index], ...session };
}

function formatTokens(value) {
  const count = Number(value) || 0;
  if (count < 1000) return String(count);
  if (count < 100000) return `${(count / 1000).toFixed(count < 10000 ? 1 : 0)}k`;
  return `${Math.round(count / 1000)}k`;
}

function formatContextTokens(value) {
  const count = Math.max(0, Number(value) || 0);
  if (count < 1024) return String(Math.round(count));
  const unit = count >= 1024 * 1024 ? "M" : "K";
  const divisor = unit === "M" ? 1024 * 1024 : 1024;
  const scaled = count / divisor;
  return `${scaled.toFixed(scaled >= 100 ? 0 : 1)}${unit}`;
}

function formatWhen(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const time = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === now.toDateString()) return time;
  return `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

function matchesHistory(session, agent) {
  const query = state.historyQuery.trim().toLowerCase();
  if (!query) return true;
  return `${session?.summary || ""} ${agent?.title || ""}`.toLowerCase().includes(query);
}

function setGpuFormOpen(open) {
  const form = $("#gpuForm");
  const toggle = $("#gpuAddToggle");
  if (!form || !toggle) return;
  form.hidden = !open;
  toggle.hidden = open;
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open) syncGpuAuth();
}

function syncGpuAuth() {
  const key = document.querySelector("input[name=gpuAuth]:checked")?.value === "key";
  const keyLabel = $("#gpuKeyLabel");
  const caption = $("#gpuPasswordCaption");
  const password = $("#gpuPassword");
  const keyPath = $("#gpuKeyPath");
  if (keyLabel) keyLabel.hidden = !key;
  if (caption) caption.textContent = key ? "密钥密码" : "登录密码";
  if (password) password.required = !key;
  if (keyPath) keyPath.required = key;
}

function taskHasRunning(sessionId) {
  const group = taskGroup(sessionId);
  if (!group) return isRunning(sessionId);
  return group.agents.some((agent) => agent.id && isRunning(agent.id));
}

function taskGroup(sessionId) {
  if (!sessionId) return null;
  return (state.groups ?? []).find((group) => group.agents?.some((agent) => agent.id === sessionId) && group.agents.length > 1) ?? null;
}

function agentSession(agent) {
  return agent?.id ? sessionById(agent.id) : null;
}

function agentPhase(agent) {
  if (!agent?.id) return "queued";
  if (isRunning(agent.id)) return "running";
  return "done";
}

function mainAgent(group) {
  return group.agents.find((agent) => agent.role === "main" && agent.id)
    || group.agents.find((agent) => agent.id && agent.id === group.mainId)
    || primaryAgent(group);
}

function agentRole(agent) {
  return agent?.role === "sub" ? "sub" : "main";
}

function stopTargetLabel() {
  const id = state.activeSessionId;
  const group = taskGroup(id);
  if (!group) return "当前智能体";
  const agent = group.agents.find((item) => item.id === id);
  return agentRole(agent) === "sub" ? "这个子智能体" : "主智能体";
}

function primaryAgent(group) {
  const running = group.agents.find((agent) => agentPhase(agent) === "running");
  if (running) return running;
  const ranked = group.agents
    .map((agent) => ({ agent, session: agentSession(agent) }))
    .filter((item) => item.session);
  ranked.sort((a, b) => String(b.session.updateTime || "").localeCompare(String(a.session.updateTime || "")));
  return ranked[0]?.agent || group.agents[0];
}

function renderHistory() {
  const root = $("#history");
  root.replaceChildren();
  const shownGroups = new Set();
  let count = 0;
  const appendGroup = (group) => {
    if (!group || shownGroups.has(group.id) || group.agents.length < 2) return;
    const sessions = groupSessions(group);
    const visible = sessions.some((session) => matchesHistory(session, null)) || matchesHistory(null, { title: group.title });
    if (!visible) return;
    shownGroups.add(group.id);
    root.append(historyButton(null, group));
    count += 1;
  };
  for (const session of state.sessions) {
    const group = taskGroup(session.id);
    if (group) {
      appendGroup(group);
      continue;
    }
    if (!matchesHistory(session, null)) continue;
    root.append(historyButton(session, null));
    count += 1;
  }
  for (const group of state.groups ?? []) appendGroup(group);
  if (count === 0) {
    const empty = document.createElement("div");
    empty.className = "tree-row";
    empty.textContent = state.historyQuery.trim() ? "没有匹配的任务" : "还没有任务";
    root.append(empty);
  }
  const total = $("#usageTotal");
  if (total) {
    const tokens = state.sessions.reduce((sum, session) => sum + (session.usage?.total || 0), 0);
    total.textContent = state.sessions.length ? `${state.sessions.length} 个历史任务 · ${formatTokens(tokens)} tokens` : "";
  }
}

function agentList(agents, where) {
  const list = document.createElement("div");
  list.className = where === "history" ? "task-agents" : "agent-list";
  const order = { running: 0, queued: 1, done: 2 };
  const sorted = [...agents].sort((a, b) => {
    if (agentRole(a) !== agentRole(b)) return agentRole(a) === "main" ? -1 : 1;
    return order[agentPhase(a)] - order[agentPhase(b)];
  });
  let lastPhase = "";
  for (const agent of sorted) {
    const phase = agentPhase(agent);
    if (phase !== lastPhase) {
      const label = document.createElement("div");
      label.className = "agent-phase";
      label.textContent = phase === "running" ? "执行中" : phase === "queued" ? "排队" : "已完成";
      list.append(label);
      lastPhase = phase;
    }
    list.append(agentRow(agent));
  }
  return list;
}

function agentRow(agent) {
  const row = document.createElement("div");
  const phase = agentPhase(agent);
  row.className = `agent-row ${phase}`;
  if (agent.id === state.activeSessionId) row.classList.add("active");
  const button = document.createElement("button");
  button.type = "button";
  const session = agentSession(agent);
  const title = document.createElement("span");
  title.textContent = session?.summary || agent.title || "智能体";
  const sub = document.createElement("span");
  sub.className = "sub";
  const bits = [agentRole(agent) === "sub" ? "子智能体" : "主智能体", phase === "running" ? "执行中" : phase === "queued" ? "排队" : statusText(session?.status) || "已完成"];
  if (session?.usage?.total) bits.push(`${formatTokens(session.usage.total)} tokens`);
  const when = formatWhen(session?.updateTime);
  if (when) bits.push(when);
  sub.textContent = bits.join(" · ");
  button.append(title, sub);
  button.disabled = !agent.id;
  button.addEventListener("click", () => {
    if (agent.id) void openSession(agent.id);
  });
  row.append(button);
  if (agent.id && phase === "running") {
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "mini-stop";
    stop.textContent = "停止";
    stop.addEventListener("click", (event) => {
      event.stopPropagation();
      void api("/api/interrupt", { method: "POST", body: JSON.stringify({ sessionId: agent.id }) });
    });
    row.append(stop);
  }
  if (agentRole(agent) === "sub" && agent.id) row.append(subControl(agent));
  return row;
}

function subControl(agent) {
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "mini-stop";
  edit.textContent = "参数";
  edit.addEventListener("click", (event) => {
    event.stopPropagation();
    const row = edit.parentElement;
    const existing = row.querySelector(".agent-rerun");
    if (existing) {
      existing.remove();
      return;
    }
    const form = document.createElement("form");
    form.className = "agent-rerun";
    const area = document.createElement("textarea");
    area.rows = 3;
    area.value = agent.instruction || agent.title || "";
    const mode = document.createElement("select");
    for (const item of state.settings?.workModes ?? []) {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      if (item.id === (state.settings?.workMode || "auto")) option.selected = true;
      mode.append(option);
    }
    const go = document.createElement("button");
    go.type = "submit";
    go.className = "send";
    go.textContent = "重新执行";
    form.append(area, mode, go);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void api("/api/agent-control", {
        method: "POST",
        body: JSON.stringify({
          sessionId: agent.id,
          action: "rerun",
          text: area.value.trim(),
          planMode: mode.value === "plan",
        }),
      }).then(() => {
        form.remove();
        toast("子智能体已按新参数重新执行");
      }).catch((error) => toast(error.message));
    });
    row.append(form);
  });
  return edit;
}

function renderAgentBar() {
  const bar = $("#agentBar");
  if (!bar) return;
  const group = taskGroup(state.activeSessionId);
  bar.replaceChildren();
  if (!group) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.classList.toggle("open", state.agentPanelOpen);
  const head = document.createElement("button");
  head.type = "button";
  head.className = "agent-panel-toggle";
  const running = group.agents.filter((agent) => agentPhase(agent) === "running").length;
  const done = group.agents.filter((agent) => agentPhase(agent) === "done").length;
  head.textContent = state.agentPanelOpen ? "折叠智能体" : "展开智能体";
  head.setAttribute("aria-expanded", state.agentPanelOpen ? "true" : "false");
  const summary = document.createElement("strong");
  summary.textContent = `${group.title || "任务"} · 主智能体 · ${running} 个后台执行中 · ${done} 个已完成`;
  head.addEventListener("click", () => {
    state.agentPanelOpen = !state.agentPanelOpen;
    renderAgentBar();
  });
  const titleRow = document.createElement("div");
  titleRow.className = "agent-panel-head";
  titleRow.append(head, summary);
  bar.append(titleRow);
  if (state.agentPanelOpen) bar.append(agentList(group.agents, "panel"));
}

function historyButton(session, group) {
  const sessions = group ? groupSessions(group) : session ? [session] : [];
  const primary = group ? agentSession(mainAgent(group)) || sessions[0] : session;
  const id = primary?.id || "";
  const runningIds = group
    ? group.agents.filter((agent) => agent.id && agentPhase(agent) === "running").map((agent) => agent.id)
    : id && isRunning(id) ? [id] : [];
  const button = document.createElement("button");
  button.type = "button";
  button.className = "history-open";
  const active = group
    ? group.agents.some((agent) => agent.id === state.activeSessionId)
    : id && id === state.activeSessionId;
  if (active) button.classList.add("active");
  const title = document.createElement("span");
  title.textContent = group?.title || session?.summary || "未命名任务";
  const sub = document.createElement("span");
  sub.className = "sub";
  const latest = sessions.reduce((best, item) => (
    String(item.updateTime || "") > String(best?.updateTime || "") ? item : best
  ), primary);
  const tokens = sessions.reduce((sum, item) => sum + (item.usage?.total || 0), 0);
  const bits = [runningIds.length ? "执行中" : statusText(primary?.status) || "已完成"];
  if (tokens) bits.push(`${formatTokens(tokens)} tokens`);
  const when = formatWhen(latest?.updateTime || primary?.updateTime);
  if (when) bits.push(when);
  const folder = String(primary?.cwd || "").split("/").filter(Boolean).pop();
  if (folder) bits.push(folder);
  sub.textContent = bits.join(" · ");
  const wrap = document.createElement("span");
  wrap.append(title, sub);
  const meter = contextMeter(sessions, true);
  if (meter) wrap.append(meter);
  button.append(wrap);
  button.disabled = !id;
  button.addEventListener("click", () => {
    if (id) void openSession(id);
  });
  button.addEventListener("contextmenu", (event) => {
    openHistoryMenu(event, group ? { groupId: group.id } : { sessionId: id });
  });
  const row = document.createElement("div");
  row.className = "history-row";
  row.append(button);
  if (runningIds.length) {
    const stop = document.createElement("button");
    stop.type = "button";
    stop.className = "mini-stop";
    stop.textContent = "停止";
    stop.setAttribute("aria-label", "停止这个任务");
    stop.addEventListener("click", (event) => {
      event.stopPropagation();
      for (const sessionId of runningIds) {
        void api("/api/interrupt", { method: "POST", body: JSON.stringify({ sessionId }) });
      }
    });
    row.append(stop);
  }
  return row;
}

function closeHistoryMenu() {
  document.querySelector(".history-menu")?.remove();
}

function openHistoryMenu(event, payload) {
  event.preventDefault();
  event.stopPropagation();
  closeHistoryMenu();
  const menu = document.createElement("div");
  menu.className = "history-menu";
  const item = document.createElement("button");
  item.type = "button";
  item.textContent = "删除";
  item.addEventListener("click", () => {
    closeHistoryMenu();
    void deleteHistory(payload);
  });
  menu.append(item);
  document.body.append(menu);
  const width = 128;
  const height = 44;
  menu.style.left = `${Math.max(8, Math.min(event.clientX, window.innerWidth - width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(event.clientY, window.innerHeight - height - 8))}px`;
}

async function deleteHistory(payload) {
  const group = payload.groupId ? (state.groups ?? []).find((item) => item.id === payload.groupId) : null;
  const label = group?.title || sessionById(payload.sessionId)?.summary || "这条任务";
  if (!window.confirm(`删除「${label}」？对话记录会一起去掉，不能恢复。`)) return;
  const was = state.activeSessionId;
  try {
    const data = await api("/api/session/delete", { method: "POST", body: JSON.stringify(payload) });
    applyState(data);
    if (was && was !== state.activeSessionId) {
      state.messages = [];
      state.preview = "";
      state.streaming = false;
      state.stdout = "";
      state.asks = [];
      renderMessages();
      renderLive();
      renderStdout();
      renderPermission();
    }
    toast("已删除这条历史任务");
  } catch (error) {
    toast(error.message || "删除失败");
  }
}

function usageItem(label, value) {
  const item = document.createElement("span");
  item.textContent = `${label} `;
  const strong = document.createElement("b");
  strong.textContent = value;
  item.append(strong);
  return item;
}

function groupSessions(group) {
  return (group?.agents ?? []).map((agent) => agentSession(agent)).filter(Boolean);
}

function contextSessions() {
  const group = taskGroup(state.activeSessionId);
  if (group) return groupSessions(group);
  const session = sessionById(state.activeSessionId);
  return session ? [session] : [];
}

function sharedContext(sessions) {
  const list = (sessions ?? []).filter(Boolean);
  if (!list.length) return null;
  const windowSize = list.reduce(
    (size, session) => Math.max(size, Number(session.contextWindow) || 0),
    Number(state.settings?.contextWindow) || 0,
  );
  if (!windowSize) return null;
  const ids = new Set(list.map((session) => session.id));
  const group = (state.groups ?? []).find((item) => item.agents?.length > 1 && item.agents.some((agent) => ids.has(agent.id)));
  let used = 0;
  if (group) {
    const main = list.find((session) => session.id === group.mainId);
    const others = list.filter((session) => session !== main);
    const mainUsed = Math.max(0, Number(main?.activeTokens) || 0);
    const otherUsed = others.reduce((sum, session) => sum + Math.max(0, Number(session.activeTokens) || 0), 0);
    used = mainUsed > 0 ? mainUsed : otherUsed;
  } else {
    used = Math.max(0, Number(list[0]?.activeTokens) || 0);
  }
  return {
    used,
    windowSize,
    percent: Math.min(100, Math.round((used / windowSize) * 100)),
  };
}

function contextMeter(sessions, compact) {
  const snap = sharedContext(sessions);
  if (!snap) return null;
  const meter = document.createElement("div");
  meter.className = compact ? "context-meter" : "context-bar";
  const meta = document.createElement("div");
  meta.className = "context-meta";
  const label = document.createElement("span");
  label.textContent = "上下文";
  const amount = document.createElement("b");
  amount.textContent = compact
    ? `${snap.percent}%`
    : `${formatContextTokens(snap.used)} / ${formatContextTokens(snap.windowSize)}`;
  meta.append(label, amount);
  if (!compact) {
    const pct = document.createElement("span");
    pct.textContent = `${snap.percent}%`;
    meta.append(pct);
  }
  const track = document.createElement("div");
  track.className = "context-track";
  track.setAttribute("role", "meter");
  track.setAttribute("aria-label", "上下文窗口占用");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  track.setAttribute("aria-valuenow", String(snap.percent));
  const fill = document.createElement("div");
  fill.className = "context-fill";
  if (snap.percent >= 90) fill.classList.add("hot");
  else if (snap.percent >= 70) fill.classList.add("warm");
  fill.style.width = `${snap.percent}%`;
  track.append(fill);
  meter.append(meta, track);
  return meter;
}

function renderContextBar() {
  const host = $("#contextBar");
  if (!host) return;
  const meter = contextMeter(contextSessions(), false);
  host.replaceChildren();
  host.hidden = !meter;
  if (meter) host.append(meter);
}

function renderUsageBar() {
  renderContextBar();
  const bar = $("#usageBar");
  if (!bar) return;
  const session = sessionById(state.activeSessionId);
  const usage = session?.usage;
  bar.replaceChildren();
  if (!state.activeSessionId || !usage) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  bar.append(usageItem("合计", formatTokens(usage.total)));
  bar.append(usageItem("输入", formatTokens(usage.prompt)));
  bar.append(usageItem("输出", formatTokens(usage.completion)));
  if (usage.reasoning) bar.append(usageItem("思考", formatTokens(usage.reasoning)));
  if (usage.cacheHit) bar.append(usageItem("缓存命中", formatTokens(usage.cacheHit)));
  if (usage.requests) bar.append(usageItem("请求", String(usage.requests)));
  for (const item of session.usagePerModel ?? []) {
    if ((session.usagePerModel ?? []).length < 2 && !item.model) continue;
    if ((session.usagePerModel ?? []).length >= 2) bar.append(usageItem(item.model, formatTokens(item.total)));
  }
}

const statusNames = {
  processing: "执行中",
  pending: "准备中",
  completed: "已完成",
  failed: "失败",
  interrupted: "已停止",
  ask_permission: "待确认",
  waiting_for_user: "等待回复",
  permission_denied: "已拒绝",
};

function statusText(status) {
  return statusNames[status] || status || "";
}

let runTimer = 0;
let sending = false;
const liveBuffers = new Map();

function liveOf(id) {
  const key = id || "";
  let bucket = liveBuffers.get(key);
  if (!bucket) {
    bucket = { preview: "", streaming: false, stdout: "", startedAt: 0 };
    liveBuffers.set(key, bucket);
  }
  return bucket;
}

function showLive(id) {
  const bucket = liveOf(id);
  state.streaming = bucket.streaming;
  state.preview = bucket.preview;
  state.stdout = bucket.stdout;
  renderLive();
  renderStdout();
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const clock = [minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return hours > 0 ? `${hours}:${clock}` : clock;
}

function currentStep() {
  const tool = [...state.messages].reverse().find((message) => message.role === "tool");
  if (tool) {
    const line = (tool.paramsMd || "").split("\n")[0].slice(0, 72);
    return `${tool.toolName || "工具"}${line ? ` · ${line}` : ""}`;
  }
  return state.streaming ? "正在思考" : "正在执行";
}

function renderRunState() {
  const running = isRunning(state.activeSessionId);
  const bucket = liveOf(state.activeSessionId);
  if (running && !bucket.startedAt) bucket.startedAt = Date.now();
  if (!running) bucket.startedAt = 0;
  state.busy = running;
  const waiting = state.asks.length > 0 && !running;
  const choosing = pendingQuestions().length > 0;
  const others = state.runningIds.filter((id) => id !== state.activeSessionId).length;
  const parallel = others > 0 ? ` · 另有 ${others} 个智能体在跑` : "";
  const pill = $("#taskStatus");
  if (pill) {
    pill.textContent = running ? "执行中" : choosing ? "待选择" : waiting ? "待确认" : others > 0 ? "后台执行中" : "空闲";
    pill.className = `pill${running || others > 0 ? " running" : waiting || choosing ? " waiting" : ""}`;
  }
  const bar = $("#runbar");
  const detail = $("#runDetail");
  if (bar && detail) {
    bar.hidden = !running;
    detail.textContent = running ? `${formatElapsed(Date.now() - bucket.startedAt)} · ${currentStep()}${parallel}` : "";
  }
  const runState = $("#runState");
  if (runState) runState.textContent = "";
  const stop = $("#stop");
  stop.hidden = !running;
  stop.textContent = `停止${stopTargetLabel()}`;
  const group = state.activeSessionId ? taskGroup(state.activeSessionId) : null;
  const mainId = group ? mainAgent(group)?.id || state.activeSessionId : state.activeSessionId;
  const willInterrupt = Boolean(mainId) && isRunning(mainId);
  const send = $("#send");
  send.disabled = sending;
  send.textContent = willInterrupt ? "中断当前回合并发送" : state.activeSessionId && (running || others > 0) ? "发给主智能体" : state.settings?.workMode === "plan" ? "开始规划" : "开始执行";
  if ((running || others > 0) && !runTimer) runTimer = setInterval(renderRunState, 1000);
  if (!running && others === 0 && runTimer) {
    clearInterval(runTimer);
    runTimer = 0;
  }
}

async function loadTree(rel = "") {
  if (state.treeCache.has(rel)) return state.treeCache.get(rel);
  const data = await api(`/api/tree?path=${encodeURIComponent(rel)}`);
  state.treeCache.set(rel, data.entries);
  return data.entries;
}

function fileRow(entry, depth) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `tree-row${entry.type === "dir" ? " dir" : ""}`;
  button.style.paddingLeft = `${8 + depth * 14}px`;
  if (entry.path === state.activePath) button.classList.add("active");
  const twist = document.createElement("span");
  twist.className = "twist";
  twist.textContent = entry.type === "dir" ? (state.expanded.has(entry.path) ? "▾" : "▸") : "";
  const name = document.createElement("span");
  name.textContent = entry.name;
  button.append(twist, name);
  button.addEventListener("click", () => {
    if (entry.type === "dir") {
      if (state.expanded.has(entry.path)) state.expanded.delete(entry.path);
      else state.expanded.add(entry.path);
      void renderTree();
      return;
    }
    void openFile(entry.path);
  });
  return button;
}

let treeToken = 0;

async function renderTree() {
  const token = ++treeToken;
  const root = $("#tree");
  root.replaceChildren();
  if (state.filter.trim().length >= 2) {
    const data = await api(`/api/search?q=${encodeURIComponent(state.filter.trim())}`);
    if (token !== treeToken) return;
    if (data.paths.length === 0) {
      const empty = document.createElement("div");
      empty.className = "tree-row";
      empty.textContent = "没有匹配的文件";
      root.append(empty);
      return;
    }
    if (token !== treeToken) return;
    for (const filePath of data.paths) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "search-hit";
      button.textContent = filePath;
      button.addEventListener("click", () => {
        void openFile(filePath);
      });
      root.append(button);
    }
    return;
  }
  const walk = async (rel, depth) => {
    const entries = await loadTree(rel);
    if (token !== treeToken) return;
    for (const entry of entries) {
      root.append(fileRow(entry, depth));
      if (entry.type === "dir" && state.expanded.has(entry.path)) await walk(entry.path, depth + 1);
    }
  };
  await walk("", 0);
}

function currentTab() {
  return state.tabs.find((tab) => tab.path === state.activePath) ?? null;
}

function renderTabs() {
  const root = $("#tabs");
  root.replaceChildren();
  for (const tab of state.tabs) {
    const item = document.createElement("div");
    item.className = `tab${tab.path === state.activePath ? " active" : ""}`;
    const label = document.createElement("span");
    label.textContent = tab.path.split("/").pop();
    label.title = tab.path;
    item.append(label);
    if (tab.dirty) {
      const mark = document.createElement("i");
      mark.textContent = "●";
      item.append(mark);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.className = "close";
    close.textContent = "×";
    close.addEventListener("click", (event) => {
      event.stopPropagation();
      closeTab(tab.path);
    });
    item.append(close);
    item.addEventListener("click", () => {
      state.activePath = tab.path;
      renderTabs();
      renderEditor();
      void renderTree();
    });
    root.append(item);
  }
}

function renderEditor() {
  const host = $("#editor");
  const tab = currentTab();
  host.replaceChildren();
  if (!tab) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "从上面的文件列表打开。";
    host.append(empty);
    $("#fileMeta").textContent = "";
    return;
  }
  $("#fileMeta").textContent = tab.image ? tab.path : `${tab.path}${tab.dirty ? " · 未保存" : ""}`;
  if (tab.image) {
    const image = document.createElement("img");
    image.className = "preview-image";
    image.alt = tab.path;
    image.src = `/api/raw?path=${encodeURIComponent(tab.path)}`;
    host.append(image);
    return;
  }
  if (tab.binary) {
    const note = document.createElement("div");
    note.className = "binary-note";
    note.textContent = "这是二进制文件，界面里不能编辑。";
    host.append(note);
    return;
  }
  const view = document.createElement("div");
  view.className = "code-view";
  const gutter = document.createElement("pre");
  gutter.className = "gutter";
  const area = document.createElement("textarea");
  area.spellcheck = false;
  area.value = tab.content;
  const paintGutter = () => {
    const count = area.value.split("\n").length;
    gutter.textContent = Array.from({ length: count }, (_, index) => String(index + 1)).join("\n");
  };
  area.addEventListener("scroll", () => {
    gutter.scrollTop = area.scrollTop;
  });
  area.addEventListener("input", () => {
    tab.content = area.value;
    tab.dirty = tab.content !== tab.saved;
    paintGutter();
    renderTabs();
    $("#fileMeta").textContent = `${tab.path}${tab.dirty ? " · 未保存" : ""}`;
  });
  if (tab.conflict) {
    const banner = document.createElement("div");
    banner.className = "file-conflict";
    banner.textContent = "智能体已经改了这个文件，你还有未保存的修改。保存会覆盖智能体的版本。";
    const reload = document.createElement("button");
    reload.type = "button";
    reload.textContent = "重新载入磁盘版本";
    reload.addEventListener("click", () => {
      if (!confirm(`重新载入 ${tab.path}？未保存的修改会丢掉。`)) return;
      void reloadTabFromDisk(tab);
    });
    banner.append(reload);
    host.append(banner);
  }
  area.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void saveTab(tab);
    }
    if (event.key === "Tab") {
      event.preventDefault();
      const start = area.selectionStart;
      area.setRangeText("  ", start, area.selectionEnd, "end");
      area.dispatchEvent(new Event("input"));
    }
  });
  paintGutter();
  view.append(gutter, area);
  host.append(view);
}

async function openFile(filePath) {
  let tab = state.tabs.find((item) => item.path === filePath);
  if (!tab) {
    const data = await api(`/api/file?path=${encodeURIComponent(filePath)}`);
    tab = {
      path: data.path,
      content: data.content ?? "",
      saved: data.content ?? "",
      dirty: false,
      image: Boolean(data.image),
      binary: Boolean(data.binary),
    };
    state.tabs.push(tab);
  }
  state.activePath = tab.path;
  setFilesOpen(true);
  renderTabs();
  renderEditor();
  void renderTree();
}

function openSide(tab) {
  state.sideOpen = true;
  if (tab) state.sideTab = tab;
  renderSide();
}

function closeSide() {
  state.sideOpen = false;
  renderSide();
}

function renderSide() {
  const side = $("#side");
  if (!side) return;
  side.hidden = !state.sideOpen;
  document.querySelector(".app")?.classList.toggle("side-open", state.sideOpen);
  const sideHandle = $("#sideResize");
  if (sideHandle) sideHandle.hidden = !state.sideOpen;
  applyLayoutWidths();
  for (const name of ["task", "edits", "files", "gpu"]) {
    const pane = $(`#pane-${name}`);
    const selected = state.sideTab === name;
    if (pane) pane.hidden = !selected;
    const tab = document.querySelector(`[data-side="${name}"]`);
    if (!tab) continue;
    tab.classList.toggle("active", selected);
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", selected ? "true" : "false");
    tab.tabIndex = selected ? 0 : -1;
  }
  watchGpu();
  renderTaskOverview();
}

function setFilesOpen(open) {
  if (open) openSide("files");
  else closeSide();
}

function planTextFromMessage(message) {
  if (!message) return "";
  if (typeof message.plan === "string" && message.plan.trim()) return message.plan.trim();
  const calls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
  for (let index = calls.length - 1; index >= 0; index -= 1) {
    if (calls[index]?.name !== "UpdatePlan") continue;
    try {
      const args = JSON.parse(calls[index].arguments);
      if (typeof args.plan === "string" && args.plan.trim()) return args.plan.trim();
    } catch {
      // Truncated tool arguments are ignored.
    }
  }
  if (message.toolName === "UpdatePlan" && typeof message.content === "string") {
    try {
      const parsed = JSON.parse(message.content);
      const plan = parsed?.metadata?.plan;
      if (typeof plan === "string" && plan.trim()) return plan.trim();
    } catch {
      // A clipped tool result is not a plan yet.
    }
  }
  return "";
}

function planFromMessages(messages) {
  return latestPlanState(messages).plan;
}

function latestPlanState(messages) {
  const list = messages ?? [];
  let plan = "";
  let planIndex = -1;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const text = planTextFromMessage(list[index]);
    if (!text) continue;
    plan = text;
    planIndex = index;
    break;
  }
  let ticks = 0;
  let action = "";
  for (let index = list.length - 1; index > planIndex; index -= 1) {
    const message = list[index];
    if (message?.role !== "tool" || !message.toolName || message.toolName === "UpdatePlan" || message.toolName === "AskUserQuestion") continue;
    ticks += 1;
    if (!action) {
      const line = String(message.paramsMd || "").split("\n").map((item) => item.trim()).find(Boolean) || "";
      action = line ? `${message.toolName} · ${line.slice(0, 72)}` : message.toolName;
    }
  }
  return { plan, ticks, action };
}

function rememberPlanMessage(sessionId, message) {
  const plan = planTextFromMessage(message);
  if (!sessionId || !plan) return;
  state.plans[sessionId] = plan;
}

function parsePlanSteps(text) {
  const steps = [];
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^\s*[-*+]\s+\[([^\]]+)\]\s+(.+)$/);
    if (!match) continue;
    const mark = match[1].trim();
    let status = "pending";
    if (/^x$/i.test(mark)) status = "done";
    else if (mark === ">") status = "current";
    else if (mark === "!" || mark === "-") status = "blocked";
    const title = match[2].trim();
    if (title) steps.push({ status, title });
  }
  return steps;
}

function planTextFor(sessionId) {
  if (!sessionId) return "";
  if (sessionId === state.activeSessionId) {
    const live = latestPlanState(state.messages);
    if (live.plan) return live.plan;
  }
  return state.plans[sessionId] || "";
}

function currentPartial(ticks) {
  if (ticks <= 0) return 0;
  return Math.min(0.99, 1 - 1 / Math.sqrt(1 + ticks));
}

function stepPercent(status, ticks) {
  if (status === "done") return 100;
  if (status !== "current") return 0;
  if (ticks <= 0) return 0;
  return Math.max(1, Math.round(currentPartial(ticks) * 100));
}

function progressPercent(steps, ticks) {
  if (!steps.length) return 0;
  const done = steps.filter((step) => step.status === "done").length;
  const current = steps.some((step) => step.status === "current");
  if (!current) return Math.round((done / steps.length) * 100);
  return Math.min(99, Math.round(((done + currentPartial(ticks)) / steps.length) * 100));
}

let planFetch = "";
let planFetchedAt = 0;

function loadPlan(sessionId, force = false) {
  if (!sessionId || planFetch === sessionId) return;
  const now = Date.now();
  if (now - planFetchedAt < 1500) return;
  if (!force && Object.hasOwn(state.plans, sessionId)) return;
  planFetch = sessionId;
  planFetchedAt = now;
  api(`/api/task-plan?sessionId=${encodeURIComponent(sessionId)}`)
    .then((data) => {
      const plan = typeof data.plan === "string" ? data.plan : "";
      const changed = state.plans[sessionId] !== plan;
      state.plans[sessionId] = plan;
      planFetch = "";
      if (changed) renderTaskOverview();
    })
    .catch(() => {
      planFetch = "";
    });
}

function renderTaskOverview() {
  const root = $("#taskOverview");
  if (!root) return;
  const active = state.activeSessionId;
  const group = taskGroup(active);
  const owner = group ? mainAgent(group)?.id || active : active;
  const title = group?.title || sessionById(active)?.summary || "当前任务";
  const live = owner === active ? latestPlanState(state.messages) : { plan: "", ticks: 0, action: "" };
  if (owner && (isRunning(owner) || owner !== active)) loadPlan(owner, isRunning(owner));
  const steps = parsePlanSteps(state.plans[owner] || live.plan || planTextFor(owner));
  const done = steps.filter((step) => step.status === "done").length;
  const pending = steps.filter((step) => step.status === "pending").length;
  const currentIndex = steps.findIndex((step) => step.status === "current");
  const ticks = live.ticks || 0;
  const percent = progressPercent(steps, ticks);
  const signature = `${owner}|${state.taskExpanded ? 1 : 0}|${percent}|${ticks}|${live.action}|${steps.map((step) => `${step.status}:${step.title}`).join("\n")}`;
  if (root.dataset.signature === signature) return;
  root.dataset.signature = signature;
  root.replaceChildren();
  if (!active) {
    const empty = document.createElement("p");
    empty.className = "task-empty";
    empty.textContent = "还没有打开的任务";
    root.append(empty);
    return;
  }
  const fold = document.createElement("button");
  fold.type = "button";
  fold.className = "task-fold";
  fold.setAttribute("aria-expanded", state.taskExpanded ? "true" : "false");
  const head = document.createElement("div");
  head.className = "task-fold-head";
  const name = document.createElement("strong");
  name.textContent = title;
  const percentLabel = document.createElement("span");
  percentLabel.textContent = `${percent}%`;
  head.append(name, percentLabel);
  const meter = document.createElement("div");
  meter.className = "task-meter";
  meter.setAttribute("role", "progressbar");
  meter.setAttribute("aria-valuemin", "0");
  meter.setAttribute("aria-valuemax", "100");
  meter.setAttribute("aria-valuenow", String(percent));
  const fill = document.createElement("span");
  const overall = steps.some((step) => step.status === "current")
    ? Math.min(99, ((done + currentPartial(ticks)) / steps.length) * 100)
    : percent;
  fill.style.width = `${steps.length ? overall : 0}%`;
  meter.append(fill);
  fold.append(head, meter);
  fold.addEventListener("click", () => {
    state.taskExpanded = !state.taskExpanded;
    root.dataset.signature = "";
    renderTaskOverview();
  });
  root.append(fold);
  if (!state.taskExpanded) return;
  if (!steps.length) {
    const empty = document.createElement("p");
    empty.className = "task-empty";
    empty.textContent = "当前任务还没有步骤清单";
    root.append(empty);
    return;
  }
  const summary = document.createElement("p");
  summary.className = "task-summary";
  const parts = [`共 ${steps.length} 步`, `已完成 ${done} 步`, `未执行 ${pending} 步`];
  if (currentIndex >= 0) parts.unshift(`正在执行第 ${currentIndex + 1} 步`);
  summary.textContent = parts.join(" · ");
  const list = document.createElement("ol");
  list.className = "task-steps";
  steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = `task-step ${step.status}`;
    const mark = document.createElement("i");
    mark.textContent = String(index + 1);
    const body = document.createElement("div");
    const label = document.createElement("b");
    label.textContent = step.title;
    const stepValue = stepPercent(step.status, ticks);
    const head = document.createElement("div");
    head.className = "task-step-head";
    const stepPercentLabel = document.createElement("span");
    stepPercentLabel.textContent = step.status === "current" && ticks > 0 ? `${stepValue}% · ${ticks}` : `${stepValue}%`;
    head.append(label, stepPercentLabel);
    const stepMeter = document.createElement("div");
    stepMeter.className = "task-meter";
    stepMeter.setAttribute("role", "progressbar");
    stepMeter.setAttribute("aria-valuemin", "0");
    stepMeter.setAttribute("aria-valuemax", "100");
    stepMeter.setAttribute("aria-valuenow", String(stepValue));
    const stepFill = document.createElement("span");
    const stepWidth = step.status === "done" ? 100 : step.status === "current" ? currentPartial(ticks) * 100 : 0;
    stepFill.style.width = `${stepWidth}%`;
    stepMeter.append(stepFill);
    const status = document.createElement("small");
    const currentText = step.status !== "current" ? "" : live.action ? `正在执行 · ${live.action}` : ticks ? `正在执行 · 已推进 ${ticks} 项` : "正在执行";
    status.textContent = step.status === "done" ? "已完成" : step.status === "current" ? currentText : step.status === "blocked" ? "未完成" : "未执行";
    body.append(head, stepMeter, status);
    item.append(mark, body);
    list.append(item);
  });
  root.append(summary, list);
}

function closeTab(filePath) {
  const tab = state.tabs.find((item) => item.path === filePath);
  if (tab?.dirty && !confirm(`关闭 ${filePath}？未保存的修改会丢掉。`)) return;
  state.tabs = state.tabs.filter((item) => item.path !== filePath);
  if (state.activePath === filePath) state.activePath = state.tabs.at(-1)?.path ?? null;
  renderTabs();
  renderEditor();
  void renderTree();
}

async function saveTab(tab) {
  if (!tab || tab.image || tab.binary) return;
  await api("/api/file", { method: "PUT", body: JSON.stringify({ path: tab.path, content: tab.content }) });
  tab.saved = tab.content;
  tab.dirty = false;
  tab.conflict = false;
  renderTabs();
  renderEditor();
  toast("已保存");
}

async function reloadTabFromDisk(tab) {
  const data = await api(`/api/file?path=${encodeURIComponent(tab.path)}`);
  if (typeof data.content !== "string") return;
  tab.content = data.content;
  tab.saved = data.content;
  tab.dirty = false;
  tab.conflict = false;
  renderTabs();
  renderEditor();
}

async function refreshOpenFile() {
  const tab = currentTab();
  if (!tab || tab.dirty || tab.image || tab.binary) return;
  try {
    const data = await api(`/api/file?path=${encodeURIComponent(tab.path)}`);
    if (typeof data.content === "string") {
      tab.content = data.content;
      tab.saved = data.content;
      renderEditor();
    }
  } catch {
    // The file may have been removed by the agent.
  }
}

function transcriptKey(message, firstUser, showOutput) {
  const reasoning = message.reasoning ? String(message.reasoning).length : 0;
  const content = message.role === "user" || showOutput ? String(message.content || "").length : 0;
  return `${message.id}:${firstUser ? 1 : 0}:${showOutput ? 1 : 0}:${reasoning}:${content}`;
}

function visibleTranscript(messages) {
  const outputId = isRunning(state.activeSessionId) ? "" : lastAnswerId(messages);
  const items = [];
  let seenUser = false;
  for (const message of messages) {
    const firstUser = message.role === "user" && !seenUser;
    if (message.role === "user") seenUser = true;
    const showOutput = message.id === outputId;
    if (message.role === "tool" || (message.role !== "user" && !message.reasoning && !showOutput)) continue;
    items.push({ message, firstUser, showOutput, key: transcriptKey(message, firstUser, showOutput) });
  }
  return items;
}

function renderMessages() {
  const job = ++messageRenderJob;
  renderEdits();
  const root = $("#transcript");
  const stick = root.scrollHeight - root.scrollTop - root.clientHeight < 90;
  const sessionKey = state.activeSessionId || "";
  if (root.dataset.session !== sessionKey) {
    root.dataset.session = sessionKey;
    root.replaceChildren();
    root.dataset.mode = "";
  }
  const items = visibleTranscript(state.messages);
  if (items.length === 0) {
    root.replaceChildren();
    root.dataset.mode = "empty";
    const empty = document.createElement("div");
    empty.className = "hero";
    const title = document.createElement("h1");
    title.textContent = "交给 DeepSeek";
    const copy = document.createElement("p");
    copy.textContent = "描述目标后会自动做完。一个任务只有一个主智能体，需要分出去的工作才由它安排子智能体。";
    empty.append(title, copy);
    root.append(empty);
    return;
  }
  if (root.dataset.mode !== "messages") root.replaceChildren();
  root.dataset.mode = "messages";
  let match = 0;
  while (match < root.children.length && match < items.length && root.children[match].dataset.key === items[match].key) match += 1;
  while (root.children.length > match) root.lastChild.remove();
  let index = match;
  const append = () => {
    if (job !== messageRenderJob) return false;
    if (index >= items.length) {
      if (stick) root.scrollTop = root.scrollHeight;
      return false;
    }
    const item = items[index];
    index += 1;
    const node = renderMessage(item.message, item.firstUser, item.showOutput);
    if (!node) return true;
    node.dataset.key = item.key;
    root.append(node);
    return true;
  };
  if (items.length - match <= 3) {
    while (append()) {}
  } else {
    frameWork(append);
  }
}

const editTools = new Set(["write", "edit"]);
let messageRenderJob = 0;
let editRenderJob = 0;

function isFileEdit(message) {
  return message?.role === "tool" && editTools.has(message.toolName);
}

function fileChangeFromMessage(message) {
  if (!message || message.role !== "tool" || (message.toolName !== "write" && message.toolName !== "edit")) return null;
  let filePath = typeof message.filePath === "string" ? message.filePath : "";
  let diff = typeof message.diff === "string" ? message.diff : "";
  if (!filePath && typeof message.content === "string") {
    try {
      const parsed = JSON.parse(message.content);
      if (typeof parsed?.metadata?.file_path === "string") filePath = parsed.metadata.file_path;
      if (typeof parsed?.metadata?.diff_preview === "string") diff = parsed.metadata.diff_preview;
    } catch {
      // A clipped tool result still falls back to the parameter path.
    }
  }
  if (!filePath && typeof message.paramsMd === "string" && message.paramsMd.trim() && !message.paramsMd.includes("\n")) filePath = message.paramsMd.trim();
  if (!filePath) return null;
  return { id: message.id, filePath, diff };
}

function sameFile(left, right) {
  const a = String(left || "").replace(/\\/g, "/");
  const b = String(right || "").replace(/\\/g, "/");
  if (!a || !b) return false;
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

const revertedAt = new Map();

function fileChanges(messages) {
  const byPath = new Map();
  for (const message of messages) {
    const change = fileChangeFromMessage(message);
    if (!change) continue;
    const current = byPath.get(change.filePath) || { ...change, count: 0 };
    current.count += 1;
    current.id = change.id;
    current.diff = change.diff || current.diff;
    byPath.set(change.filePath, current);
  }
  return [...byPath.values()];
}

function noteAgentFileChange(message) {
  const change = fileChangeFromMessage(message);
  if (!change) return;
  revertedAt.delete(change.filePath);
  const tab = state.tabs.find((item) => sameFile(item.path, change.filePath));
  if (!tab) return;
  const name = change.filePath.split("/").pop();
  if (tab.dirty) {
    const already = tab.conflict;
    tab.conflict = true;
    toast(`智能体改了 ${name}，你还有未保存的修改`);
    if (!already && state.activePath === tab.path) renderEditor();
    return;
  }
  if (state.activePath === tab.path) void refreshOpenFile();
}

function appendDiff(pre, diff) {
  if (!diff) {
    const empty = document.createElement("div");
    empty.className = "diff-meta";
    empty.textContent = "没有可显示的差异";
    pre.append(empty);
    return;
  }
  for (const line of diff.split("\n")) {
    const row = document.createElement("div");
    if (line.startsWith("+") && !line.startsWith("+++")) row.className = "diff-add";
    else if (line.startsWith("-") && !line.startsWith("---")) row.className = "diff-del";
    else row.className = "diff-meta";
    row.textContent = line || " ";
    pre.append(row);
  }
}

function renderFileChanges() {
  const host = $("#fileChanges");
  if (!host) return;
  const sessionKey = state.activeSessionId || "";
  if (host.dataset.session !== sessionKey) {
    host.dataset.session = sessionKey;
    host.dataset.signature = "";
    host.replaceChildren();
  }
  const files = fileChanges(state.messages);
  const signature = files.map((file) => `${file.filePath}:${file.count}:${file.diff.length}:${revertedAt.get(file.filePath) === file.id ? 1 : 0}`).join("\n");
  if (host.dataset.signature === signature) return;
  host.dataset.signature = signature;
  host.replaceChildren();
  for (const file of files) {
    const card = document.createElement("article");
    card.className = "file-change";
    const head = document.createElement("div");
    head.className = "file-change-head";
    const title = document.createElement("strong");
    title.textContent = file.filePath.split("/").pop() || file.filePath;
    title.title = file.filePath;
    const count = document.createElement("span");
    count.textContent = `${file.count} 次`;
    head.append(title, count, fileButton(file.filePath));
    const revert = document.createElement("button");
    revert.type = "button";
    const reverted = revertedAt.get(file.filePath) === file.id;
    revert.textContent = reverted ? "已退回" : "退回改动前";
    revert.disabled = reverted;
    revert.addEventListener("click", () => {
      void revertFile(file);
    });
    head.append(revert);
    const diff = document.createElement("pre");
    diff.className = "diff";
    appendDiff(diff, file.diff);
    card.append(head, diff);
    host.append(card);
  }
}

async function revertFile(file) {
  const name = file.filePath.split("/").pop() || file.filePath;
  const running = isRunning(state.activeSessionId);
  const warning = running ? "这个任务还在执行，退回后可能被再次改写。" : "";
  if (!confirm(`把「${name}」退回到这次改动之前？${warning}`)) return;
  try {
    await api("/api/revert-file", {
      method: "POST",
      body: JSON.stringify({ sessionId: state.activeSessionId, path: file.filePath }),
    });
    revertedAt.set(file.filePath, file.id);
    const tab = state.tabs.find((item) => sameFile(item.path, file.filePath));
    if (tab && !tab.dirty) await reloadTabFromDisk(tab);
    else if (tab) {
      tab.conflict = true;
      if (state.activePath === tab.path) renderEditor();
    }
    renderFileChanges();
    toast(`已退回 ${name}`);
  } catch (error) {
    toast(error.message);
  }
}

function editPieces(messages) {
  const pieces = [];
  for (const message of messages) {
    if (message.role === "assistant" && String(message.content || "").trim()) {
      pieces.push({
        key: `${message.id}:text:${String(message.content).length}`,
        kind: "text",
        text: message.content,
      });
    }
    if (message.role !== "tool") continue;
    if (message.toolName === "AskUserQuestion") continue;
    const change = fileChangeFromMessage(message);
    if (isFileEdit(message)) {
      pieces.push({
        key: `${message.id}:file:${change?.filePath || ""}:${String(message.resultMd || "").length}`,
        kind: "file",
        title: change ? change.filePath.split("/").pop() : mentionedPath(message.paramsMd) || toolLabel(message.toolName),
        path: change?.filePath || "",
        text: message.resultMd || "",
      });
      continue;
    }
    const headline = (message.paramsMd || "").split("\n")[0].slice(0, 160);
    pieces.push({
      key: `${message.id}:tool:${String(message.resultMd || message.content || "").length}`,
      kind: "tool",
      title: `${toolLabel(message.toolName)}${headline ? ` · ${headline}` : ""}`,
      text: message.resultMd || message.content || "",
      path: mentionedPath(message.paramsMd),
    });
  }
  return pieces;
}

function renderEdits() {
  const list = $("#editList");
  if (!list) return;
  renderFileChanges();
  const job = ++editRenderJob;
  const sessionKey = state.activeSessionId || "";
  if (list.dataset.session !== sessionKey) {
    list.dataset.session = sessionKey;
    list.replaceChildren();
  }
  const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 90;
  const pieces = editPieces(state.messages);
  if (pieces.length === 0) {
    list.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "还没有编辑内容。";
    list.append(empty);
    return;
  }
  if (list.querySelector(".empty")) list.replaceChildren();
  if (!state.sideOpen) openSide("edits");
  let match = 0;
  while (match < list.children.length && match < pieces.length && list.children[match].dataset.key === pieces[match].key) match += 1;
  while (list.children.length > match) list.lastChild.remove();
  let index = match;
  const append = () => {
    if (job !== editRenderJob) return false;
    if (index >= pieces.length) {
      if (stick) list.scrollTop = list.scrollHeight;
      return false;
    }
    const piece = pieces[index];
    index += 1;
    const card = createEditCard(piece, viewGeneration);
    card.dataset.key = piece.key;
    list.append(card);
    return true;
  };
  if (pieces.length - match <= 3) {
    while (append()) {}
  } else {
    frameWork(append);
  }
}

function createEditCard(piece, generation) {
  const card = document.createElement("article");
  card.className = "edit-card";
  if (piece.kind === "file") {
    const path = document.createElement("div");
    path.className = "edit-path";
    path.textContent = piece.title;
    if (piece.path) path.append(fileButton(piece.path));
    card.append(path);
    mountMarkdown(card, piece.text, generation);
  } else if (piece.kind === "tool") {
    const details = document.createElement("details");
    details.className = "tool";
    const summary = document.createElement("summary");
    summary.textContent = piece.title;
    if (piece.path) summary.append(fileButton(piece.path));
    details.append(summary);
    details.addEventListener("toggle", () => {
      if (!details.open || details.dataset.ready) return;
      details.dataset.ready = "1";
      mountMarkdown(details, piece.text, generation);
    });
    card.append(details);
  } else {
    mountMarkdown(card, piece.text, generation);
  }
  return card;
}

let gpuTimer = 0;
let gpuWatchId = "";
const gpuSeqs = {};
const gpuExpanded = new Set();

function watchGpu() {
  const ids = state.sideOpen && state.sideTab === "gpu" ? (state.gpu?.servers ?? []).map((server) => server.id).join(",") : "";
  if (gpuTimer && gpuWatchId === ids) return;
  clearInterval(gpuTimer);
  gpuTimer = 0;
  gpuWatchId = ids;
  if (!ids) return;
  void refreshGpuStatus();
  gpuTimer = setInterval(() => {
    void refreshGpuStatus();
  }, 5000);
}

function formatGib(mib) {
  if (mib == null) return "—";
  if (mib >= 1024) return `${(mib / 1024).toFixed(1)} GB`;
  return `${Math.round(mib)} MB`;
}

function formatWatt(value) {
  if (value == null) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(1)} kW`;
  return `${Math.round(value)} W`;
}

function shortGpuName(name) {
  return String(name || "").replace(/^NVIDIA\s+GeForce\s+/i, "").replace(/^NVIDIA\s+/i, "");
}

function sumMetric(gpus, key) {
  let total = 0;
  let any = false;
  for (const device of gpus) {
    if (device[key] == null) continue;
    total += device[key];
    any = true;
  }
  return any ? total : null;
}

function meterClass(percent) {
  if (percent == null) return "gpu-meter";
  if (percent >= 90) return "gpu-meter hot";
  if (percent >= 70) return "gpu-meter warn";
  return "gpu-meter";
}

function metricRow(label, percent, value) {
  const name = document.createElement("span");
  name.textContent = label;
  const meter = document.createElement("div");
  meter.className = meterClass(percent);
  const bar = document.createElement("span");
  bar.style.width = `${Math.max(0, Math.min(100, percent ?? 0))}%`;
  meter.append(bar);
  const text = document.createElement("b");
  text.textContent = value;
  return [name, meter, text];
}

function deviceBlock(device) {
  const block = document.createElement("div");
  block.className = "gpu-device";
  const name = document.createElement("strong");
  name.textContent = `GPU ${device.index ?? 0} · ${device.name}`;
  const grid = document.createElement("div");
  grid.className = "gpu-metrics";
  const memoryPercent = device.memoryUsed != null && device.memoryTotal ? Math.round((device.memoryUsed / device.memoryTotal) * 100) : device.memoryUtilization;
  const powerPercent = device.power != null && device.powerLimit ? Math.round((device.power / device.powerLimit) * 100) : null;
  grid.append(
    ...metricRow("利用率", device.utilization, device.utilization == null ? "—" : `${device.utilization}%`),
    ...metricRow("显存", memoryPercent, `${formatGib(device.memoryUsed)} / ${formatGib(device.memoryTotal)}`),
    ...metricRow("功耗", powerPercent, device.power == null ? "—" : `${Math.round(device.power)} / ${device.powerLimit == null ? "—" : Math.round(device.powerLimit)} W`),
  );
  const bits = [];
  if (device.temperature != null) bits.push(`温度 ${Math.round(device.temperature)}°C`);
  if (device.fan != null) bits.push(`风扇 ${Math.round(device.fan)}%`);
  if (device.driver) bits.push(`驱动 ${device.driver}`);
  block.append(name, grid);
  if (bits.length) {
    const extra = document.createElement("p");
    extra.textContent = bits.join(" · ");
    block.append(extra);
  }
  return block;
}

function overviewLine(gpus) {
  const names = [...new Set(gpus.map((device) => shortGpuName(device.name)).filter(Boolean))];
  const utils = gpus.map((device) => device.utilization).filter((value) => value != null);
  const used = sumMetric(gpus, "memoryUsed");
  const total = sumMetric(gpus, "memoryTotal");
  const power = sumMetric(gpus, "power");
  const temps = gpus.map((device) => device.temperature).filter((value) => value != null);
  const kind = names.length === 1 ? ` ${names[0]}` : "";
  const utilText = !utils.length ? "—" : Math.min(...utils) === Math.max(...utils) ? `${Math.round(utils[0])}%` : `${Math.round(Math.min(...utils))}–${Math.round(Math.max(...utils))}%`;
  const parts = [`${gpus.length} 张${kind}`, `利用率 ${utilText}`, `显存 ${formatGib(used)} / ${formatGib(total)}`, `功耗 ${formatWatt(power)}`];
  if (temps.length) parts.push(`最高 ${Math.round(Math.max(...temps))}°C`);
  return parts.join(" · ");
}

function paintGpuFold(id) {
  const fold = document.querySelector(`[data-gpu="${CSS.escape(id)}"] .gpu-fold`);
  if (!fold) return;
  const live = state.gpuLives?.[id];
  const open = gpuExpanded.has(id);
  fold.replaceChildren();
  if (!live || live.loading) {
    const pending = document.createElement("p");
    pending.className = "gpu-error";
    pending.textContent = "正在读取利用率、显存和功耗…";
    fold.append(pending);
    return;
  }
  if (live.error) {
    const error = document.createElement("p");
    error.className = "gpu-error";
    error.textContent = live.error;
    fold.append(error);
    return;
  }
  if (!live.gpus?.length) {
    const empty = document.createElement("p");
    empty.className = "gpu-error";
    empty.textContent = "没有读到 GPU。";
    fold.append(empty);
    return;
  }
  if (!open) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gpu-overview";
    const pips = document.createElement("div");
    pips.className = "gpu-pips";
    for (const device of live.gpus) {
      const pip = document.createElement("i");
      const percent = device.utilization;
      pip.className = percent >= 90 ? "hot" : percent >= 70 ? "warn" : "";
      pip.title = `GPU ${device.index ?? 0} 利用率 ${percent == null ? "—" : `${percent}%`}`;
      const bar = document.createElement("span");
      bar.style.width = `${Math.max(0, Math.min(100, percent ?? 0))}%`;
      pip.append(bar);
      pips.append(pip);
    }
    const summary = document.createElement("p");
    summary.textContent = overviewLine(live.gpus);
    button.append(pips, summary);
    button.addEventListener("click", () => toggleGpu(id));
    fold.append(button);
    return;
  }
  const detail = document.createElement("div");
  detail.className = "gpu-detail";
  for (const device of live.gpus) detail.append(deviceBlock(device));
  fold.append(detail);
}

function toggleGpu(id) {
  if (gpuExpanded.has(id)) gpuExpanded.delete(id);
  else gpuExpanded.add(id);
  const card = document.querySelector(`[data-gpu="${CSS.escape(id)}"]`);
  card?.classList.toggle("open", gpuExpanded.has(id));
  const button = card?.querySelector(".gpu-toggle");
  if (button) {
    button.textContent = gpuExpanded.has(id) ? "折叠" : "展开";
    button.setAttribute("aria-expanded", gpuExpanded.has(id) ? "true" : "false");
  }
  paintGpuFold(id);
}

async function refreshOneGpu(id) {
  const seq = (gpuSeqs[id] = (gpuSeqs[id] || 0) + 1);
  const prev = state.gpuLives?.[id];
  if (!prev || (!prev.gpus?.length && !prev.error)) {
    state.gpuLives = { ...state.gpuLives, [id]: { id, loading: true, gpus: [], error: "" } };
    paintGpuFold(id);
  }
  try {
    const data = await api(`/api/gpu-status?id=${encodeURIComponent(id)}`);
    if (gpuSeqs[id] !== seq) return;
    state.gpuLives = { ...state.gpuLives, [id]: data };
  } catch (error) {
    if (gpuSeqs[id] !== seq) return;
    state.gpuLives = { ...state.gpuLives, [id]: { id, gpus: [], error: error.message, checkedAt: "" } };
  }
  paintGpuFold(id);
}

async function refreshGpuStatus() {
  if (!(state.sideOpen && state.sideTab === "gpu")) return;
  const servers = state.gpu?.servers ?? [];
  await Promise.all(servers.map((server) => refreshOneGpu(server.id)));
}

function paintGpuOccupy() {
  for (const card of document.querySelectorAll("[data-gpu]")) {
    const slot = card.querySelector(".gpu-occupy");
    if (!slot) continue;
    const mine = (state.gpuTasks ?? []).filter((task) => task.serverId === card.dataset.gpu);
    slot.replaceChildren();
    if (!mine.length) {
      const idle = document.createElement("p");
      idle.className = "gpu-occupy-idle";
      idle.textContent = "无任务占用";
      slot.append(idle);
      continue;
    }
    for (const task of mine) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gpu-occupy-task";
      button.textContent = `${task.title || "任务"} ${task.state === "queued" ? "排队" : "正在使用"}`;
      button.disabled = !task.sessionId;
      button.addEventListener("click", () => {
        if (task.sessionId) void openSession(task.sessionId);
      });
      slot.append(button);
    }
  }
}

function gpuSignature(gpu) {
  return `${gpu.activeId}|${(gpu.servers ?? []).map((server) => [server.id, server.name, server.host, server.port, server.user, server.note, server.auth].join("~")).join(";")}`;
}

function renderGpu() {
  const list = $("#gpuList");
  if (!list) return;
  const gpu = state.gpu ?? { activeId: "", servers: [] };
  const signature = gpuSignature(gpu);
  if (list.dataset.signature === signature && list.querySelector("[data-gpu], .empty")) {
    paintGpuOccupy();
    watchGpu();
    return;
  }
  list.dataset.signature = signature;
  list.replaceChildren();
  if (!gpu.servers.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "还没有 GPU 服务器。添加后会在这里显示利用率、显存和功耗。";
    list.append(empty);
    watchGpu();
    return;
  }
  for (const server of gpu.servers) {
    const card = document.createElement("article");
    const current = server.id === gpu.activeId;
    const open = gpuExpanded.has(server.id);
    card.dataset.gpu = server.id;
    card.className = current ? "gpu-card current" : "gpu-card";
    if (open) card.classList.add("open");
    const head = document.createElement("header");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "gpu-toggle";
    toggle.textContent = open ? "折叠" : "展开";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.addEventListener("click", () => toggleGpu(server.id));
    const title = document.createElement("strong");
    title.textContent = server.name;
    head.append(toggle, title);
    if (current) {
      const badge = document.createElement("span");
      badge.className = "ws-badge";
      badge.textContent = "使用中";
      head.append(badge);
    }
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "gpu-refresh";
    refresh.textContent = "刷新";
    refresh.addEventListener("click", () => {
      void refreshOneGpu(server.id);
    });
    head.append(refresh);
    const address = document.createElement("p");
    const authLabel = server.auth === "key" ? "密钥" : server.auth === "password" ? "密码" : "";
    address.textContent = `${server.user ? `${server.user}@` : ""}${server.host}:${server.port}${authLabel ? ` · ${authLabel}` : ""}`;
    const fold = document.createElement("div");
    fold.className = "gpu-fold";
    card.append(head, address);
    if (server.note) {
      const note = document.createElement("p");
      note.textContent = server.note;
      card.append(note);
    }
    const occupy = document.createElement("div");
    occupy.className = "gpu-occupy";
    card.append(occupy);
    const actions = document.createElement("div");
    actions.className = "actions";
    if (!current) {
      const use = document.createElement("button");
      use.type = "button";
      use.textContent = "使用";
      use.addEventListener("click", () => {
        void selectGpu(server.id);
      });
      actions.append(use);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "移除";
    remove.addEventListener("click", () => {
      void removeGpu(server.id);
    });
    actions.append(remove);
    card.append(actions, fold);
    list.append(card);
    paintGpuFold(server.id);
  }
  paintGpuOccupy();
  watchGpu();
}

async function selectGpu(id) {
  const data = await api("/api/gpu-servers/select", { method: "POST", body: JSON.stringify({ id }) });
  state.gpu = data.gpu;
  renderGpu();
}

async function removeGpu(id) {
  const data = await api("/api/gpu-servers/remove", { method: "POST", body: JSON.stringify({ id }) });
  state.gpu = data.gpu;
  gpuExpanded.delete(id);
  delete gpuSeqs[id];
  if (state.gpuLives) delete state.gpuLives[id];
  renderGpu();
}

const toolLabels = {
  bash: "运行命令",
  read: "读取文件",
  write: "写入文件",
  edit: "修改文件",
  grep: "搜索内容",
  glob: "查找文件",
  skill: "使用技能",
};

function toolLabel(name) {
  return toolLabels[name] || name || "步骤";
}

function mentionedPath(text) {
  const match = String(text || "").match(/[A-Za-z0-9_@./-]+\.[A-Za-z0-9]{1,8}/);
  return match ? match[0].replace(/^\.?\//, "") : "";
}

function fileButton(filePath) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "file-link";
  button.textContent = "打开";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void openFile(filePath).catch((error) => toast(error.message));
  });
  return button;
}

function lastAnswerId(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && String(message.content || "").trim()) return message.id;
  }
  return "";
}

function renderMessage(message, firstUser = false, showOutput = false) {
  const item = document.createElement("article");
  item.className = "msg";
  if (message.role === "user") {
    item.className = firstUser ? "goal" : "follow";
    item.textContent = message.content || "";
    return item;
  }
  if (message.role === "tool" || (!message.reasoning && !showOutput)) return null;
  const who = document.createElement("div");
  who.className = "who";
  who.textContent = "DeepSeek";
  item.append(who);
  if (message.reasoning) {
    const thinking = document.createElement("details");
    thinking.className = "thinking";
    const summary = document.createElement("summary");
    summary.textContent = "思考";
    const body = document.createElement("div");
    body.textContent = message.reasoning;
    thinking.append(summary, body);
    item.append(thinking);
  }
  if (showOutput) {
    const result = document.createElement("section");
    result.className = "final-output";
    const label = document.createElement("div");
    label.className = "who";
    label.textContent = "结果";
    result.append(label);
    mountMarkdown(result, message.content, viewGeneration);
    item.append(result);
  }
  return item;
}

function renderLive() {
  const live = $("#live");
  live.hidden = !state.streaming;
  live.textContent = state.preview || "正在思考…";
  if (state.streaming) {
    const transcript = $("#transcript");
    if (transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 90) transcript.scrollTop = transcript.scrollHeight;
  }
}

function renderStdout() {
  const center = $("#stdout");
  if (center) center.hidden = true;
  const el = $("#editStdout");
  if (!el) return;
  el.hidden = !state.stdout;
  el.textContent = state.stdout;
  if (state.stdout && !state.sideOpen) openSide("edits");
  if (state.stdout) el.scrollTop = el.scrollHeight;
}

function parseAskQuestions(content) {
  if (!content) return [];
  try {
    const parsed = JSON.parse(content);
    if (parsed?.awaitUserResponse !== true || parsed?.metadata?.kind !== "ask_user_question") return [];
    const raw = parsed.metadata.questions;
    if (!Array.isArray(raw)) return [];
    const questions = [];
    for (const item of raw) {
      const question = typeof item?.question === "string" ? item.question.trim() : "";
      const options = Array.isArray(item?.options)
        ? item.options
            .map((option) => ({
              label: typeof option?.label === "string" ? option.label.trim() : "",
              description: typeof option?.description === "string" ? option.description.trim() : "",
            }))
            .filter((option) => option.label)
        : [];
      if (!question || !options.length) continue;
      questions.push({ question, multiSelect: item.multiSelect === true, options });
    }
    return questions;
  } catch {
    return [];
  }
}

function pendingQuestions() {
  const session = sessionById(state.activeSessionId);
  if (!session || session.status !== "waiting_for_user" || isRunning(session.id)) return [];
  for (let index = state.messages.length - 1; index >= 0; index -= 1) {
    const message = state.messages[index];
    if (!message || message.role !== "tool") continue;
    const questions = parseAskQuestions(message.content);
    if (questions.length) return questions;
    if (message.toolName && message.toolName !== "AskUserQuestion") break;
  }
  return [];
}

function questionPick(question) {
  if (!state.questionPicks[question]) state.questionPicks[question] = { labels: [], other: false, text: "" };
  return state.questionPicks[question];
}

function answerFor(question) {
  const pick = state.questionPicks[question];
  if (!pick) return "";
  if (pick.other) return pick.text.trim();
  return pick.labels.join(", ");
}

function renderQuestions() {
  const host = $("#questions");
  if (!host) return;
  const questions = pendingQuestions();
  const signature = questions.map((item) => item.question).join("\n");
  if (!questions.length) {
    host.hidden = true;
    host.dataset.signature = "";
    host.replaceChildren();
    return;
  }
  if (host.dataset.signature === signature && !host.hidden) return;
  host.dataset.signature = signature;
  host.hidden = false;
  host.replaceChildren();
  const title = document.createElement("h3");
  title.textContent = "需要你选择后才能继续";
  host.append(title);
  for (const item of questions) {
    const block = document.createElement("section");
    block.className = "question-block";
    const prompt = document.createElement("p");
    prompt.textContent = item.question;
    block.append(prompt);
    const options = document.createElement("div");
    options.className = "question-options";
    const otherInput = document.createElement("input");
    otherInput.className = "question-other";
    otherInput.placeholder = "输入其他答案";
    otherInput.hidden = true;
    const paint = () => {
      const pick = questionPick(item.question);
      for (const button of options.querySelectorAll(".question-option")) {
        const label = button.dataset.label || "";
        const selected = label === "其他" ? pick.other : pick.labels.includes(label);
        button.classList.toggle("selected", selected);
      }
      otherInput.hidden = !pick.other;
      if (pick.other && document.activeElement !== otherInput) otherInput.value = pick.text;
    };
    for (const option of item.options) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "question-option";
      button.dataset.label = option.label;
      const name = document.createElement("strong");
      name.textContent = option.label;
      button.append(name);
      if (option.description) {
        const detail = document.createElement("small");
        detail.textContent = option.description;
        button.append(detail);
      }
      button.addEventListener("click", () => {
        const pick = questionPick(item.question);
        if (item.multiSelect) {
          pick.other = false;
          pick.labels = pick.labels.includes(option.label)
            ? pick.labels.filter((label) => label !== option.label)
            : [...pick.labels, option.label];
        } else {
          pick.other = false;
          pick.labels = [option.label];
        }
        paint();
      });
      options.append(button);
    }
    const other = document.createElement("button");
    other.type = "button";
    other.className = "question-option";
    other.dataset.label = "其他";
    other.textContent = "其他";
    other.addEventListener("click", () => {
      const pick = questionPick(item.question);
      pick.other = true;
      pick.labels = [];
      paint();
      otherInput.focus();
    });
    options.append(other);
    otherInput.addEventListener("input", () => {
      questionPick(item.question).text = otherInput.value;
    });
    block.append(options, otherInput);
    host.append(block);
    paint();
  }
  const actions = document.createElement("div");
  actions.className = "actions";
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "send";
  submit.textContent = "继续执行";
  submit.addEventListener("click", () => {
    void submitAnswers(questions);
  });
  actions.append(submit);
  host.append(actions);
}

async function submitAnswers(questions) {
  const answers = {};
  for (const item of questions) {
    const answer = answerFor(item.question);
    if (!answer) {
      toast("请先完成每个问题的选择");
      return;
    }
    answers[item.question] = answer;
  }
  const sessionId = state.activeSessionId;
  try {
    const data = await api("/api/answers", {
      method: "POST",
      body: JSON.stringify({ sessionId, answers }),
    });
    state.questionPicks = {};
    const host = $("#questions");
    if (host) host.dataset.signature = "";
    renderQuestions();
    state.runningIds = [...new Set([...state.runningIds, sessionId])];
    renderRunState();
    if (data.queued) toast("已记录选择，等有空位后继续执行");
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error));
  }
}

function renderPermission() {
  const host = $("#permission");
  renderQuestions();
  if (state.asks.length === 0 || state.busy) {
    host.hidden = true;
    host.dataset.signature = "";
    host.replaceChildren();
    return;
  }
  const signature = state.asks.map((ask) => `${ask.toolCallId}|${ask.name || ""}|${ask.command || ask.description || ""}`).join("\n");
  if (host.dataset.signature === signature && !host.hidden) return;
  host.dataset.signature = signature;
  host.hidden = false;
  host.replaceChildren();
  state.permissionPicks = {};
  for (const ask of state.asks) state.permissionPicks[ask.toolCallId] = "allow";
  const title = document.createElement("h3");
  title.textContent = "智能体要执行这些操作";
  host.append(title);
  const paint = () => {
    for (const button of host.querySelectorAll(".ask-choice button")) {
      button.classList.toggle("selected", state.permissionPicks[button.dataset.id] === button.dataset.permission);
    }
  };
  for (const ask of state.asks) {
    const row = document.createElement("div");
    row.className = "ask";
    const name = document.createElement("b");
    name.textContent = ask.name || "tool";
    row.append(name);
    const text = document.createElement("div");
    text.textContent = ask.command || ask.description || "";
    row.append(text);
    const choice = document.createElement("div");
    choice.className = "ask-choice";
    for (const [permission, label] of [["allow", "允许"], ["deny", "拒绝"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.id = ask.toolCallId;
      button.dataset.permission = permission;
      button.addEventListener("click", () => {
        state.permissionPicks[ask.toolCallId] = permission;
        paint();
      });
      choice.append(button);
    }
    row.append(choice);
    host.append(row);
  }
  paint();
  const actions = document.createElement("div");
  actions.className = "actions";
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "send";
  submit.textContent = "按选择继续";
  submit.addEventListener("click", () => {
    const decisions = state.asks.map((ask) => ({
      toolCallId: ask.toolCallId,
      permission: state.permissionPicks[ask.toolCallId] === "deny" ? "deny" : "allow",
    }));
    void decide(decisions.every((item) => item.permission === "deny") ? "deny" : "allow", decisions);
  });
  actions.append(submit);
  host.append(actions);
}

async function decide(decision, decisions = []) {
  if (!state.activeSessionId || isRunning(state.activeSessionId)) return;
  try {
    const data = await api("/api/permission", {
      method: "POST",
      body: JSON.stringify({ decision, decisions, sessionId: state.activeSessionId }),
    });
    state.asks = [];
    renderPermission();
    renderRunState();
    if (data.queued) toast("已记录选择，等有空位后继续执行");
  } catch (error) {
    renderRunState();
    renderPermission();
    toast(error instanceof Error ? error.message : String(error));
  }
}

async function openSession(id) {
  const previous = state.projectRoot;
  const data = await api("/api/session", { method: "POST", body: JSON.stringify({ id }) });
  applyState(data);
  if (data.projectRoot !== previous) {
    state.treeCache = new Map();
    if (state.sideOpen && state.sideTab === "files") void renderTree().catch((error) => toast(error.message));
  }
  state.messages = data.messages ?? [];
  const livePlan = planFromMessages(state.messages);
  if (livePlan) state.plans[id] = livePlan;
  const current = sessionById(id);
  state.asks = current?.status === "ask_permission" ? current.askPermissions ?? [] : [];
  showLive(id);
  renderMessages();
  renderPermission();
  renderRunState();
  renderTaskOverview();
}

async function reloadMessages(sessionId) {
  if (!sessionId) return;
  const pending = state.messages.filter((message) => String(message.id).startsWith("local-"));
  const data = await api(`/api/messages?sessionId=${encodeURIComponent(sessionId)}`);
  state.messages = data.messages;
  const seen = new Set(state.messages.filter((message) => message.role === "user").map((message) => message.content));
  for (const message of pending) {
    if (!seen.has(message.content)) state.messages.push(message);
  }
  const livePlan = planFromMessages(state.messages);
  if (sessionId && livePlan) state.plans[sessionId] = livePlan;
  state.activeSessionId = sessionId;
  renderMessages();
  renderQuestions();
  renderTaskOverview();
}

async function refreshSessions() {
  const data = await api("/api/state");
  applyState(data);
}

function connectEvents() {
  const source = new EventSource("/api/events");
  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "status") {
      state.runningIds = data.runningIds ?? [];
      state.queued = data.queued ?? 0;
      if (Array.isArray(data.groups)) state.groups = data.groups;
      if (Array.isArray(data.sessions)) state.sessions = data.sessions;
      if (Array.isArray(data.gpuTasks)) state.gpuTasks = data.gpuTasks;
      state.busy = isRunning(state.activeSessionId);
      renderHistory();
      renderAgentBar();
      renderUsageBar();
      renderRunState();
      renderPermission();
      paintGpuOccupy();
      renderTaskOverview();
    }
    if (data.type === "stream") {
      const bucket = liveOf(data.sessionId);
      bucket.streaming = data.phase !== "end";
      bucket.preview = data.preview || "";
      if (bucket.streaming && !bucket.startedAt) bucket.startedAt = Date.now();
      if (data.sessionId === state.activeSessionId) {
        state.streaming = bucket.streaming;
        state.preview = bucket.preview;
        renderLive();
        renderRunState();
      }
    }
    if (data.type === "message") {
      rememberPlanMessage(data.sessionId, data.message);
      if (data.sessionId === state.activeSessionId) {
        const bucket = liveOf(data.sessionId);
        bucket.streaming = false;
        bucket.preview = "";
        state.streaming = false;
        state.preview = "";
        if (!state.messages.some((item) => item.id === data.message.id)) state.messages.push(data.message);
        noteAgentFileChange(data.message);
        renderMessages();
        renderLive();
        renderQuestions();
      }
      renderTaskOverview();
    }
    if (data.type === "stdout") {
      const bucket = liveOf(data.sessionId);
      bucket.stdout = (bucket.stdout + data.chunk).slice(-12000);
      if (data.sessionId === state.activeSessionId) {
        state.stdout = bucket.stdout;
        renderStdout();
      }
    }
    if (data.type === "session" && data.session) {
      const previousStatus = sessionById(data.session.id)?.status;
      upsertSession(data.session);
      if (data.session.status === "waiting_for_user" && previousStatus !== "waiting_for_user" && data.session.id !== state.activeSessionId) {
        toast("有智能体需要你选择后才能继续");
      }
      if (data.session.id === state.activeSessionId) {
        state.asks = data.session.status === "ask_permission" ? data.session.askPermissions ?? [] : [];
        renderPermission();
        if (data.session.status === "waiting_for_user" && pendingQuestions().length === 0) {
          void reloadMessages(data.session.id);
        }
      }
      renderHistory();
      renderAgentBar();
      renderUsageBar();
      renderRunState();
    }
    if (data.type === "retry") {
      toast(`模型请求失败，正在重试 (${data.attempt}/${data.maxRetries})`);
    }
    if (data.type === "error") {
      if (!data.sessionId || data.sessionId === state.activeSessionId) {
        const bucket = liveOf(data.sessionId);
        bucket.streaming = false;
        state.streaming = false;
        renderLive();
      }
      toast(data.message);
      renderRunState();
    }
    if (data.type === "done") {
      const bucket = liveOf(data.sessionId);
      bucket.streaming = false;
      bucket.preview = "";
      bucket.stdout = "";
      bucket.startedAt = 0;
      if (data.session) upsertSession(data.session);
      if (data.sessionId === state.activeSessionId) {
        state.runningIds = state.runningIds.filter((id) => id !== data.sessionId);
        state.busy = false;
        state.streaming = false;
        state.preview = "";
        state.stdout = "";
        state.asks = data.session?.status === "ask_permission" ? data.session.askPermissions ?? [] : [];
        renderLive();
        renderStdout();
        renderPermission();
        renderRunState();
        void reloadMessages(data.sessionId);
      }
      void refreshSessions();
      state.treeCache.clear();
      void renderTree();
      void refreshOpenFile();
    }
  };
}

async function sendMessage() {
  if (sending) return;
  const input = $("#prompt");
  const text = input.value.trim();
  if (!text) return;
  const active = state.activeSessionId;
  const group = active ? taskGroup(active) : null;
  const mainId = group ? mainAgent(group)?.id || active : active;
  if (mainId && mainId === active && state.asks.length > 0) {
    toast("请先允许或拒绝当前操作");
    return;
  }
  if (mainId && mainId === active && pendingQuestions().length > 0) {
    toast("请先选择上面的选项");
    return;
  }
  sending = true;
  renderRunState();
  const interruptedMain = Boolean(mainId) && isRunning(mainId);
  input.value = "";
  const taskRunning = Boolean(active) && taskHasRunning(active);
  try {
  if (mainId && mainId === active) {
    const bucket = liveOf(mainId);
    bucket.startedAt = Date.now();
    bucket.stdout = "";
    state.stdout = "";
    state.asks = [];
    state.messages.push({ id: `local-${Date.now()}`, role: "user", content: text });
    renderMessages();
    renderStdout();
    renderPermission();
    state.runningIds = [...new Set([...state.runningIds, mainId])];
    renderRunState();
  }
    const data = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        text,
        planMode: state.settings?.workMode === "plan",
        sessionId: mainId || null,
      }),
    });
    if (mainId && mainId === active) {
      if (interruptedMain) toast("已中断当前回合，并交给主智能体");
      else if (taskRunning) toast("新内容已交给主智能体");
      return;
    }
    const started = (data.agents ?? []).filter((agent) => agent.id);
    if (mainId && mainId !== active) {
      toast("新内容已交给主智能体");
      if (started[0]?.id) await openSession(started[0].id);
      return;
    }
    if (started.length === 0) {
      toast("已有 4 个智能体在执行，新任务已排队");
      return;
    }
    await openSession(started[0].id);
  } catch (error) {
    if (mainId && mainId === active) state.runningIds = state.runningIds.filter((id) => id !== mainId);
    toast(error.message);
  } finally {
    sending = false;
    renderRunState();
  }
}

let dialogReturn = null;

function dialogRoots() {
  return [$("#settingsModal"), $("#folderModal"), $("#login")].filter(Boolean);
}

function topDialog() {
  const open = dialogRoots().filter((el) => !el.hidden);
  return open.length ? open[open.length - 1] : null;
}

function focusableIn(root) {
  return [...root.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])")].filter((el) => !el.closest("[hidden]"));
}

function syncInert() {
  const app = document.querySelector(".app");
  if (app) app.inert = Boolean(topDialog());
}

function openDialog(el, focus) {
  if (!topDialog()) dialogReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  el.hidden = false;
  syncInert();
  (focus || focusableIn(el)[0])?.focus();
}

function closeDialog(el) {
  el.hidden = true;
  syncInert();
  if (!topDialog() && dialogReturn instanceof HTMLElement) {
    dialogReturn.focus();
    dialogReturn = null;
  }
}

function openSettings() {
  const settings = state.settings;
  $("#apiKey").value = "";
  $("#apiKey").placeholder = settings.hasKey ? `已保存 ${settings.keyHint}，留空不修改` : "sk-...";
  $("#keyHint").textContent = settings.hasKey ? `当前 Key：${settings.keyHint}` : "尚未保存 Key";
  $("#model").value = settings.model;
  $("#baseURL").value = settings.baseURL;
  $("#thinking").checked = settings.thinkingEnabled;
  for (const input of document.querySelectorAll("input[name=effort]")) {
    input.checked = input.value === settings.reasoningEffort;
  }
  syncEffortHint();
  openDialog($("#settingsModal"), $("#apiKey"));
}

const effortCopy = {
  low: "更快，消耗更少",
  high: "较深，消耗适中",
  max: "最深，消耗更多",
};

function syncEffortHint() {
  const value = document.querySelector("input[name=effort]:checked")?.value ?? "max";
  const hint = $("#effortHint");
  if (hint) hint.textContent = effortCopy[value] ?? effortCopy.max;
}

function closeSettings() {
  closeDialog($("#settingsModal"));
}

function closeFolder() {
  closeDialog($("#folderModal"));
}

function renderWorkspaces() {
  const bar = $("#workspaceBar");
  if (!bar) return;
  const workspaces = state.workspaces ?? { cwd: state.projectRoot, directories: [state.projectRoot] };
  bar.replaceChildren();
  for (const dir of workspaces.directories ?? []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = dir === workspaces.cwd ? "dir-chip current" : "dir-chip";
    chip.textContent = dir.split("/").filter(Boolean).pop() || dir;
    chip.title = dir === workspaces.cwd ? `当前工作目录 ${dir}` : dir;
    chip.addEventListener("click", openFolder);
    bar.append(chip);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "dir-chip";
  add.textContent = "工作目录";
  add.addEventListener("click", openFolder);
  bar.append(add);
}

let workspaceDraft = null;

function renderWorkspaceDraft() {
  const list = $("#workspaceList");
  list.replaceChildren();
  for (const dir of workspaceDraft.directories) {
    const current = dir === workspaceDraft.cwd;
    const row = document.createElement("div");
    row.className = current ? "workspace-row current" : "workspace-row";
    const mark = document.createElement("button");
    mark.type = "button";
    mark.className = "ws-mark";
    mark.setAttribute("aria-label", current ? "当前工作目录" : "设为当前工作目录");
    mark.addEventListener("click", () => {
      workspaceDraft.cwd = dir;
      renderWorkspaceDraft();
    });
    const text = document.createElement("div");
    text.className = "ws-text";
    const title = document.createElement("div");
    title.className = "ws-title";
    const name = document.createElement("strong");
    name.textContent = dir.split("/").filter(Boolean).pop() || dir;
    title.append(name);
    if (current) {
      const badge = document.createElement("span");
      badge.className = "ws-badge";
      badge.textContent = "当前";
      title.append(badge);
    }
    const pathLine = document.createElement("div");
    pathLine.className = "ws-path";
    pathLine.textContent = dir;
    pathLine.title = dir;
    text.append(title, pathLine);
    text.addEventListener("click", () => {
      workspaceDraft.cwd = dir;
      renderWorkspaceDraft();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ws-remove";
    remove.textContent = "移除";
    remove.disabled = workspaceDraft.directories.length === 1;
    remove.addEventListener("click", () => {
      workspaceDraft.directories = workspaceDraft.directories.filter((item) => item !== dir);
      if (workspaceDraft.cwd === dir) workspaceDraft.cwd = workspaceDraft.directories[0];
      renderWorkspaceDraft();
    });
    row.append(mark, text, remove);
    list.append(row);
  }
}

function addWorkspaceDir(folder) {
  const dir = folder.trim();
  if (!dir) return;
  if (!workspaceDraft.directories.includes(dir)) workspaceDraft.directories.push(dir);
  if (!workspaceDraft.cwd) workspaceDraft.cwd = dir;
  $("#folderPath").value = "";
  $("#folderError").hidden = true;
  renderWorkspaceDraft();
}

async function openBrowser(folder) {
  const data = await api(`/api/browse?path=${encodeURIComponent(folder || "")}`);
  const browser = $("#browser");
  browser.hidden = false;
  $("#browserPath").textContent = data.path;
  $("#browserUp").disabled = !data.parent;
  $("#browserUp").dataset.parent = data.parent || "";
  const places = $("#browserPlaces");
  places.replaceChildren();
  for (const place of data.places ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = place.name;
    button.addEventListener("click", () => {
      void openBrowser(place.path).catch((error) => toast(error.message));
    });
    places.append(button);
  }
  const list = $("#browserList");
  list.replaceChildren();
  if ((data.directories ?? []).length === 0) {
    const empty = document.createElement("div");
    empty.className = "hint";
    empty.textContent = "这个目录下没有子文件夹";
    list.append(empty);
  }
  for (const entry of data.directories ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.name;
    button.addEventListener("click", () => {
      void openBrowser(entry.path).catch((error) => toast(error.message));
    });
    list.append(button);
  }
}

async function pickFromComputer() {
  if (state.canPickDirectories) {
    try {
      const data = await api("/api/pick-directories", { method: "POST", body: "{}" });
      for (const dir of data.directories ?? []) addWorkspaceDir(dir);
      return;
    } catch (error) {
      toast(error.message);
      return;
    }
  }
  try {
    await openBrowser(state.home || "");
  } catch (error) {
    toast(error.message);
  }
}
  function openFolder() {
  const workspaces = state.workspaces ?? { cwd: state.projectRoot, directories: [state.projectRoot] };
  workspaceDraft = { cwd: workspaces.cwd, directories: [...workspaces.directories] };
  $("#folderPath").value = "";
  $("#folderError").hidden = true;
  $("#browser").hidden = true;
  renderWorkspaceDraft();
  const shortcuts = $("#shortcuts");
  shortcuts.replaceChildren();
  for (const item of [
    ["当前目录", state.projectRoot],
    ["桌面", state.desktop],
    ["主目录", state.home],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item[0];
    button.addEventListener("click", () => {
      addWorkspaceDir(item[1]);
    });
    shortcuts.append(button);
  }
  openDialog($("#folderModal"), $("#folderPath"));
}

async function applyWorkspaces(draft) {
  const previous = state.workspaces?.cwd;
  const data = await api("/api/workspaces", { method: "POST", body: JSON.stringify(draft) });
  const cwdChanged = data.workspaces?.cwd !== previous;
  if (cwdChanged) {
    state.tabs = [];
    state.activePath = null;
    state.expanded.clear();
    state.messages = [];
    state.preview = "";
    state.streaming = false;
    state.stdout = "";
    state.asks = [];
  }
  state.treeCache.clear();
  applyState(data);
  if (cwdChanged) {
    renderMessages();
    renderLive();
    renderStdout();
    renderPermission();
    renderTabs();
    renderEditor();
  }
  await renderTree();
  closeFolder();
}

const layout = { rail: 280, side: 420 };

function readLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem("deepcode.studio.layout") || "{}");
    if (Number.isFinite(saved.rail)) layout.rail = saved.rail;
    if (Number.isFinite(saved.side)) layout.side = saved.side;
  } catch {
    // Keep the default widths when the saved value is unreadable.
  }
}

function saveLayout() {
  localStorage.setItem("deepcode.studio.layout", JSON.stringify(layout));
}

function applyLayoutWidths() {
  const app = document.querySelector(".app");
  if (!app) return;
  const total = window.innerWidth;
  const sideOpen = app.classList.contains("side-open");
  const side = sideOpen ? layout.side : 0;
  const maxRail = Math.max(200, Math.min(520, total - side - 360));
  layout.rail = Math.min(Math.max(layout.rail, 200), maxRail);
  if (sideOpen) {
    const maxSide = Math.max(280, Math.min(840, total - layout.rail - 360));
    layout.side = Math.min(Math.max(layout.side, 280), maxSide);
  }
  app.style.setProperty("--rail-width", `${Math.round(layout.rail)}px`);
  app.style.setProperty("--side-width", `${Math.round(layout.side)}px`);
}

function setResizeFrozen(frozen) {
  document.body.classList.toggle("resizing", frozen);
  for (const el of document.querySelectorAll(".history, .transcript, .edit-list, .tree, .editor, .gpu-list")) {
    if (!frozen) {
      el.style.width = "";
      continue;
    }
    el.style.width = `${el.getBoundingClientRect().width}px`;
  }
  if (!frozen && paintQueue.length && !paintFrame) paintFrame = requestAnimationFrame(runPaint);
}

function bindResize(handle, key, fromRight) {
  if (!handle) return;
  const drag = (event) => {
    if (event.button !== 0 || window.innerWidth <= 860) return;
    event.preventDefault();
    const startX = event.clientX;
    const start = layout[key];
    let pendingX = startX;
    let frame = 0;
    handle.classList.add("dragging");
    setResizeFrozen(true);
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // A synthetic pointer does not support capture; move events still update the width.
    }
    const move = (ev) => {
      pendingX = ev.clientX;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        layout[key] = fromRight ? start - (pendingX - startX) : start + (pendingX - startX);
        applyLayoutWidths();
      });
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      layout[key] = fromRight ? start - (pendingX - startX) : start + (pendingX - startX);
      applyLayoutWidths();
      handle.classList.remove("dragging");
      setResizeFrozen(false);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      saveLayout();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  };
  handle.addEventListener("pointerdown", drag);
  handle.addEventListener("dblclick", () => {
    layout[key] = key === "rail" ? 280 : 420;
    applyLayoutWidths();
    saveLayout();
  });
  handle.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 48 : 16;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const direction = event.key === "ArrowRight" ? 1 : -1;
    layout[key] += (fromRight ? -direction : direction) * step;
    applyLayoutWidths();
    saveLayout();
  });
}

function bindLayout() {
  readLayout();
  applyLayoutWidths();
  bindResize($("#railResize"), "rail", false);
  bindResize($("#sideResize"), "side", true);
  window.addEventListener("resize", applyLayoutWidths);
}

function bind() {
  $("#composer").addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage();
  });
  $("#prompt").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  });
  $("#modelSelect").addEventListener("change", async () => {
    const model = $("#modelSelect").value;
    try {
      const data = await api("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          model,
          baseURL: state.settings.baseURL,
          thinkingEnabled: state.settings.thinkingEnabled,
          reasoningEffort: state.settings.reasoningEffort,
        }),
      });
      state.settings = data.settings;
      renderControls();
      toast(`已切换到 ${data.settings.model}`);
    } catch (error) {
      renderControls();
      toast(error.message);
    }
  });
  $("#workMode").addEventListener("change", async () => {
    const mode = $("#workMode").value;
    try {
      const data = await api("/api/work-mode", { method: "POST", body: JSON.stringify({ mode }) });
      state.settings = data.settings;
      renderControls();
      renderRunState();
    } catch (error) {
      renderControls();
      toast(error.message);
    }
  });
  $("#stop").addEventListener("click", () => {
    if (!state.activeSessionId) return;
    void api("/api/interrupt", { method: "POST", body: JSON.stringify({ sessionId: state.activeSessionId }) });
  });
  $("#newChat").addEventListener("click", () => {
    void openSession(null).catch((error) => toast(error.message));
  });
  $("#historyFilter").addEventListener("input", (event) => {
    state.historyQuery = event.target.value;
    renderHistory();
  });
  $("#openFiles").addEventListener("click", () => {
    openSide("files");
    void renderTree().catch((error) => toast(error.message));
  });
  $("#closeSide").addEventListener("click", closeSide);
  for (const button of document.querySelectorAll("[data-side]")) {
    button.addEventListener("click", () => {
      openSide(button.dataset.side);
      if (button.dataset.side === "files") void renderTree().catch((error) => toast(error.message));
    });
  }
  document.querySelector(".side-tabs")?.addEventListener("keydown", (event) => {
    if (!["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)) return;
    const tabs = ["task", "edits", "files", "gpu"];
    const index = Math.max(0, tabs.indexOf(state.sideTab));
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
    event.preventDefault();
    const name = tabs[next];
    openSide(name);
    if (name === "files") void renderTree().catch((error) => toast(error.message));
    document.getElementById(`side-tab-${name}`)?.focus();
  });
  $("#gpuAddToggle").addEventListener("click", () => {
    setGpuFormOpen(true);
    $("#gpuName").focus();
  });
  $("#gpuAddCancel").addEventListener("click", () => {
    $("#gpuForm").reset();
    syncGpuAuth();
    setGpuFormOpen(false);
  });
  $("#gpuForm").addEventListener("change", (event) => {
    if (event.target?.name === "gpuAuth") syncGpuAuth();
  });
  $("#gpuForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const data = await api("/api/gpu-servers", {
        method: "POST",
        body: JSON.stringify({
          name: $("#gpuName").value,
          host: $("#gpuHost").value,
          port: $("#gpuPort").value,
          user: $("#gpuUser").value,
          note: $("#gpuNote").value,
          auth: document.querySelector("input[name=gpuAuth]:checked")?.value || "password",
          password: $("#gpuPassword").value,
          keyPath: $("#gpuKeyPath").value,
        }),
      });
      state.gpu = data.gpu;
      $("#gpuForm").reset();
      syncGpuAuth();
      setGpuFormOpen(false);
      renderGpu();
      toast("已添加 GPU 服务器");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
  $("#openSettings").addEventListener("click", openSettings);
  $("#bannerSettings").addEventListener("click", () => {
    $("#login").hidden = false;
    syncInert();
    $("#loginKey").focus();
  });
  $("#closeSettings").addEventListener("click", closeSettings);
  $("#cancelSettings").addEventListener("click", closeSettings);
  $("#settingsForm").addEventListener("change", (event) => {
    if (event.target?.name === "effort") syncEffortHint();
  });
  $("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const effort = document.querySelector("input[name=effort]:checked")?.value ?? "max";
    const data = await api("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        apiKey: $("#apiKey").value,
        model: $("#model").value,
        baseURL: $("#baseURL").value,
        thinkingEnabled: $("#thinking").checked,
        reasoningEffort: effort,
      }),
    });
    state.settings = data.settings;
    $("#keyBanner").hidden = data.settings.hasKey;
    renderControls();
    const account = $("#accountLabel");
    if (account) account.textContent = data.settings.hasKey ? `已登录 ${data.settings.keyHint}` : "未登录";
    $("#login").hidden = data.settings.hasKey;
    closeSettings();
    toast("设置已保存");
  });
  $("#openFolder").addEventListener("click", openFolder);
  $("#closeFolder").addEventListener("click", closeFolder);
  $("#cancelFolder").addEventListener("click", closeFolder);
  $("#folderForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const typed = $("#folderPath").value.trim();
    if (typed) addWorkspaceDir(typed);
    try {
      await applyWorkspaces(workspaceDraft);
    } catch (error) {
      const el = $("#folderError");
      el.hidden = false;
      el.textContent = error.message;
    }
  });
  $("#addFolder").addEventListener("click", () => {
    addWorkspaceDir($("#folderPath").value);
  });
  $("#browseFolder").addEventListener("click", () => {
    void pickFromComputer();
  });
  $("#browserUp").addEventListener("click", () => {
    const parent = $("#browserUp").dataset.parent;
    if (parent) void openBrowser(parent);
  });
  $("#browserUse").addEventListener("click", () => {
    addWorkspaceDir($("#browserPath").textContent);
  });
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const error = $("#loginError");
    error.hidden = true;
    const button = $("#loginSubmit");
    button.disabled = true;
    try {
      const data = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({ apiKey: $("#loginKey").value, baseURL: $("#loginBase").value }),
      });
      state.settings = data.settings;
      $("#loginKey").value = "";
      applyState({ ...state, settings: data.settings, projectRoot: state.projectRoot, projectName: state.projectName, home: state.home, desktop: state.desktop, sessions: state.sessions, activeSessionId: state.activeSessionId, busy: state.busy });
      if (data.account && data.account.available === false) toast("已登录，当前账户余额不可用");
      else toast("已登录");
    } catch (loginError) {
      error.hidden = false;
      error.textContent = loginError.message;
    } finally {
      button.disabled = false;
    }
  });
  $("#logout").addEventListener("click", async () => {
    if (state.runningIds.length > 0) {
      toast("还有智能体在执行，请先停止");
      return;
    }
    const data = await api("/api/logout", { method: "POST", body: "{}" });
    state.settings = data.settings;
    applyState({ ...state, settings: data.settings, projectRoot: state.projectRoot, projectName: state.projectName, home: state.home, desktop: state.desktop, sessions: state.sessions, activeSessionId: state.activeSessionId, busy: state.busy });
  });
  $("#filter").addEventListener("input", (event) => {
    state.filter = event.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void renderTree().catch((error) => toast(error.message));
    }, 200);
  });
  document.addEventListener("click", () => closeHistoryMenu());
  document.addEventListener("scroll", () => closeHistoryMenu(), true);
  window.addEventListener("blur", () => closeHistoryMenu());
  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      const dialog = topDialog();
      if (dialog) {
        const items = focusableIn(dialog);
        if (items.length) {
          const first = items[0];
          const last = items[items.length - 1];
          const inside = dialog.contains(document.activeElement);
          if (event.shiftKey && (!inside || document.activeElement === first)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
            event.preventDefault();
            first.focus();
          }
        }
        return;
      }
    }
    if (event.key === "Escape") {
      if (document.querySelector(".history-menu")) {
        closeHistoryMenu();
        return;
      }
      if (!$("#settingsModal").hidden) {
        closeSettings();
        return;
      }
      if (!$("#folderModal").hidden) closeFolder();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      const tab = currentTab();
      if (tab && document.activeElement?.tagName !== "TEXTAREA") {
        event.preventDefault();
        void saveTab(tab);
      }
    }
  });
  bindLayout();
}

async function main() {
  bind();
  const data = await api("/api/state");
  applyState(data);
  if (data.activeSessionId) {
    const current = sessionById(data.activeSessionId);
    state.asks = current?.status === "ask_permission" ? current.askPermissions ?? [] : [];
    await reloadMessages(data.activeSessionId);
    renderPermission();
  } else {
    renderMessages();
  }
  renderEditor();
  connectEvents();
  await renderTree();
  if (!data.settings.hasKey) $("#loginKey").focus();
}

void main().catch((error) => {
  toast(error.message);
});
