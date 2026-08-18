/* Trellis Dashboard — 只读快照装配、视图渲染与转义优先的 Markdown 预览。 */
"use strict";

const REFRESH_MS = 30000;

const state = {
  snapshot: null,
  tab: "tasks",
  filter: "all",
  query: "",
  selected: null,          // {kind: "active"|"archived", ref: dir 或 archive ref}
  artifact: null,          // /api/artifact 响应
  timer: null,
};

/* ============================================================ 基础工具 */

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "htmlProp") node.innerHTML = value;
    else if (key === "styleProp") node.setAttribute("style", value);
    else if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else node.setAttribute(key, value);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}

function relTime(iso) {
  if (!iso) return "—";
  const t = Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
  if (Number.isNaN(t)) return iso;
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}

const STATUS = {
  planning:    { label: "规划", cls: "st-planning" },
  in_progress: { label: "进行中", cls: "st-progress" },
  review:      { label: "评审", cls: "st-review" },
  completed:   { label: "已完成", cls: "st-done" },
  done:        { label: "已完成", cls: "st-done" },
};
function statusInfo(status) {
  return STATUS[status] || { label: status, cls: "st-unknown" };
}

const PHASES = [
  { key: "plan", label: "Plan · 规划" },
  { key: "execute_finish", label: "Execute / Finish · 实现与收尾" },
  { key: "completed", label: "Completed · 完成" },
];

/* ============================================================ 主题 */

function initTheme() {
  const saved = localStorage.getItem("td-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? "dark" : "light");
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = current;
  localStorage.setItem("td-theme", current);
}

/* ============================================================ 数据 */

async function fetchSnapshot() {
  if (new URLSearchParams(location.search).has("demo")) {
    if (!window.DEMO_SNAPSHOT) throw new Error("演示数据未加载（demo.js 缺失）");
    return structuredClone(window.DEMO_SNAPSHOT);
  }
  const resp = await fetch("/api/dashboard", { cache: "no-store" });
  if (!resp.ok) throw new Error(`/api/dashboard ${resp.status}`);
  return resp.json();
}

async function fetchArtifact(taskRef, file) {
  const params = new URLSearchParams({ task: taskRef, file });
  const resp = await fetch(`/api/artifact?${params}`, { cache: "no-store" });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

/* ============================================================ Markdown（转义优先） */

function inlineMarkdown(text) {
  // 输入已经过 escapeHtml。先抽出行内代码占位，再处理链接/加粗/斜体。
  const codes = [];
  let out = text.replace(/`([^`\n]+)`/g, (_m, code) => {
    codes.push(code);
    return `\x01${codes.length - 1}\x02`;
  });
  out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, label, url) => {
    if (!/^(https?:\/\/|\/|#)/i.test(url)) return label;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/\x01(\d+)\x02/g, (_m, idx) => `<code>${codes[Number(idx)]}</code>`);
  return out;
}

function renderMarkdown(source) {
  const esc = escapeHtml(source);
  const blocks = [];
  // 抽出围栏代码块
  const withFences = esc.replace(/```([\w-]*)\n([\s\S]*?)```/g, (_m, _lang, body) => {
    blocks.push(`<pre><code>${body.replace(/\n$/, "")}</code></pre>`);
    return `\x03${blocks.length - 1}\x04`;
  });

  const lines = withFences.split("\n");
  const out = [];
  let para = [];
  let list = null;        // {tag, items}
  let table = null;       // {rows: []}
  let quote = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(inlineMarkdown).join("<br>")}</p>`);
      para = [];
    }
  };
  const flushList = () => {
    if (list) {
      out.push(`<${list.tag}>${list.items.map((i) => `<li>${inlineMarkdown(i)}</li>`).join("")}</${list.tag}>`);
      list = null;
    }
  };
  const flushQuote = () => {
    if (quote.length) {
      out.push(`<blockquote><p>${quote.map(inlineMarkdown).join("<br>")}</p></blockquote>`);
      quote = [];
    }
  };
  const flushTable = () => {
    if (table && table.rows.length) {
      const [head, ...rest] = table.rows;
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inlineMarkdown(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${inlineMarkdown(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      );
    }
    table = null;
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); flushTable(); };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const fence = line.match(/^\x03(\d+)\x04\s*$/);
    if (fence) { flushAll(); out.push(blocks[Number(fence[1])]); continue; }
    if (!line.trim()) { flushAll(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = Math.min(heading[1].length + 1, 6); // 文档自身以 h1 开始，整体降一级
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushAll(); out.push("<hr>"); continue; }

    if (line.trim().startsWith("|")) {
      flushPara(); flushList(); flushQuote();
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
      if (table && cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // 分隔行
      table = table || { rows: [] };
      table.rows.push(cells);
      continue;
    }
    flushTable();

    const quoted = line.match(/^>\s?(.*)$/);
    if (quoted) { flushPara(); flushList(); quote.push(quoted[1]); continue; }
    flushQuote();

    const ulItem = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulItem) {
      flushPara();
      if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
      list.items.push(ulItem[1]);
      continue;
    }
    const olItem = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (olItem) {
      flushPara();
      if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
      list.items.push(olItem[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushAll();
  return out.join("\n");
}

/* ============================================================ 概览卡片 */

function renderCards(snapshot) {
  const s = snapshot.summary || {};
  const byStatus = s.byStatus || {};
  const specBits = [];
  const spec = snapshot.spec || {};
  if (spec.mode) specBits.push(spec.mode);
  if (Array.isArray(spec.specLayers)) specBits.push(spec.specLayers.join(" / "));
  const platformHint = Object.entries(platformCounts(snapshot.sessions || {}))
    .map(([p, n]) => `${p} ${n}`).join(" · ");
  const cards = [
    { label: "活跃任务", value: s.activeTasks ?? 0, hint: statusHint(byStatus) },
    { label: "已归档", value: s.archivedTotal ?? 0, hint: "tasks/archive/" },
    {
      label: "Git 脏文件", value: s.dirtyFiles ?? 0,
      hint: (snapshot.project.git || {}).branch || "",
      tone: (s.dirtyFiles ?? 0) > 0 ? "warn" : "ok",
      onClick: () => openGitDrawer(snapshot),
    },
    { label: "AI 会话", value: s.activeSessions ?? 0, hint: platformHint || "无窗口指针" },
    { label: "Spec 层", value: (spec.specLayers || []).length || "—", hint: specBits.join(" · ") || "未发现" },
  ];
  const host = document.getElementById("cards");
  host.replaceChildren(
    ...cards.map((c) => {
      const card = el("div", { class: `card tone-${c.tone || "neutral"}${c.onClick ? " card-clickable" : ""}` },
        el("div", { class: "card-value", text: String(c.value) }),
        el("div", { class: "card-label", text: c.label }),
        c.hint ? el("div", { class: "card-hint", text: c.hint }) : null);
      if (c.onClick) card.addEventListener("click", c.onClick);
      return card;
    })
  );
  renderRiskStrip(snapshot);
}

function platformCounts(sessions) {
  const counts = {};
  for (const s of sessions) counts[s.platform] = (counts[s.platform] || 0) + 1;
  return counts;
}

/* 风险条：对齐 workflow.md 里值得注意的信号 */
function renderRiskStrip(snapshot) {
  const strip = document.getElementById("risk-strip");
  if (!strip) return;
  const bits = [];
  const pending = (snapshot.tasks.active || []).filter((t) => t.needsDecision).length;
  if (pending > 0) bits.push({
    text: `待你拍板 ${pending}`, tone: "danger", action: "decision",
  });
  const priority = snapshot.summary.priority || {};
  if (priority.P0 > 0) bits.push({ text: `P0 任务 ${priority.P0}`, tone: "danger" });
  const missingPrd = (snapshot.tasks.active || [])
    .filter((t) => (t.risks || []).includes("MISSING_PRD")).length;
  if (missingPrd > 0) bits.push({ text: `MISSING_PRD ${missingPrd}`, tone: "danger" });
  const stale = (snapshot.sessions || []).filter((s) => s.staleTask).length;
  if (stale > 0) bits.push({ text: `失效会话指针 ${stale}`, tone: "warn" });
  const nearLimit = ((snapshot.journal || {}).journalFiles || []).filter((f) => f.nearLimit).length;
  if (nearLimit > 0) bits.push({ text: `journal 接近 2000 行上限 ${nearLimit} 个文件`, tone: "warn" });
  strip.replaceChildren(...bits.map((b) => {
    if (b.action) {
      return el("button", {
        class: `risk-chip risk-${b.tone}`,
        text: `⚠ ${b.text}`,
        title: "点击筛选出这些任务",
        onclick: () => { state.filter = b.action; switchTab("tasks"); },
      });
    }
    return el("span", { class: `risk-chip risk-${b.tone}`, text: `⚠ ${b.text}` });
  }));
}

function statusHint(byStatus) {
  const parts = [];
  for (const key of ["planning", "in_progress", "review"]) {
    if (byStatus[key]) parts.push(`${statusInfo(key).label} ${byStatus[key]}`);
  }
  const done = (byStatus.completed || 0) + (byStatus.done || 0);
  if (done) parts.push(`已完成(未归档) ${done}`);
  return parts.join(" · ") || "无状态数据";
}

function priorityHint(priority) {
  if (!priority) return "";
  return Object.entries(priority).filter(([, n]) => n > 0).map(([p, n]) => `${p}:${n}`).join(" ");
}
void priorityHint; // 预留：优先级分布已移至风险条

function renderMeta(snapshot) {
  const git = snapshot.project.git || {};
  const bits = [snapshot.project.name];
  if (git.branch) bits.push(`分支 ${git.branch}`);
  if (git.head) bits.push(`HEAD ${git.head}`);
  if (snapshot.developer) bits.push(`开发者 ${snapshot.developer}`);
  document.getElementById("project-meta").textContent = bits.join(" · ");
}

/* ============================================================ 任务视图 */

function taskMatches(task, filter, query) {
  if (filter === "decision") {
    if (!task.needsDecision) return false;
  } else if (filter === "active-done") {
    if (!["completed", "done"].includes(task.status)) return false;
  } else if (filter !== "all" && task.status !== filter) return false;
  if (!query) return true;
  const hay = `${task.dir} ${task.title} ${task.assignee || ""} ${task.parent || ""}`.toLowerCase();
  return hay.includes(query.toLowerCase());
}

function renderTasks(snapshot) {
  const { active = [], archivedRecent = [] } = snapshot.tasks || {};
  const byStatus = snapshot.summary.byStatus || {};
  const doneActive = (byStatus.completed || 0) + (byStatus.done || 0);

  const pending = active.filter((t) => t.needsDecision).length;
  const chips = [
    { key: "all", label: `全部 ${active.length}` },
    ...(pending ? [{ key: "decision", label: `⚠ 待拍板 ${pending}` }] : []),
    { key: "planning", label: `规划 ${byStatus.planning || 0}` },
    { key: "in_progress", label: `进行中 ${byStatus.in_progress || 0}` },
    { key: "active-done", label: `已完成未归档 ${doneActive}` },
    { key: "archived", label: `已归档 ${archivedRecent.length}` },
  ];

  const search = el("input", {
    type: "search", placeholder: "搜索标题 / 目录 / 负责人…", value: state.query,
    oninput: (e) => { state.query = e.target.value; renderTaskList(); },
  });

  const chipBar = el("div", { class: "chip-bar" },
    ...chips.map((c) => el("button", {
      class: `chip ${state.filter === c.key ? "chip-active" : ""}`,
      onclick: () => { state.filter = c.key; renderTasks(state.snapshot); },
      text: c.label,
    })),
    el("span", { class: "tabs-spacer" }),
    search);

  const list = el("div", { class: "task-list", id: "task-list" });
  const detail = el("div", { class: "task-detail", id: "task-detail" });
  const layout = el("div", { class: "task-layout" }, list, detail);
  document.getElementById("view").replaceChildren(chipBar, layout);
  renderTaskList();
  renderDetail();
}

function renderTaskList() {
  const snapshot = state.snapshot;
  const { active = [], archivedRecent = [] } = snapshot.tasks || {};
  const host = document.getElementById("task-list");
  if (!host) return;

  let items;
  if (state.filter === "archived") {
    items = archivedRecent
      .filter((t) => !state.query || `${t.dir} ${t.title}`.toLowerCase().includes(state.query.toLowerCase()))
      .map((t) => ({ kind: "archived", ref: t.ref, task: t }));
  } else {
    items = active
      .filter((t) => taskMatches(t, state.filter, state.query))
      .map((t) => ({ kind: "active", ref: t.dir, task: t }));
  }

  if (!items.length) {
    host.replaceChildren(el("div", { class: "empty", text: "没有匹配的任务" }));
    return;
  }
  host.replaceChildren(...items.map(({ kind, ref, task }) => {
    const st = statusInfo(task.status);
    const selected = state.selected && state.selected.ref === ref;
    const progress = task.childrenProgress;
    const risks = task.risks || [];
    return el("div", {
      class: `task-card ${selected ? "task-card-selected" : ""}${task.needsDecision ? " task-card-decision" : ""}`,
      onclick: () => { state.selected = { kind, ref }; renderTaskList(); renderDetail(); },
    },
      el("div", { class: "task-card-row1" },
        task.needsDecision ? el("span", { class: "badge st-decision", text: "待拍板" }) : null,
        el("span", { class: `badge ${st.cls}`, text: st.label }),
        task.priority ? el("span", { class: `prio prio-${task.priority}`, text: task.priority }) : null,
        risks.length ? el("span", { class: "badge st-risk", title: risks.join(", "), text: "⚠ " + risks.length }) : null,
        el("span", { class: "muted task-date", text: task.createdAt || task.month || "" })),
      el("div", { class: "task-title", text: task.title }),
      el("div", { class: "task-sub muted", text: task.dir }),
      progress ? el("div", { class: "progress" },
        el("div", { class: "progress-bar" },
          el("div", { class: "progress-fill", styleProp: `width:${(progress.done / progress.total) * 100}%` })),
        el("span", { class: "muted progress-text", text: `子任务 ${progress.done}/${progress.total}` })) : null);
  }));
}

function artifactEntries(item) {
  // 返回 [{file, label, kind, disabled}]；disabled 条目仅作计数说明，不可点击
  const entries = [];
  const push = (file, label, kind, disabled = false) => entries.push({ file, label, kind, disabled });
  if (item.kind === "active") {
    const a = item.task.artifacts || {};
    if (a.prd) push("prd.md", "PRD", "doc");
    if (a.design) push("design.md", "设计", "doc");
    if (a.implement) push("implement.md", "实施计划", "doc");
    for (const name of a.researchFiles || []) push(name, name === "research.md" ? "调研" : name, "doc");
    for (const name of a.extras || []) push(name, name, "extra");
    for (const dir of a.extraDirs || []) {
      for (const file of dir.files || []) push(file, file, "extra");
      if ((dir.files || []).length < dir.fileCount) {
        push(null, `${dir.name}/ 另有 ${dir.fileCount - (dir.files || []).length} 个文件未列出`, "dir", true);
      }
    }
    if (a.implementContext?.exists) push("implement.jsonl", `implement.jsonl（${a.implementContext.curated} 条）`, "ctx");
    if (a.checkContext?.exists) push("check.jsonl", `check.jsonl（${a.checkContext.curated} 条）`, "ctx");
  } else {
    for (const name of ["prd.md", "design.md", "implement.md"]) {
      push(name, name, "doc");
    }
  }
  push("task.json", "task.json", "ctx");
  return entries;
}

function stepperFor(phaseKey) {
  const idx = PHASES.findIndex((p) => p.key === phaseKey);
  return PHASES.map((p, i) => ({
    label: p.label,
    state: idx < 0 ? "idle" : i < idx ? "done" : i === idx ? "current" : "todo",
  }));
}

function kv(label, value) {
  return value ? el("div", { class: "kv" },
    el("span", { class: "kv-k muted", text: label }),
    el("span", { class: "kv-v", text: value })) : null;
}

function renderDetail() {
  const host = document.getElementById("task-detail");
  if (!host) return;
  if (!state.selected) {
    host.replaceChildren(el("div", { class: "empty", text: "在左侧选择一个任务查看详情" }));
    return;
  }
  const { kind, ref } = state.selected;
  const snapshot = state.snapshot;
  let item;
  if (kind === "active") {
    item = { kind, ref, task: (snapshot.tasks.active || []).find((t) => t.dir === ref) };
  } else {
    item = { kind, ref, task: (snapshot.tasks.archivedRecent || []).find((t) => t.ref === ref) };
  }
  if (!item.task) {
    host.replaceChildren(el("div", { class: "empty", text: "任务不在当前快照中（可能已变更），请重新选择" }));
    state.selected = null;
    return;
  }
  const t = item.task;
  const st = statusInfo(t.status);
  const parts = [];

  parts.push(el("h2", { class: "detail-title", text: t.title }));
  parts.push(el("div", { class: "detail-sub" },
    el("span", { class: `badge ${st.cls}`, text: st.label }),
    t.priority ? el("span", { class: `prio prio-${t.priority}`, text: t.priority }) : null,
    el("span", { class: "muted", text: t.dir })));

  // 需要用户拍板的醒目提示（task.json meta.needsDecision）
  if (t.needsDecision) {
    parts.push(el("div", { class: "decision-callout" },
      el("div", { class: "decision-label", text: "⚠ 需要你拍板" }),
      el("div", { class: "decision-text", text: t.needsDecision })));
  }

  // 阶段步进条
  const steps = stepperFor(t.phase);
  if (steps.some((s) => s.state !== "idle")) {
    parts.push(el("div", { class: "stepper" },
      ...steps.map((s, i) => el("div", { class: `step step-${s.state}` },
        el("div", { class: "step-dot", text: i + 1 }),
        el("div", { class: "step-label", text: s.label })))));
  }

  if (t.nextStep) {
    parts.push(el("div", { class: "next-step" },
      el("div", { class: "next-step-label", text: "下一步" }),
      el("div", { text: t.nextStep })));
  }

  // 元数据
  const meta = el("div", { class: "meta-grid" },
    kv("负责人", t.assignee),
    kv("创建", t.createdAt),
    kv("完成", t.completedAt),
    kv("分支", t.branch),
    t.baseBranch && t.baseBranch !== "main" ? kv("目标分支", t.baseBranch) : null,
    kv("Worktree", t.worktreePath ? t.worktreePath.split("/").pop() : null),
    kv("提交", t.commit),
    kv("归档月份", t.month));
  parts.push(meta);

  if (t.parent) {
    parts.push(el("div", { class: "rel" }, el("span", { class: "muted", text: "↰ 父任务 " }),
      el("code", { text: t.parent })));
  }
  if (t.children && t.children.length) {
    const p = t.childrenProgress || { done: 0, total: t.children.length };
    parts.push(el("div", { class: "children" },
      el("div", { class: "children-head", text: `子任务 ${p.done}/${p.total} 已完成` }),
      el("div", { class: "progress" },
        el("div", { class: "progress-bar" },
          el("div", { class: "progress-fill", styleProp: `width:${(p.done / p.total) * 100}%` }))),
      ...t.children.map((c) => el("div", { class: "child-row" },
        el("span", { class: `badge ${statusInfo(c.status || "completed").cls}`, text: c.archived ? "已归档" : statusInfo(c.status).label }),
        el("code", { text: c.dir })))));
  }

  if (t.description) {
    parts.push(el("div", { class: "section-title", text: "描述" }));
    parts.push(el("div", { class: "md md-compact", htmlProp: renderMarkdown(t.description) }));
  }
  if (t.notes) {
    parts.push(el("div", { class: "section-title", text: "备注" }));
    parts.push(el("div", { class: "md md-compact", htmlProp: renderMarkdown(t.notes) }));
  }

  // 规划完成度（workflow.md 1.5）
  if (item.kind === "active" && t.status === "planning") {
    const r = t.readiness || {};
    const row = (ok, label) => el("div", { class: `check ${ok ? "check-ok" : "check-todo"}` },
      el("span", { text: ok ? "✓" : "○" }), el("span", { text: label }));
    parts.push(el("div", { class: "section-title", text: "Phase 1 完成度（task.py start 前）" }));
    parts.push(el("div", { class: "muted check-note", text: "轻量任务 PRD-only 即可；复杂任务需设计+实施计划；子代理平台需两条 jsonl 各有真实条目" }));
    parts.push(el("div", { class: "checks" },
      row(r.prd, "prd.md 存在"),
      row(r.design, "design.md（复杂任务）"),
      row(r.implement, "implement.md（复杂任务）"),
      row(r.contextCurated, "implement.jsonl / check.jsonl 已策展")));
  }

  // 工件
  parts.push(el("div", { class: "section-title", text: "工件" }));
  const entries = artifactEntries(item);
  parts.push(el("div", { class: "artifact-grid" },
    ...entries.map((entry) => entry.disabled
      ? el("span", { class: "artifact-chip artifact-note" },
          el("span", { class: `artifact-kind kind-${entry.kind}` }),
          el("span", { text: entry.label }))
      : el("button", {
          class: "artifact-chip",
          onclick: () => openArtifact(ref, entry.file, t.title),
          title: entry.file,
        },
          el("span", { class: `artifact-kind kind-${entry.kind}` }),
          el("span", { text: entry.label })))));

  host.replaceChildren(...parts);
  host.scrollTop = 0;
}

/* ============================================================ 会话视图 */

function renderSessions(snapshot) {
  const sessions = snapshot.sessions || [];
  const extra = document.getElementById("tab-extra");
  extra.replaceChildren(el("span", { class: "muted", text: `${sessions.length} 个会话窗口指针` }));
  if (!sessions.length) {
    document.getElementById("view").replaceChildren(
      el("div", { class: "empty", text: "没有活跃会话指针（.trellis/.runtime/sessions/ 为空）" }));
    return;
  }
  const byDir = new Map((snapshot.tasks.active || []).map((t) => [t.dir, t]));
  const rows = sessions.map((s) => {
    const taskDir = s.currentTask ? s.currentTask.split("/").pop() : null;
    const task = taskDir ? byDir.get(taskDir) : null;
    const st = task ? statusInfo(task.status) : null;
    return el("tr", {},
      el("td", {}, el("span", { class: "badge st-platform", text: s.platform })),
      el("td", { class: "mono muted", text: s.key.length > 28 ? `${s.key.slice(0, 28)}…` : s.key }),
      el("td", { text: relTime(s.lastSeenAt), title: s.lastSeenAt || "" }),
      el("td", {}, taskDir
        ? el("span", { class: s.staleTask ? "session-task stale" : "session-task", text: taskDir },
            s.staleTask ? el("span", { class: "badge st-risk", text: "已归档/不存在" }) : null)
        : el("span", { class: "muted", text: "—" })),
      el("td", {}, st
        ? el("span", { class: `badge ${st.cls}`, text: st.label })
        : el("span", { class: "muted", text: "—" })),
      el("td", { class: "muted", text: s.lastSeenAt ? s.lastSeenAt.slice(0, 10) : "—" }));
  });
  document.getElementById("view").replaceChildren(
    el("table", { class: "table" },
      el("thead", {}, el("tr", {},
        el("th", { text: "平台" }), el("th", { text: "会话 Key" }), el("th", { text: "最后活跃" }),
        el("th", { text: "当前任务" }), el("th", { text: "任务状态" }), el("th", { text: "日期" }))),
      el("tbody", {}, ...rows)));
}

/* ============================================================ 时间线视图 */

function renderTimeline(snapshot) {
  const journal = snapshot.journal || {};
  const devs = journal.developers || [];
  const devBits = devs.map((d) =>
    el("span", { class: "dev-chip" },
      el("strong", { text: d.name }),
      el("span", { class: "muted", text: ` ${d.totalSessions ?? 0} sessions · ${d.lastActive || "—"}` })));
  const nearLimit = (journal.journalFiles || []).filter((f) => f.nearLimit);
  const jfBits = (journal.journalFiles || []).map((f) =>
    el("span", { class: `dev-chip${f.nearLimit ? " chip-warn" : ""}`, title: f.nearLimit ? "接近 2000 行滚动上限" : "" },
      el("span", { class: "mono", text: f.file }),
      el("span", { class: "muted", text: ` ~${f.lines ?? "?"} 行` })));
  document.getElementById("tab-extra").replaceChildren(
    el("span", { class: "muted", text: journal.developer ? `当前开发者: ${journal.developer}` : "" }));

  // 最近提交（git log）
  const commits = (snapshot.project.git || {}).recentCommits || [];
  const commitBlock = commits.length
    ? el("details", { class: "commit-block" },
        el("summary", { text: `最近提交 ${commits.length}` }),
        el("div", { class: "commit-list" },
          ...commits.map((line) => {
            const spaceIdx = line.indexOf(" ");
            const hash = spaceIdx > 0 ? line.slice(0, spaceIdx) : line;
            const rest = spaceIdx > 0 ? line.slice(spaceIdx + 1) : "";
            return el("div", { class: "commit-row" },
              el("code", { class: "commit", text: hash }),
              el("span", { text: rest }));
          })))
    : null;

  const entries = journal.recent || [];
  const view = el("div", { class: "timeline" });
  if (!entries.length) {
    view.append(el("div", { class: "empty", text: "没有 journal 记录" }));
  }
  for (const entry of entries) {
    view.append(el("div", { class: "tl-item" },
      el("div", { class: "tl-dot" }),
      el("div", { class: "tl-body" },
        el("div", { class: "tl-head" },
          el("span", { class: "tl-n", text: `#${entry.n}` }),
          el("span", { class: "tl-date muted", text: entry.date }),
          entry.branch ? el("span", { class: "badge st-branch", text: entry.branch }) : null),
        el("div", { class: "tl-title", text: entry.title }),
        entry.commits && entry.commits.length
          ? el("div", { class: "tl-commits" },
              ...entry.commits.map((c) => el("code", { class: "commit", text: c })))
          : null)));
  }
  document.getElementById("view").replaceChildren(
    devBits.length ? el("div", { class: "dev-bar" }, ...devBits) : el("div"),
    jfBits.length ? el("div", { class: "dev-bar" }, ...jfBits) : el("div"),
    commitBlock || el("div"),
    el("div", { class: "section-title", text: `Session 时间线（${journal.developer || "—"}）` }),
    view);
}

/* ============================================================ 工件预览抽屉 */

function showDrawer(title, sub) {
  document.getElementById("drawer-title").textContent = title;
  document.getElementById("drawer-sub").textContent = sub;
  document.getElementById("drawer-body")
    .replaceChildren(el("div", { class: "muted", text: "加载中…" }));
  document.getElementById("drawer").hidden = false;
  document.getElementById("drawer-mask").hidden = false;
}

function setDrawerBody(...nodes) {
  document.getElementById("drawer-body").replaceChildren(...nodes);
}

function openGitDrawer(snapshot) {
  const git = snapshot.project.git || {};
  showDrawer("Git 脏文件", `${git.branch || ""} @ ${git.head || ""} · ${git.dirtyFiles.length} 个文件`);
  if (!git.dirtyFiles.length) {
    setDrawerBody(el("div", { class: "empty", text: "工作区干净" }));
    return;
  }
  setDrawerBody(el(
    "pre",
    { class: "code-block", text: git.dirtyFiles.join("\n") }
  ));
}

async function openArtifact(taskRef, file, taskTitle) {
  showDrawer(file, `${taskTitle} · ${taskRef}`);
  try {
    const data = await fetchArtifact(taskRef, file);
    state.artifact = data;
    const isJson = file.endsWith(".json") || file.endsWith(".jsonl");
    let inner;
    if (isJson) {
      inner = el("pre", { class: "code-block", text: data.content });
    } else {
      inner = el("div", { class: "md" });
      inner.innerHTML = renderMarkdown(data.content);
    }
    setDrawerBody(
      el("div", { class: "drawer-meta muted" },
        `${fmtBytes(data.sizeBytes)}${data.truncated ? " · 已截断（超过 256 KiB）" : ""}`),
      inner);
  } catch (err) {
    setDrawerBody(el("div", { class: "empty", text: `无法加载: ${err.message}` }));
  }
}

function closeDrawer() {
  document.getElementById("drawer").hidden = true;
  document.getElementById("drawer-mask").hidden = true;
  state.artifact = null;
}

/* ============================================================ 视图路由与刷新 */

function renderView() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  if (state.tab === "tasks") renderTasks(snapshot);
  else if (state.tab === "sessions") renderSessions(snapshot);
  else renderTimeline(snapshot);
}

function markRefreshed() {
  document.getElementById("refreshed-at").textContent =
    `更新于 ${new Date().toLocaleTimeString("zh-CN")}`;
}

async function refresh(silent = false) {
  try {
    const previous = state.snapshot;
    state.snapshot = await fetchSnapshot();
    renderMeta(state.snapshot);
    renderCards(state.snapshot);
    renderView();
    document.getElementById("raw-json").textContent = JSON.stringify(state.snapshot, null, 2);
    markRefreshed();
    if (previous && state.selected) {
      // 选中项可能已被归档/改名；renderDetail 内部会处理丢失情况
    }
  } catch (err) {
    document.getElementById("project-meta").textContent = `加载失败: ${err.message}`;
  }
  if (!silent) return;
}

function startAutoRefresh() {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => refresh(true), REFRESH_MS);
}

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach((node) => {
    node.classList.toggle("active", node.dataset.tab === tab);
  });
  renderView();
}

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("refresh").addEventListener("click", () => refresh());
  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  document.getElementById("drawer-mask").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
  document.querySelectorAll(".tab").forEach((node) => {
    node.addEventListener("click", () => switchTab(node.dataset.tab));
  });
  refresh();
  startAutoRefresh();
});
