/**
 * QA Agent Dashboard — Express backend + full responsive UI
 *
 * Features:
 *   - Real-time pipeline status with auto-refresh
 *   - Tabbed navigation: Overview, Agents, RCA, Tests, Bugs, Memory, Logs
 *   - Expandable detail views for every entry
 *   - Search and filter across all views
 *   - Responsive design (mobile + desktop)
 *   - Confidence score visualizations
 *   - Timeline view for pipeline steps
 *
 * Start: qa-agent dashboard --port 4000
 */

import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { config } from "../config/index.js";
import { agentLogger } from "../utils/logger.js";

const log = agentLogger("Dashboard");
const app = express();
const MEMORY_DIR = path.resolve(process.cwd(), config.memory.dir);

app.use(express.json());

// ─── CORS for dev ───
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  next();
});

// ─── API Endpoints ───

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/summary", (_req, res) => {
  const logs = readJsonSafe("logs.json");
  const rca = readJsonSafe("rcaMemory.json");
  const tests = readJsonSafe("testResults.json");

  const rcaResults = rca.filter((e: any) => e.type === "rca_result");
  const bugs = tests.filter((e: any) => e.type === "bug_filed");
  const designEntries = tests.filter((e: any) => e.type === "test_design" || e.type === "generated_tests");
  const failures = tests.filter((e: any) => e.type === "failure");
  const selectorFixes = rca.filter((e: any) => e.type === "selector_fix");

  // Compute category breakdown
  const categories: Record<string, number> = {};
  for (const r of rcaResults) {
    const cat = (r.data as any)?.category ?? "UNKNOWN";
    categories[cat] = (categories[cat] ?? 0) + 1;
  }

  // Active agents in last hour
  const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
  const recentLogs = logs.filter((l: any) => (l.timestamp ?? "") > oneHourAgo);
  const activeAgents = [...new Set(recentLogs.map((l: any) => l.agent).filter(Boolean))];

  res.json({
    totalLogs: logs.length,
    totalRCA: rcaResults.length,
    totalTests: designEntries.length,
    totalBugs: bugs.length,
    totalFailures: failures.length,
    totalSelectorFixes: selectorFixes.length,
    activeAgents,
    categories,
    lastActivity: logs.length > 0 ? logs[logs.length - 1]?.timestamp : null,
  });
});

app.get("/api/logs", (req, res) => {
  const agent = req.query.agent as string;
  const event = req.query.event as string;
  const search = (req.query.search as string ?? "").toLowerCase();
  const limit = parseInt(req.query.limit as string) || 100;

  let logs = readJsonSafe("logs.json");
  if (agent) logs = logs.filter((l: any) => l.agent === agent);
  if (event) logs = logs.filter((l: any) => l.event === event);
  if (search) logs = logs.filter((l: any) => JSON.stringify(l).toLowerCase().includes(search));
  logs.sort((a: any, b: any) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  res.json(logs.slice(0, limit));
});

app.get("/api/rca", (_req, res) => {
  const data = readJsonSafe("rcaMemory.json");
  const entries = data.filter((e: any) => e.type === "rca_result");
  entries.sort((a: any, b: any) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  res.json(entries);
});

app.get("/api/tests", (_req, res) => {
  const data = readJsonSafe("testResults.json");
  data.sort((a: any, b: any) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  res.json(data);
});

app.get("/api/bugs", (_req, res) => {
  const data = readJsonSafe("testResults.json");
  const bugs = data.filter((e: any) => e.type === "bug_filed");
  bugs.sort((a: any, b: any) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  res.json(bugs);
});

app.get("/api/memory", (req, res) => {
  const type = req.query.type as string;
  const search = (req.query.search as string ?? "").toLowerCase();
  const files = ["rcaMemory.json", "testResults.json", "logs.json"];
  let all: any[] = [];
  for (const f of files) all.push(...readJsonSafe(f));
  if (type) all = all.filter((e: any) => e.type === type);
  if (search) all = all.filter((e: any) => JSON.stringify(e).toLowerCase().includes(search));
  all.sort((a: any, b: any) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  res.json(all.slice(0, 200));
});

app.get("/api/agents", (_req, res) => {
  const agents: any[] = [];

  // Load VS Code Copilot agents from .github/agents/ (primary)
  const copilotAgentsDir = path.resolve(process.cwd(), ".github", "agents");
  if (fs.existsSync(copilotAgentsDir)) {
    const files = fs.readdirSync(copilotAgentsDir).filter(f => f.endsWith(".agent.md"));
    for (const f of files) {
      const content = fs.readFileSync(path.join(copilotAgentsDir, f), "utf-8");
      // Parse YAML frontmatter
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? "";
      const name = frontmatter.match(/^name:\s*(.+)/m)?.[1]?.replace(/['"]/g, "").trim() ?? f;
      const description = frontmatter.match(/^description:\s*(.+)/m)?.[1]?.replace(/['"]/g, "").trim() ?? "";
      const modelMatch = frontmatter.match(/^model:\s*\n\s*-\s*'([^']+)'/m) ?? frontmatter.match(/^model:\s*'([^']+)'/m);
      const model = modelMatch?.[1] ?? "unknown";
      const tools = (frontmatter.match(/-\s*'([^']+)'/g) ?? [])
        .map(t => t.replace(/-\s*'|'/g, ""))
        .filter(t => !t.startsWith("GPT") && !t.startsWith("Claude")); // exclude model entries
      const slug = f.replace(".agent.md", "");
      agents.push({ slug, name, description, model, tools, file: `.github/agents/${f}`, source: "copilot" });
    }
  }

  // Also load legacy agents from agents/ directory (for backward compatibility)
  const legacyDir = path.resolve(process.cwd(), "agents");
  if (fs.existsSync(legacyDir)) {
    const files = fs.readdirSync(legacyDir).filter(f => f.endsWith(".md"));
    for (const f of files) {
      const slug = f.replace("-agent.md", "").replace(".md", "");
      // Skip if already loaded from .github/agents/
      if (agents.some(a => a.slug === slug)) continue;
      const content = fs.readFileSync(path.join(legacyDir, f), "utf-8");
      const name = content.match(/^# Agent:\s*(.+)/m)?.[1]?.trim() ?? f;
      const model = content.match(/^## Model\s*\n(.+)/m)?.[1]?.trim() ?? "unknown";
      const toolSection = content.match(/## MCP Tools Used\s*\n([\s\S]*?)(?=\n## |\n# |$)/)?.[1] ?? "";
      const tools = (toolSection.match(/^- `(\w+)`/gm) ?? []).map(t => t.replace(/^- `|`$/g, ""));
      agents.push({ slug, name, model, tools, file: `agents/${f}`, source: "legacy" });
    }
  }

  res.json(agents);
});

// ─── Serve Dashboard UI ───
// Note: DASHBOARD_HTML is declared below the route handlers for readability.
// This is safe because Express route callbacks only execute after the module is fully loaded.
app.get("/", (_req, res) => {
  res.type("html").send(DASHBOARD_HTML);
});

// ─── Helpers ───
function readJsonSafe(fileName: string): any[] {
  const filePath = path.join(MEMORY_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

// ─── Start ───
const PORT = parseInt(process.env.DASHBOARD_PORT ?? "4000", 10);
app.listen(PORT, () => {
  log.info(`Dashboard running at http://localhost:${PORT}`);
});

export { app };

// ─── Complete Dashboard HTML ───
const DASHBOARD_HTML = /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QA Agent Dashboard</title>
<style>
:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#c9d1d9;--muted:#8b949e;--accent:#58a6ff;--green:#3fb950;--red:#f85149;--orange:#d29922;--purple:#a371f7;--radius:8px}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}

/* Header */
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 20px;display:flex;align-items:center;gap:12px;position:sticky;top:0;z-index:100}
.header h1{font-size:18px;color:var(--accent);white-space:nowrap}
.header .logo{font-size:24px}
.badge{padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600}
.badge-live{background:var(--green);color:#000}
.badge-count{background:var(--border);color:var(--text)}
.header-right{margin-left:auto;display:flex;align-items:center;gap:8px}
.refresh-btn{background:var(--border);border:1px solid var(--border);color:var(--text);padding:6px 14px;border-radius:var(--radius);cursor:pointer;font-size:13px;transition:all .15s}
.refresh-btn:hover{background:#30363d;border-color:var(--accent)}
.auto-badge{font-size:10px;color:var(--muted)}

/* Tabs */
.tabs{display:flex;gap:2px;padding:0 20px;background:var(--surface);border-bottom:1px solid var(--border);overflow-x:auto}
.tab{padding:10px 16px;cursor:pointer;font-size:13px;font-weight:500;color:var(--muted);border-bottom:2px solid transparent;white-space:nowrap;transition:all .15s}
.tab:hover{color:var(--text)}
.tab.active{color:var(--accent);border-color:var(--accent)}
.tab .tab-count{margin-left:6px;font-size:11px;background:var(--border);padding:1px 6px;border-radius:10px}

/* Layout */
.content{padding:20px;max-width:1400px;margin:0 auto}

/* Cards grid */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.stat-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px;cursor:pointer;transition:all .15s}
.stat-card:hover{border-color:var(--accent);transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.3)}
.stat-card:active{transform:translateY(0)}
.stat-card .label{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin-bottom:4px}
.stat-card .value{font-size:28px;font-weight:700;color:var(--accent)}
.stat-card .sub{font-size:12px;color:var(--muted);margin-top:2px}
.stat-card .click-hint{font-size:10px;color:var(--border);margin-top:6px;transition:color .15s}
.stat-card:hover .click-hint{color:var(--accent)}
.stat-card.green .value{color:var(--green)}
.stat-card.red .value{color:var(--red)}
.stat-card.orange .value{color:var(--orange)}
.stat-card.purple .value{color:var(--purple)}

/* Search */
.search-bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.search-input{flex:1;min-width:200px;background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:var(--radius);font-size:13px;outline:none}
.search-input:focus{border-color:var(--accent)}
.filter-select{background:var(--surface);border:1px solid var(--border);color:var(--text);padding:8px 12px;border-radius:var(--radius);font-size:13px;outline:none}

/* Table */
.table-wrap{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.table{width:100%;border-collapse:collapse;font-size:13px}
.table th{text-align:left;padding:10px 14px;background:rgba(255,255,255,.03);color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border);position:sticky;top:0}
.table td{padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:top}
.table tr:hover{background:rgba(255,255,255,.02)}
.table tr:last-child td{border-bottom:none}

/* Tags/Badges */
.cat-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.cat-PRODUCT_BUG{background:#da3633;color:#fff}
.cat-TEST_BUG{background:var(--orange);color:#000}
.cat-UI_CHANGE{background:#1f6feb;color:#fff}
.cat-LOCATOR_BROKEN{background:#6e7681;color:#fff}
.cat-API_FAILURE{background:var(--purple);color:#fff}
.cat-ENVIRONMENT_ISSUE{background:var(--green);color:#000}
.cat-DATA_ISSUE{background:#f0883e;color:#000}
.sev-blocker{background:var(--red);color:#fff}
.sev-major{background:var(--orange);color:#000}
.sev-minor{background:var(--border);color:var(--text)}

/* Confidence bar */
.conf-bar{display:inline-flex;align-items:center;gap:6px}
.conf-track{width:80px;height:6px;background:var(--border);border-radius:3px;overflow:hidden}
.conf-fill{height:100%;border-radius:3px;transition:width .3s}
.conf-high{background:var(--green)}
.conf-med{background:var(--orange)}
.conf-low{background:var(--red)}

/* Expandable detail */
.detail-row{display:none;background:rgba(0,0,0,.2)}
.detail-row.open{display:table-row}
.detail-content{padding:14px;font-family:'SF Mono',Menlo,monospace;font-size:12px;white-space:pre-wrap;max-height:300px;overflow-y:auto;color:var(--muted)}
.expand-btn{cursor:pointer;color:var(--accent);font-size:12px;user-select:none}
.expand-btn:hover{text-decoration:underline}

/* Agent cards */
.agent-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:12px}
.agent-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px}
.agent-card h3{font-size:15px;margin-bottom:8px;color:var(--text)}
.agent-card .model{font-size:12px;color:var(--purple);margin-bottom:8px}
.agent-card .tools{display:flex;flex-wrap:wrap;gap:4px}
.agent-card .tool-tag{font-size:11px;background:var(--border);padding:2px 8px;border-radius:4px;color:var(--accent)}

/* Timeline */
.timeline{position:relative;padding-left:24px;margin:16px 0}
.timeline::before{content:'';position:absolute;left:8px;top:0;bottom:0;width:2px;background:var(--border)}
.timeline-item{position:relative;margin-bottom:16px;padding:12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius)}
.timeline-item::before{content:'';position:absolute;left:-20px;top:16px;width:10px;height:10px;border-radius:50%;background:var(--accent);border:2px solid var(--bg)}
.timeline-item.success::before{background:var(--green)}
.timeline-item.error::before{background:var(--red)}
.timeline-item .tl-time{font-size:11px;color:var(--muted)}
.timeline-item .tl-agent{font-weight:600;color:var(--purple)}
.timeline-item .tl-event{color:var(--text)}

/* Empty state */
.empty{text-align:center;padding:40px;color:var(--muted)}
.empty-icon{font-size:40px;margin-bottom:8px}

/* Sections hidden by default */
.panel{display:none}
.panel.active{display:block}

/* Responsive */
@media(max-width:768px){
  .header{flex-wrap:wrap;gap:8px}
  .header h1{font-size:15px}
  .stats{grid-template-columns:repeat(2,1fr)}
  .agent-grid{grid-template-columns:1fr}
  .tabs{padding:0 12px}
  .tab{padding:8px 12px;font-size:12px}
  .content{padding:12px}
  .table{font-size:12px}
  .table th,.table td{padding:8px 10px}
}
@media(max-width:480px){
  .stats{grid-template-columns:1fr}
  .search-bar{flex-direction:column}
}
</style>
</head>
<body>

<div class="header">
  <span class="logo">🤖</span>
  <h1>QA Agent Dashboard</h1>
  <span class="badge badge-live" id="statusBadge">Live</span>
  <div class="header-right">
    <span class="auto-badge" id="lastUpdate">—</span>
    <button class="refresh-btn" onclick="loadAll()">↻ Refresh</button>
  </div>
</div>

<div class="tabs" id="tabs">
  <div class="tab active" data-tab="overview">Overview</div>
  <div class="tab" data-tab="agents">Agents</div>
  <div class="tab" data-tab="rca">RCA <span class="tab-count" id="rcaCount">0</span></div>
  <div class="tab" data-tab="tests">Tests</div>
  <div class="tab" data-tab="bugs">Bugs <span class="tab-count" id="bugCount">0</span></div>
  <div class="tab" data-tab="memory">Memory</div>
  <div class="tab" data-tab="logs">Logs <span class="tab-count" id="logCount">0</span></div>
</div>

<div class="content">

<!-- OVERVIEW TAB -->
<div class="panel active" id="panel-overview">
  <div class="stats" id="statsGrid"></div>
  <h3 style="margin-bottom:12px;color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.5px">Recent Activity</h3>
  <div class="timeline" id="timeline"></div>
</div>

<!-- AGENTS TAB -->
<div class="panel" id="panel-agents">
  <div class="agent-grid" id="agentGrid"></div>
</div>

<!-- RCA TAB -->
<div class="panel" id="panel-rca">
  <div class="search-bar">
    <input class="search-input" id="rcaSearch" placeholder="Search RCA results..." oninput="renderRCA()">
    <select class="filter-select" id="rcaCatFilter" onchange="renderRCA()">
      <option value="">All Categories</option>
      <option value="PRODUCT_BUG">Product Bug</option>
      <option value="TEST_BUG">Test Bug</option>
      <option value="UI_CHANGE">UI Change</option>
      <option value="LOCATOR_BROKEN">Locator Broken</option>
      <option value="API_FAILURE">API Failure</option>
      <option value="ENVIRONMENT_ISSUE">Environment</option>
      <option value="DATA_ISSUE">Data Issue</option>
    </select>
  </div>
  <div class="table-wrap"><table class="table" id="rcaTable"><thead><tr>
    <th></th><th>Test</th><th>Category</th><th>Root Cause</th><th>Confidence</th><th>Action</th><th>Time</th>
  </tr></thead><tbody id="rcaBody"></tbody></table></div>
</div>

<!-- TESTS TAB -->
<div class="panel" id="panel-tests">
  <div class="search-bar">
    <input class="search-input" id="testSearch" placeholder="Search tests..." oninput="renderTests()">
    <select class="filter-select" id="testTypeFilter" onchange="renderTests()">
      <option value="">All Types</option>
      <option value="requirement_analysis">Requirements</option>
      <option value="test_design">Test Design</option>
      <option value="generated_tests">Generated Tests</option>
      <option value="failure">Failures</option>
      <option value="selector_fix">Selector Fixes</option>
    </select>
  </div>
  <div class="table-wrap"><table class="table"><thead><tr>
    <th></th><th>Key</th><th>Type</th><th>Time</th>
  </tr></thead><tbody id="testBody"></tbody></table></div>
</div>

<!-- BUGS TAB -->
<div class="panel" id="panel-bugs">
  <div class="search-bar"><input class="search-input" id="bugSearch" placeholder="Search bugs..." oninput="renderBugs()"></div>
  <div class="table-wrap"><table class="table"><thead><tr>
    <th></th><th>Bug ID</th><th>Root Cause</th><th>Test</th><th>Time</th>
  </tr></thead><tbody id="bugBody"></tbody></table></div>
</div>

<!-- MEMORY TAB -->
<div class="panel" id="panel-memory">
  <div class="search-bar">
    <input class="search-input" id="memSearch" placeholder="Search memory..." oninput="renderMemory()">
    <select class="filter-select" id="memTypeFilter" onchange="renderMemory()">
      <option value="">All Types</option>
      <option value="rca_result">RCA Result</option>
      <option value="selector_fix">Selector Fix</option>
      <option value="flaky_test">Flaky Test</option>
      <option value="test_design">Test Design</option>
      <option value="generated_tests">Generated Tests</option>
      <option value="requirement_analysis">Requirement</option>
      <option value="failure">Failure</option>
      <option value="bug_filed">Bug Filed</option>
    </select>
  </div>
  <div class="table-wrap"><table class="table"><thead><tr>
    <th></th><th>Key</th><th>Type</th><th>Data Preview</th><th>Time</th>
  </tr></thead><tbody id="memBody"></tbody></table></div>
</div>

<!-- LOGS TAB -->
<div class="panel" id="panel-logs">
  <div class="search-bar">
    <input class="search-input" id="logSearch" placeholder="Search logs..." oninput="renderLogs()">
    <select class="filter-select" id="logAgentFilter" onchange="renderLogs()">
      <option value="">All Agents</option>
    </select>
  </div>
  <div class="table-wrap"><table class="table"><thead><tr>
    <th>Time</th><th>Agent</th><th>Event</th><th>Data</th>
  </tr></thead><tbody id="logBody"></tbody></table></div>
</div>

</div>

<script>
// ─── State ───
let data = { summary: {}, logs: [], rca: [], tests: [], bugs: [], memory: [], agents: [] };

// ─── Fetch helpers ───
async function fetchJSON(url) {
  try { const r = await fetch(url); return await r.json(); }
  catch { return null; }
}

// ─── Tab switching ───
document.getElementById('tabs').addEventListener('click', e => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  tab.classList.add('active');
  document.getElementById('panel-' + tab.dataset.tab)?.classList.add('active');
});

// ─── Expand/collapse rows ───
function toggleDetail(id) {
  const row = document.getElementById(id);
  if (row) row.classList.toggle('open');
}

// ─── Time formatting ───
function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return Math.floor(diff/1000) + 's ago';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
}

function confClass(v) { return v >= 0.7 ? 'conf-high' : v >= 0.4 ? 'conf-med' : 'conf-low'; }

function actionLabel(a) {
  const m = { fix_test:'🔧 Fix Test', create_bug:'🐛 Create Bug', retry:'🔄 Retry', flag_infra:'🏗 Flag Infra' };
  return m[a] || a || '—';
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function trunc(s, n) { return (s||'').length > n ? (s||'').slice(0,n)+'…' : (s||''); }

// ─── Load all data ───
async function loadAll() {
  const [summary, logs, rca, tests, bugs, memory, agents] = await Promise.all([
    fetchJSON('/api/summary'),
    fetchJSON('/api/logs?limit=200'),
    fetchJSON('/api/rca'),
    fetchJSON('/api/tests'),
    fetchJSON('/api/bugs'),
    fetchJSON('/api/memory'),
    fetchJSON('/api/agents'),
  ]);
  data = {
    summary: summary || {},
    logs: logs || [],
    rca: rca || [],
    tests: tests || [],
    bugs: bugs || [],
    memory: memory || [],
    agents: agents || [],
  };
  renderAll();
  document.getElementById('lastUpdate').textContent = 'Updated ' + new Date().toLocaleTimeString();
}

function renderAll() {
  renderOverview();
  renderAgents();
  renderRCA();
  renderTests();
  renderBugs();
  renderMemory();
  renderLogs();

  // Tab counts
  document.getElementById('rcaCount').textContent = data.rca.length;
  document.getElementById('bugCount').textContent = data.bugs.length;
  document.getElementById('logCount').textContent = data.logs.length;
}

// ─── Navigate to tab ───
function goToTab(tabName, filterType) {
  // Activate the tab
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  const tab = document.querySelector('.tab[data-tab="'+tabName+'"]');
  if (tab) tab.classList.add('active');
  const panel = document.getElementById('panel-'+tabName);
  if (panel) panel.classList.add('active');
  // Apply filter if specified
  if (filterType && tabName === 'memory') {
    const sel = document.getElementById('memTypeFilter');
    if (sel) { sel.value = filterType; renderMemory(); }
  }
  if (filterType && tabName === 'tests') {
    const sel = document.getElementById('testTypeFilter');
    if (sel) { sel.value = filterType; renderTests(); }
  }
  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Overview ───
function renderOverview() {
  const s = data.summary;
  const cards = [
    { label:'Agent Logs', value:s.totalLogs||0, cls:'', tab:'logs', filter:'', icon:'📋', sub: s.lastActivity ? 'Last: '+fmtTime(s.lastActivity) : '' },
    { label:'RCA Results', value:s.totalRCA||0, cls:'purple', tab:'rca', filter:'', icon:'🔍', sub:Object.entries(s.categories||{}).map(([k,v])=>k+': '+v).join(', ')||'None' },
    { label:'Bugs Filed', value:s.totalBugs||0, cls:'red', tab:'bugs', filter:'', icon:'🐛', sub:'' },
    { label:'Test Artifacts', value:s.totalTests||0, cls:'green', tab:'tests', filter:'', icon:'🧪', sub:'' },
    { label:'Failures', value:s.totalFailures||0, cls:s.totalFailures>0?'orange':'green', tab:'tests', filter:'failure', icon:'❌', sub:'' },
    { label:'Selector Fixes', value:s.totalSelectorFixes||0, cls:'', tab:'memory', filter:'selector_fix', icon:'🔗', sub:'Self-healing' },
    { label:'Active Agents', value:(s.activeAgents||[]).length, cls:'', tab:'agents', filter:'', icon:'🤖', sub:(s.activeAgents||[]).join(', ')||'None in last hour' },
    { label:'Memory Entries', value:data.memory.length||0, cls:'', tab:'memory', filter:'', icon:'🧠', sub:'' },
  ];
  document.getElementById('statsGrid').innerHTML = cards.map(c =>
    '<div class="stat-card '+c.cls+'" onclick="goToTab(\\''+c.tab+'\\',\\''+c.filter+'\\')">'
    + '<div class="label">'+c.icon+' '+c.label+'</div>'
    + '<div class="value">'+c.value+'</div>'
    + (c.sub?'<div class="sub">'+esc(trunc(c.sub,60))+'</div>':'')
    + '<div class="click-hint">Click to view →</div>'
    + '</div>'
  ).join('');

  // Timeline
  const recent = data.logs.slice(0, 20);
  if (recent.length === 0) {
    document.getElementById('timeline').innerHTML = '<div class="empty"><div class="empty-icon">📭</div>No activity yet. Run a pipeline to see results.</div>';
    return;
  }
  document.getElementById('timeline').innerHTML = recent.map(l => {
    const isError = (l.event||'').includes('fail') || (l.event||'').includes('error') || (l.event||'').includes('reject');
    const cls = isError ? 'error' : 'success';
    return '<div class="timeline-item '+cls+'"><span class="tl-time">'+fmtTime(l.timestamp)+'</span> <span class="tl-agent">['+esc(l.agent||'?')+']</span> <span class="tl-event">'+esc(l.event||'')+'</span>'
      + (l.data ? '<div style="margin-top:4px;font-size:12px;color:var(--muted)">'+esc(trunc(JSON.stringify(l.data),120))+'</div>' : '')
      + '</div>';
  }).join('');
}

// ─── Agents ───
function renderAgents() {
  const grid = document.getElementById('agentGrid');
  if (data.agents.length === 0) {
    grid.innerHTML = '<div class="empty"><div class="empty-icon">🤖</div>No .md agent definitions found.</div>';
    return;
  }
  grid.innerHTML = data.agents.map(a =>
    '<div class="agent-card"><h3>'+esc(a.name)+'</h3><div class="model">Model: '+esc(a.model)+'</div>'
    + '<div style="font-size:12px;color:var(--muted);margin-bottom:8px">'+esc(a.file)+'</div>'
    + '<div class="tools">'+((a.tools||[]).map(t=>'<span class="tool-tag">'+esc(t)+'</span>').join('')||'<span style="color:var(--muted);font-size:12px">No tools</span>')+'</div></div>'
  ).join('');
}

// ─── RCA ───
function renderRCA() {
  const search = (document.getElementById('rcaSearch')?.value||'').toLowerCase();
  const cat = document.getElementById('rcaCatFilter')?.value||'';
  let items = data.rca;
  if (cat) items = items.filter(r => (r.data?.category) === cat);
  if (search) items = items.filter(r => JSON.stringify(r).toLowerCase().includes(search));

  const body = document.getElementById('rcaBody');
  if (items.length === 0) { body.innerHTML = '<tr><td colspan="7" class="empty">No RCA results</td></tr>'; return; }

  body.innerHTML = items.map((r,i) => {
    const d = r.data || {};
    const conf = d.confidence || 0;
    const detailId = 'rca-detail-'+i;
    return '<tr>'
      + '<td><span class="expand-btn" onclick="toggleDetail(\\''+detailId+'\\')">▶</span></td>'
      + '<td>'+esc(trunc(r.key||d.testName||'—',40))+'</td>'
      + '<td><span class="cat-badge cat-'+(d.category||'')+'">'+esc(d.category||'?')+'</span></td>'
      + '<td>'+esc(trunc(d.rootCause||'',60))+'</td>'
      + '<td><div class="conf-bar"><div class="conf-track"><div class="conf-fill '+confClass(conf)+'" style="width:'+(conf*100)+'%"></div></div><span>'+(conf*100).toFixed(0)+'%</span></div></td>'
      + '<td>'+actionLabel(d.action)+'</td>'
      + '<td>'+fmtTime(r.timestamp)+'</td>'
      + '</tr>'
      + '<tr class="detail-row" id="'+detailId+'"><td colspan="7"><div class="detail-content">'+esc(JSON.stringify(d,null,2))+'</div></td></tr>';
  }).join('');
}

// ─── Tests ───
function renderTests() {
  const search = (document.getElementById('testSearch')?.value||'').toLowerCase();
  const type = document.getElementById('testTypeFilter')?.value||'';
  let items = data.tests;
  if (type) items = items.filter(t => t.type === type);
  if (search) items = items.filter(t => JSON.stringify(t).toLowerCase().includes(search));

  const body = document.getElementById('testBody');
  if (items.length === 0) { body.innerHTML = '<tr><td colspan="4" class="empty">No test data</td></tr>'; return; }

  body.innerHTML = items.slice(0,100).map((t,i) => {
    const detailId = 'test-detail-'+i;
    return '<tr>'
      + '<td><span class="expand-btn" onclick="toggleDetail(\\''+detailId+'\\')">▶</span></td>'
      + '<td>'+esc(trunc(t.key||'—',50))+'</td>'
      + '<td><span class="badge badge-count">'+esc(t.type||'?')+'</span></td>'
      + '<td>'+fmtTime(t.timestamp)+'</td>'
      + '</tr>'
      + '<tr class="detail-row" id="'+detailId+'"><td colspan="4"><div class="detail-content">'+esc(JSON.stringify(t.data||t,null,2))+'</div></td></tr>';
  }).join('');
}

// ─── Bugs ───
function renderBugs() {
  const search = (document.getElementById('bugSearch')?.value||'').toLowerCase();
  let items = data.bugs;
  if (search) items = items.filter(b => JSON.stringify(b).toLowerCase().includes(search));

  const body = document.getElementById('bugBody');
  if (items.length === 0) { body.innerHTML = '<tr><td colspan="5" class="empty">No bugs filed</td></tr>'; return; }

  body.innerHTML = items.map((b,i) => {
    const d = b.data || {};
    const detailId = 'bug-detail-'+i;
    return '<tr>'
      + '<td><span class="expand-btn" onclick="toggleDetail(\\''+detailId+'\\')">▶</span></td>'
      + '<td><strong>#'+(d.bugId||'?')+'</strong></td>'
      + '<td>'+esc(trunc(d.rootCause||d.title||'',60))+'</td>'
      + '<td>'+esc(trunc(b.testName||b.key||'',40))+'</td>'
      + '<td>'+fmtTime(b.timestamp)+'</td>'
      + '</tr>'
      + '<tr class="detail-row" id="'+detailId+'"><td colspan="5"><div class="detail-content">'+esc(JSON.stringify(d,null,2))+'</div></td></tr>';
  }).join('');
}

// ─── Memory ───
function renderMemory() {
  const search = (document.getElementById('memSearch')?.value||'').toLowerCase();
  const type = document.getElementById('memTypeFilter')?.value||'';
  let items = data.memory;
  if (type) items = items.filter(m => m.type === type);
  if (search) items = items.filter(m => JSON.stringify(m).toLowerCase().includes(search));

  const body = document.getElementById('memBody');
  if (items.length === 0) { body.innerHTML = '<tr><td colspan="5" class="empty">No memory entries</td></tr>'; return; }

  body.innerHTML = items.slice(0,100).map((m,i) => {
    const detailId = 'mem-detail-'+i;
    return '<tr>'
      + '<td><span class="expand-btn" onclick="toggleDetail(\\''+detailId+'\\')">▶</span></td>'
      + '<td>'+esc(trunc(m.key||'—',40))+'</td>'
      + '<td><span class="badge badge-count">'+esc(m.type||'?')+'</span></td>'
      + '<td style="color:var(--muted)">'+esc(trunc(JSON.stringify(m.data||{}),80))+'</td>'
      + '<td>'+fmtTime(m.timestamp)+'</td>'
      + '</tr>'
      + '<tr class="detail-row" id="'+detailId+'"><td colspan="5"><div class="detail-content">'+esc(JSON.stringify(m,null,2))+'</div></td></tr>';
  }).join('');
}

// ─── Logs ───
function renderLogs() {
  const search = (document.getElementById('logSearch')?.value||'').toLowerCase();
  const agent = document.getElementById('logAgentFilter')?.value||'';
  let items = data.logs;
  if (agent) items = items.filter(l => l.agent === agent);
  if (search) items = items.filter(l => JSON.stringify(l).toLowerCase().includes(search));

  // Populate agent filter dropdown
  const agentSelect = document.getElementById('logAgentFilter');
  const agents = [...new Set(data.logs.map(l => l.agent).filter(Boolean))];
  const currentVal = agentSelect.value;
  agentSelect.innerHTML = '<option value="">All Agents</option>' + agents.map(a => '<option value="'+a+'"'+(a===currentVal?' selected':'')+'>'+esc(a)+'</option>').join('');

  const body = document.getElementById('logBody');
  if (items.length === 0) { body.innerHTML = '<tr><td colspan="4" class="empty">No logs</td></tr>'; return; }

  body.innerHTML = items.slice(0,200).map(l =>
    '<tr>'
    + '<td style="white-space:nowrap;color:var(--muted)">'+fmtTime(l.timestamp)+'</td>'
    + '<td style="color:var(--purple);font-weight:600">'+esc(l.agent||'?')+'</td>'
    + '<td style="color:var(--accent)">'+esc(l.event||'')+'</td>'
    + '<td style="color:var(--muted);font-size:12px">'+esc(trunc(JSON.stringify(l.data||{}),120))+'</td>'
    + '</tr>'
  ).join('');
}

// ─── Init ───
loadAll();
setInterval(loadAll, 5000);
</script>
</body>
</html>`;
