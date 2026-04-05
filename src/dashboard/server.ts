/**
 * QA Agent Dashboard — Express server + embedded HTML UI
 *
 * Serves a real-time dashboard showing:
 *   - Pipeline status and agent activity
 *   - Test results and failure details
 *   - RCA results and confidence scores
 *   - Bug tracker
 *   - Memory/logs viewer
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

// ─── API Endpoints ───

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/logs", (req, res) => {
  const agent = req.query.agent as string;
  const limit = parseInt(req.query.limit as string) || 50;
  const data = readJson("logs.json");
  let logs = Array.isArray(data) ? data : [];
  if (agent) logs = logs.filter((l: any) => l.agent === agent);
  logs.sort((a: any, b: any) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  res.json(logs.slice(0, limit));
});

app.get("/api/rca", (_req, res) => {
  const data = readJson("rcaMemory.json");
  const entries = Array.isArray(data) ? data : [];
  const rcaEntries = entries.filter((e: any) => e.type === "rca_result");
  res.json(rcaEntries);
});

app.get("/api/tests", (_req, res) => {
  const data = readJson("testResults.json");
  res.json(Array.isArray(data) ? data : []);
});

app.get("/api/memory", (req, res) => {
  const type = req.query.type as string;
  const files = ["rcaMemory.json", "testResults.json", "logs.json"];
  let all: any[] = [];
  for (const f of files) {
    const data = readJson(f);
    if (Array.isArray(data)) all.push(...data);
  }
  if (type) all = all.filter((e: any) => e.type === type);
  all.sort((a: any, b: any) => (b.timestamp ?? "").localeCompare(a.timestamp ?? ""));
  res.json(all.slice(0, 100));
});

app.get("/api/bugs", (_req, res) => {
  const data = readJson("testResults.json");
  const entries = Array.isArray(data) ? data : [];
  const bugs = entries.filter((e: any) => e.type === "bug_filed");
  res.json(bugs);
});

app.get("/api/summary", (_req, res) => {
  const logs = readJson("logs.json");
  const rca = readJson("rcaMemory.json");
  const tests = readJson("testResults.json");

  const logArr = Array.isArray(logs) ? logs : [];
  const rcaArr = Array.isArray(rca) ? rca : [];
  const testArr = Array.isArray(tests) ? tests : [];

  res.json({
    totalLogs: logArr.length,
    totalRCA: rcaArr.filter((e: any) => e.type === "rca_result").length,
    totalTests: testArr.filter((e: any) => e.type === "test_design" || e.type === "generated_tests").length,
    totalBugs: testArr.filter((e: any) => e.type === "bug_filed").length,
    recentAgents: [...new Set(logArr.slice(-20).map((l: any) => l.agent))],
  });
});

// ─── Serve Dashboard UI ───

app.get("/", (_req, res) => {
  res.send(DASHBOARD_HTML);
});

// ─── Helpers ───

function readJson(fileName: string): unknown {
  const filePath = path.join(MEMORY_DIR, fileName);
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return [];
  }
}

// ─── Start ───

const PORT = parseInt(process.env.DASHBOARD_PORT ?? "4000", 10);
app.listen(PORT, () => {
  log.info(`Dashboard running at http://localhost:${PORT}`);
});

// ─── Embedded Dashboard HTML ───

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>QA Agent Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0d1117; color: #c9d1d9; }
    .header { background: #161b22; border-bottom: 1px solid #30363d; padding: 16px 24px; display: flex; align-items: center; gap: 12px; }
    .header h1 { font-size: 20px; color: #58a6ff; }
    .header .badge { background: #238636; color: #fff; padding: 2px 8px; border-radius: 12px; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; padding: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
    .card h2 { font-size: 14px; color: #8b949e; text-transform: uppercase; margin-bottom: 12px; }
    .stat { font-size: 32px; font-weight: 700; color: #58a6ff; }
    .stat-label { font-size: 12px; color: #8b949e; }
    .log-entry { padding: 8px; border-bottom: 1px solid #21262d; font-size: 13px; font-family: monospace; }
    .log-entry .agent { color: #d2a8ff; font-weight: 600; }
    .log-entry .event { color: #79c0ff; }
    .log-entry .time { color: #484f58; font-size: 11px; }
    .rca-entry { padding: 10px; border-bottom: 1px solid #21262d; }
    .rca-cat { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600; }
    .rca-cat.PRODUCT_BUG { background: #da3633; color: #fff; }
    .rca-cat.TEST_BUG { background: #d29922; color: #000; }
    .rca-cat.UI_CHANGE { background: #1f6feb; color: #fff; }
    .rca-cat.LOCATOR_BROKEN { background: #6e7681; color: #fff; }
    .rca-cat.API_FAILURE { background: #a371f7; color: #fff; }
    .rca-cat.ENVIRONMENT_ISSUE { background: #3fb950; color: #000; }
    .rca-cat.DATA_ISSUE { background: #f0883e; color: #000; }
    .confidence-bar { display: inline-block; width: 100px; height: 8px; background: #21262d; border-radius: 4px; overflow: hidden; vertical-align: middle; }
    .confidence-fill { height: 100%; background: #58a6ff; border-radius: 4px; }
    .refresh-btn { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 13px; }
    .refresh-btn:hover { background: #30363d; }
    .full-width { grid-column: 1 / -1; }
    .scroll { max-height: 400px; overflow-y: auto; }
  </style>
</head>
<body>
  <div class="header">
    <h1>QA Agent Dashboard</h1>
    <span class="badge">Live</span>
    <div style="flex:1"></div>
    <button class="refresh-btn" onclick="loadAll()">Refresh</button>
  </div>

  <div class="grid">
    <div class="card"><h2>Total Logs</h2><div class="stat" id="totalLogs">—</div></div>
    <div class="card"><h2>RCA Results</h2><div class="stat" id="totalRCA">—</div></div>
    <div class="card"><h2>Bugs Filed</h2><div class="stat" id="totalBugs">—</div></div>
    <div class="card"><h2>Active Agents</h2><div class="stat" id="activeAgents">—</div></div>

    <div class="card full-width">
      <h2>Recent Agent Activity</h2>
      <div class="scroll" id="logsContainer">Loading...</div>
    </div>

    <div class="card">
      <h2>RCA Results</h2>
      <div class="scroll" id="rcaContainer">Loading...</div>
    </div>

    <div class="card">
      <h2>Bugs</h2>
      <div class="scroll" id="bugsContainer">Loading...</div>
    </div>
  </div>

  <script>
    async function fetchJSON(url) {
      const res = await fetch(url);
      return res.json();
    }

    async function loadAll() {
      // Summary
      const summary = await fetchJSON('/api/summary');
      document.getElementById('totalLogs').textContent = summary.totalLogs;
      document.getElementById('totalRCA').textContent = summary.totalRCA;
      document.getElementById('totalBugs').textContent = summary.totalBugs;
      document.getElementById('activeAgents').textContent = (summary.recentAgents || []).length;

      // Logs
      const logs = await fetchJSON('/api/logs?limit=30');
      document.getElementById('logsContainer').innerHTML = logs.map(l =>
        '<div class="log-entry">' +
          '<span class="time">' + (l.timestamp || '').slice(11, 19) + '</span> ' +
          '<span class="agent">[' + (l.agent || '?') + ']</span> ' +
          '<span class="event">' + (l.event || '') + '</span> ' +
          (l.data ? '<span style="color:#484f58"> ' + JSON.stringify(l.data).slice(0, 80) + '</span>' : '') +
        '</div>'
      ).join('') || '<div class="log-entry">No logs yet</div>';

      // RCA
      const rca = await fetchJSON('/api/rca');
      document.getElementById('rcaContainer').innerHTML = rca.map(r => {
        const d = r.data || {};
        const conf = (d.confidence || 0) * 100;
        return '<div class="rca-entry">' +
          '<span class="rca-cat ' + (d.category || '') + '">' + (d.category || '?') + '</span> ' +
          '<div style="margin-top:4px">' + (d.rootCause || r.key || '').slice(0, 100) + '</div>' +
          '<div style="margin-top:4px"><span class="confidence-bar"><span class="confidence-fill" style="width:' + conf + '%"></span></span> ' + conf.toFixed(0) + '%</div>' +
        '</div>';
      }).join('') || '<div class="rca-entry">No RCA results</div>';

      // Bugs
      const bugs = await fetchJSON('/api/bugs');
      document.getElementById('bugsContainer').innerHTML = bugs.map(b => {
        const d = b.data || {};
        return '<div class="rca-entry">' +
          '<strong>Bug #' + (d.bugId || '?') + '</strong> ' +
          '<div style="margin-top:4px">' + (d.title || d.rootCause || '').slice(0, 100) + '</div>' +
        '</div>';
      }).join('') || '<div class="rca-entry">No bugs filed</div>';
    }

    loadAll();
    setInterval(loadAll, 10000);
  </script>
</body>
</html>`;

export { app };
