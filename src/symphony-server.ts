import fs from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { ProjectRegistryEntry } from './symphony-routing.js';
import { listReadyIssuesForProject, type SymphonyLinearIssueSummary } from './symphony-linear.js';
import { loadProjectRegistryFromFile } from './symphony-registry.js';
import {
  buildRuntimeState,
  listRunRecords,
  readRunRecord,
  readRuntimeState,
  type SymphonyProjectRuntimeSummary,
  type SymphonyRunRecord,
} from './symphony-state.js';

function htmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function formatTimestamp(value?: string): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function formatRelativeDuration(startedAt: string, endedAt?: string): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return '—';
  }
  const totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function pluralize(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}

function statusClass(status: string): string {
  switch (status) {
    case 'running':
    case 'done':
    case 'enabled':
      return 'status-good';
    case 'planned':
    case 'dispatching':
    case 'review':
      return 'status-warm';
    case 'blocked':
    case 'failed':
    case 'canceled':
      return 'status-bad';
    default:
      return 'status-muted';
  }
}

function renderLink(url: string, label: string): string {
  return `<a href="${htmlEscape(url)}" target="_blank" rel="noreferrer">${htmlEscape(label)}</a>`;
}

function readLogTail(filePath: string, maxChars = 3000): string {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return 'Log file not found.';
    }
    const text = fs.readFileSync(filePath, 'utf8');
    return text.length > maxChars ? text.slice(-maxChars) : text;
  } catch (error) {
    return `Unable to read log: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function loadDashboardSnapshot(registryPath: string) {
  const registry = loadProjectRegistryFromFile(registryPath);
  const runtimeState =
    readRuntimeState() ||
    buildRuntimeState({
      registry,
      readyCounts: Object.fromEntries(
        registry.projects.map((project) => [project.projectKey, 0]),
      ),
      daemonHealthy: false,
    });
  const runs = listRunRecords();
  return { registry, runtimeState, runs };
}

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function pageLayout(input: {
  title: string;
  heading: string;
  subheading: string;
  daemonHealthy: boolean;
  body: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="30" />
  <title>${htmlEscape(input.title)}</title>
  <style>
    :root {
      --ink: #1a1714;
      --ink-soft: #6b6157;
      --paper: #faf8f3;
      --line: rgba(26, 23, 20, 0.1);
      --line-strong: rgba(26, 23, 20, 0.22);
      --accent: #b84a1a;
      --olive: #2a5444;
      --rose: #8b3530;
      --amber: #7a5520;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { color-scheme: light; }
    body {
      color: var(--ink);
      background: var(--paper);
      font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif;
      line-height: 1.5;
      min-height: 100vh;
    }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code, .mono {
      font-family: "SFMono-Regular", Menlo, Monaco, "Courier New", monospace;
      font-size: 0.88em;
      letter-spacing: -0.01em;
    }
    .shell {
      width: min(1080px, calc(100vw - 48px));
      margin: 0 auto;
      padding: 28px 0 56px;
    }

    /* ── Header ── */
    .page-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 20px;
      padding-bottom: 12px;
      border-bottom: 2px solid var(--ink);
      flex-wrap: wrap;
    }
    .page-brand {
      font-size: 0.9rem;
      font-weight: 700;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--ink);
    }
    .page-brand span {
      font-weight: 400;
      color: var(--ink-soft);
      margin-left: 8px;
      letter-spacing: 0;
      text-transform: none;
      font-size: 0.82rem;
    }
    .page-nav {
      display: flex;
      gap: 24px;
      font-size: 0.83rem;
    }
    .page-nav a { color: var(--ink-soft); }
    .page-nav a:hover { color: var(--ink); text-decoration: none; }
    .page-nav a.active { color: var(--ink); font-weight: 600; }

    /* ── Page heading ── */
    .page-heading {
      margin-top: 24px;
    }
    .page-heading h1 {
      font-size: clamp(1.5rem, 3vw, 2.2rem);
      line-height: 1.08;
      letter-spacing: -0.03em;
      font-weight: 600;
    }
    .page-heading p {
      margin-top: 5px;
      font-size: 0.88rem;
      color: var(--ink-soft);
      max-width: 64ch;
    }

    /* ── Stat strip ── */
    .stat-strip {
      display: flex;
      gap: 0;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--line-strong);
      flex-wrap: wrap;
    }
    .stat {
      padding-right: 40px;
      padding-bottom: 4px;
    }
    .stat-label {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--ink-soft);
      margin-bottom: 3px;
    }
    .stat-value {
      font-size: 1.75rem;
      line-height: 1;
      letter-spacing: -0.05em;
      font-variant-numeric: tabular-nums;
    }
    .stat-note {
      font-size: 0.73rem;
      color: var(--ink-soft);
      margin-top: 3px;
    }

    /* ── Sections ── */
    .section {
      margin-top: 40px;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 16px;
      padding-bottom: 7px;
      border-bottom: 1px solid var(--line-strong);
      flex-wrap: wrap;
    }
    .section-head h2 {
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 700;
      color: var(--ink-soft);
    }
    .section-head a {
      font-size: 0.78rem;
      color: var(--ink-soft);
    }

    /* ── Status ── */
    .status-good { color: var(--olive); }
    .status-bad  { color: var(--rose); }
    .status-warm { color: var(--amber); }
    .status-muted { color: var(--ink-soft); }

    /* ── Project rows ── */
    .project-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 24px;
      align-items: start;
      padding: 18px 0;
      border-bottom: 1px solid var(--line);
    }
    .project-row:last-child { border-bottom: none; }
    .project-name {
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }
    .project-name a { color: var(--ink); }
    .project-name a:hover { text-decoration: underline; }
    .project-detail {
      font-size: 0.82rem;
      color: var(--ink-soft);
      margin-top: 3px;
    }
    .project-links {
      display: flex;
      gap: 14px;
      flex-wrap: wrap;
      font-size: 0.78rem;
      color: var(--ink-soft);
      margin-top: 8px;
    }
    .project-links a { color: var(--ink-soft); }
    .project-links a:hover { color: var(--accent); text-decoration: none; }
    .project-counts {
      display: flex;
      gap: 28px;
      text-align: right;
      flex-shrink: 0;
    }
    .project-count-label {
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--ink-soft);
      margin-bottom: 2px;
    }
    .project-count-value {
      font-size: 1.2rem;
      line-height: 1;
      letter-spacing: -0.04em;
      font-variant-numeric: tabular-nums;
    }

    /* ── Runs table ── */
    .run-table {
      width: 100%;
      border-collapse: collapse;
    }
    .run-table th {
      text-align: left;
      font-size: 0.62rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--ink-soft);
      font-weight: 700;
      padding: 9px 16px 9px 0;
      border-bottom: 1px solid var(--line-strong);
      white-space: nowrap;
    }
    .run-table td {
      padding: 11px 16px 11px 0;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
      font-size: 0.87rem;
    }
    .run-table tr:last-child td { border-bottom: none; }
    .run-table td.col-status { width: 80px; }
    .run-table td.col-duration { width: 80px; white-space: nowrap; }
    .run-table td.col-started { width: 140px; white-space: nowrap; color: var(--ink-soft); font-size: 0.8rem; }
    .run-table td.col-backend { width: 100px; color: var(--ink-soft); font-size: 0.8rem; }
    .run-issue { font-weight: 600; letter-spacing: -0.02em; }
    .run-issue a { color: var(--ink); }
    .run-issue a:hover { text-decoration: underline; }
    .run-title { font-size: 0.82rem; color: var(--ink-soft); margin-top: 2px; }
    .run-id { font-size: 0.68rem; color: var(--ink-soft); font-family: "SFMono-Regular", monospace; margin-top: 3px; }
    .run-links { font-size: 0.75rem; margin-top: 4px; display: flex; gap: 12px; }
    .run-links a { color: var(--ink-soft); }
    .run-links a:hover { color: var(--accent); text-decoration: none; }

    /* ── Issue rows ── */
    .issue-row {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 16px;
      padding: 14px 0;
      border-bottom: 1px solid var(--line);
      flex-wrap: wrap;
    }
    .issue-row:last-child { border-bottom: none; }
    .issue-id { font-weight: 600; font-size: 0.88rem; }
    .issue-id a { color: var(--ink); }
    .issue-title { font-size: 0.83rem; color: var(--ink-soft); margin-top: 2px; }
    .issue-meta { font-size: 0.78rem; color: var(--ink-soft); text-align: right; flex-shrink: 0; }

    /* ── KV table ── */
    .kv-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .kv-table td {
      padding: 7px 0;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    .kv-table td:first-child {
      font-size: 0.63rem;
      text-transform: uppercase;
      letter-spacing: 0.09em;
      color: var(--ink-soft);
      white-space: nowrap;
      padding-right: 24px;
      width: 1%;
      font-weight: 600;
    }
    .kv-table tr:last-child td { border-bottom: none; }

    /* ── Detail layout ── */
    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 360px;
      gap: 48px;
      margin-top: 40px;
      align-items: start;
    }
    .panel-head {
      font-size: 0.63rem;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-weight: 700;
      color: var(--ink-soft);
      padding-bottom: 7px;
      border-bottom: 1px solid var(--line-strong);
      margin-bottom: 2px;
    }
    .stack { display: grid; gap: 36px; }

    /* ── Log ── */
    pre.log-tail {
      margin-top: 10px;
      padding: 16px;
      background: #1c1916;
      color: #e0d5c5;
      overflow: auto;
      max-height: 28rem;
      line-height: 1.45;
      font-size: 0.75rem;
      border-radius: 3px;
      font-family: "SFMono-Regular", Menlo, Monaco, monospace;
    }

    /* ── Result summary ── */
    .result-box {
      margin-top: 10px;
      padding: 12px 14px;
      border-left: 3px solid var(--line-strong);
      font-size: 0.85rem;
      color: var(--ink-soft);
    }
    .result-box.error { border-color: var(--rose); color: var(--rose); }

    /* ── Empty state ── */
    .empty-state {
      padding: 16px 0;
      color: var(--ink-soft);
      font-size: 0.85rem;
      font-style: italic;
    }

    /* ── Footer ── */
    .footer-note {
      margin-top: 40px;
      padding-top: 12px;
      border-top: 1px solid var(--line);
      color: var(--ink-soft);
      font-size: 0.73rem;
    }

    @media (max-width: 860px) {
      .detail-grid { grid-template-columns: 1fr; gap: 32px; }
      .project-row { grid-template-columns: 1fr; }
      .project-counts { text-align: left; }
    }
    @media (max-width: 600px) {
      .shell { width: calc(100vw - 24px); }
      .stat-value { font-size: 1.4rem; }
      .stat { padding-right: 24px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <header class="page-header">
      <div class="page-brand">Symphony<span>${input.daemonHealthy ? 'Daemon live' : 'Observe-only'}</span></div>
      <nav class="page-nav" aria-label="Symphony Navigation">
        <a href="/">Overview</a>
        <a href="/projects">Projects</a>
        <a href="/runs">Runs</a>
        <a href="/api/v1/state">API</a>
      </nav>
    </header>
    <div class="page-heading">
      <h1>${htmlEscape(input.heading)}</h1>
      <p>${htmlEscape(input.subheading)}</p>
    </div>
    ${input.body}
  </main>
</body>
</html>`;
}

function buildStatStrip(snapshot: Awaited<ReturnType<typeof loadDashboardSnapshot>>): string {
  const state = snapshot.runtimeState;
  const activeRuns = snapshot.runs.filter(
    (run) => run.status === 'planned' || run.status === 'dispatching' || run.status === 'running',
  ).length;
  const totalReady = Object.values(state.projectReadyCounts).reduce((sum, count) => sum + count, 0);

  return `<div class="stat-strip">
  <div class="stat">
    <div class="stat-label">Projects</div>
    <div class="stat-value">${state.registryProjectCount}</div>
    <div class="stat-note">${pluralize(state.enabledProjectCount, 'enabled lane')}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Ready</div>
    <div class="stat-value">${totalReady}</div>
    <div class="stat-note">Waiting on dispatch</div>
  </div>
  <div class="stat">
    <div class="stat-label">Active</div>
    <div class="stat-value">${activeRuns}</div>
    <div class="stat-note">${state.daemonHealthy ? 'Daemon reconciling' : 'Daemon offline'}</div>
  </div>
  <div class="stat">
    <div class="stat-label">Synced</div>
    <div class="stat-value" style="font-size:1.1rem;letter-spacing:-0.02em">${formatTimestamp(state.updatedAt)}</div>
    <div class="stat-note">${state.daemonPid ? `PID ${state.daemonPid}` : 'No daemon PID'}</div>
  </div>
</div>`;
}

function renderProjectRow(
  project: SymphonyProjectRuntimeSummary,
  registryEntry: ProjectRegistryEntry | undefined,
): string {
  const backends = (registryEntry?.allowedBackends || []).join(', ') || '—';
  return `<div class="project-row" data-project-key="${htmlEscape(project.projectKey)}">
  <div>
    <div class="project-name">
      <a href="/projects/${encodeURIComponent(project.projectKey)}">${htmlEscape(project.displayName)}</a>
    </div>
    <div class="project-detail">
      <span class="${statusClass(project.lastRunStatus)}">${htmlEscape(project.lastRunStatus)}</span>
      &nbsp;·&nbsp;${htmlEscape(project.projectKey)}
      &nbsp;·&nbsp;${htmlEscape(registryEntry?.readyPolicy || 'no policy')}
      &nbsp;·&nbsp;backends: ${htmlEscape(backends)}
    </div>
    <div class="project-links">
      ${registryEntry ? renderLink(registryEntry.notionRoot, 'Notion') : ''}
      ${registryEntry ? renderLink(`https://github.com/${registryEntry.githubRepo}`, registryEntry.githubRepo) : ''}
      ${project.lastRunId ? `<a href="/runs/${encodeURIComponent(project.lastRunId)}">Last run</a>` : ''}
    </div>
  </div>
  <div class="project-counts">
    <div>
      <div class="project-count-label">Ready</div>
      <div class="project-count-value">${project.readyQueueCount}</div>
    </div>
    <div>
      <div class="project-count-label">Active</div>
      <div class="project-count-value">${project.activeRunCount}</div>
    </div>
  </div>
</div>`;
}

function renderRunRow(run: SymphonyRunRecord): string {
  return `<tr data-run-id="${htmlEscape(run.runId)}" data-run-status="${htmlEscape(run.status)}">
  <td>
    <div class="run-issue"><a href="/runs/${encodeURIComponent(run.runId)}">${htmlEscape(run.issueIdentifier)}</a></div>
    <div class="run-title">${htmlEscape(run.issueTitle)}</div>
    <div class="run-links">
      ${renderLink(run.linearIssueUrl, 'Linear')}
      ${renderLink(`https://github.com/${run.githubRepo}`, run.githubRepo)}
    </div>
    <div class="run-id">${htmlEscape(run.runId)}</div>
  </td>
  <td class="col-status"><span class="${statusClass(run.status)}">${htmlEscape(run.status)}</span></td>
  <td class="col-duration">${htmlEscape(formatRelativeDuration(run.startedAt, run.endedAt))}</td>
  <td class="col-started">${htmlEscape(formatTimestamp(run.startedAt))}</td>
  <td class="col-backend">${htmlEscape(run.backend)}</td>
</tr>`;
}

function renderRunTable(rows: string, emptyMessage: string): string {
  if (!rows) {
    return `<div class="empty-state">${emptyMessage}</div>`;
  }
  return `<table class="run-table">
  <thead>
    <tr>
      <th>Issue</th>
      <th>Status</th>
      <th>Duration</th>
      <th>Started</th>
      <th>Backend</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;
}

function renderHome(snapshot: Awaited<ReturnType<typeof loadDashboardSnapshot>>): string {
  const projectRows = snapshot.runtimeState.projects
    .map((project) =>
      renderProjectRow(
        project,
        snapshot.registry.projects.find((entry) => entry.projectKey === project.projectKey),
      ),
    )
    .join('');

  const runRows = snapshot.runs.slice(0, 10).map(renderRunRow).join('');

  return pageLayout({
    title: 'Symphony Control Room',
    heading: 'Symphony Control Room',
    subheading: 'Portfolio view of configured projects, dispatch readiness, and live execution state.',
    daemonHealthy: snapshot.runtimeState.daemonHealthy,
    body: `
      ${buildStatStrip(snapshot)}
      <section class="section" id="project-portfolio">
        <div class="section-head">
          <h2>Project Portfolio</h2>
        </div>
        ${projectRows || '<div class="empty-state">No projects found in the synced registry cache.</div>'}
      </section>
      <section class="section" id="recent-runs">
        <div class="section-head">
          <h2>Recent Run Activity</h2>
          <a href="/runs">All runs</a>
        </div>
        ${renderRunTable(runRows, 'No run records yet. Dispatch one Ready issue to populate the runtime ledger.')}
      </section>
      <p class="footer-note">Auto-refreshes every 30 seconds. Linear is the execution source of truth; this dashboard is the orchestration surface.</p>
    `,
  });
}

function renderIssueRow(issue: SymphonyLinearIssueSummary): string {
  return `<div class="issue-row" data-issue-id="${htmlEscape(issue.id)}">
  <div>
    <div class="issue-id">${renderLink(issue.url, issue.identifier)}</div>
    <div class="issue-title">${htmlEscape(issue.title)}</div>
  </div>
  <div class="issue-meta">
    <div class="status-good">${htmlEscape(issue.state)}</div>
    ${issue.priorityLabel ? `<div>${htmlEscape(issue.priorityLabel)}</div>` : ''}
    ${issue.labels.length ? `<div>${htmlEscape(issue.labels.join(', '))}</div>` : ''}
  </div>
</div>`;
}

function renderProjectDetail(input: {
  snapshot: Awaited<ReturnType<typeof loadDashboardSnapshot>>;
  project: ProjectRegistryEntry;
  readyIssues: SymphonyLinearIssueSummary[];
}): string {
  const runRows = input.snapshot.runs
    .filter((run) => run.projectKey === input.project.projectKey)
    .slice(0, 10)
    .map(renderRunRow)
    .join('');
  const runtime = input.snapshot.runtimeState.projects.find(
    (entry) => entry.projectKey === input.project.projectKey,
  );
  const issueRows = input.readyIssues.map(renderIssueRow).join('');

  return pageLayout({
    title: `${input.project.displayName} · Symphony`,
    heading: input.project.displayName,
    subheading: `${input.project.projectKey} · ${input.project.symphonyEnabled ? 'Symphony enabled' : 'Symphony disabled'}`,
    daemonHealthy: input.snapshot.runtimeState.daemonHealthy,
    body: `
      ${buildStatStrip(input.snapshot)}
      <div class="detail-grid">
        <div class="stack">
          <section id="ready-queue">
            <div class="panel-head">Ready Queue</div>
            ${issueRows || '<div class="empty-state">No Ready Symphony candidates currently visible.</div>'}
          </section>
          <section id="project-runs">
            <div class="panel-head">Recent Runs</div>
            ${renderRunTable(runRows, 'No run history yet for this project.')}
          </section>
        </div>
        <div class="stack">
          <section id="project-policy">
            <div class="panel-head">Project Policy</div>
            <table class="kv-table">
              <tbody>
                <tr><td>Project Key</td><td class="mono">${htmlEscape(input.project.projectKey)}</td></tr>
                <tr><td>Linear Project</td><td>${htmlEscape(input.project.linearProject)}</td></tr>
                <tr><td>Symphony</td><td>${input.project.symphonyEnabled ? 'Enabled' : 'Disabled'}</td></tr>
                <tr><td>Default Backend</td><td class="mono">${htmlEscape(input.project.defaultBackend)}</td></tr>
                <tr><td>Allowed Backends</td><td>${htmlEscape(input.project.allowedBackends.join(', '))}</td></tr>
                <tr><td>Ready Policy</td><td>${htmlEscape(input.project.readyPolicy)}</td></tr>
                <tr><td>Workspace Root</td><td class="mono">${htmlEscape(input.project.workspaceRoot)}</td></tr>
                <tr><td>Secret Scope</td><td class="mono">${htmlEscape(input.project.secretScope)}</td></tr>
              </tbody>
            </table>
            <div class="project-links" style="margin-top:12px">
              ${renderLink(input.project.notionRoot, 'Open Notion root')}
              ${renderLink(`https://github.com/${input.project.githubRepo}`, input.project.githubRepo)}
              ${runtime?.lastRunId ? `<a href="/runs/${encodeURIComponent(runtime.lastRunId)}">Last run</a>` : ''}
            </div>
          </section>
        </div>
      </div>
    `,
  });
}

function renderRunsPage(snapshot: Awaited<ReturnType<typeof loadDashboardSnapshot>>): string {
  const runRows = snapshot.runs.map(renderRunRow).join('');
  return pageLayout({
    title: 'Symphony Run Ledger',
    heading: 'Run Ledger',
    subheading: 'All persisted run records, most recent first.',
    daemonHealthy: snapshot.runtimeState.daemonHealthy,
    body: `
      ${buildStatStrip(snapshot)}
      <section class="section" id="run-ledger">
        <div class="section-head">
          <h2>All Recorded Runs</h2>
        </div>
        ${renderRunTable(runRows, 'No run records have been written yet.')}
      </section>
    `,
  });
}

function renderRunDetail(run: SymphonyRunRecord): string {
  const logTail = readLogTail(run.logFile);
  return pageLayout({
    title: `${run.issueIdentifier} · Symphony`,
    heading: run.issueIdentifier,
    subheading: run.issueTitle,
    daemonHealthy: false,
    body: `
      <div class="stat-strip">
        <div class="stat">
          <div class="stat-label">Status</div>
          <div class="stat-value" style="font-size:1.4rem" class="${statusClass(run.status)}">${htmlEscape(run.status)}</div>
          <div class="stat-note">${htmlEscape(run.backend)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Duration</div>
          <div class="stat-value" style="font-size:1.4rem">${htmlEscape(formatRelativeDuration(run.startedAt, run.endedAt))}</div>
          <div class="stat-note">${htmlEscape(formatTimestamp(run.startedAt))}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Project</div>
          <div class="stat-value" style="font-size:1.1rem;letter-spacing:-0.02em">${htmlEscape(run.projectKey)}</div>
          <div class="stat-note">${htmlEscape(run.githubRepo)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">PID</div>
          <div class="stat-value" style="font-size:1.1rem">${run.pid === null ? '—' : htmlEscape(`${run.pid}`)}</div>
          <div class="stat-note">${run.endedAt ? htmlEscape(formatTimestamp(run.endedAt)) : 'Still active'}</div>
        </div>
      </div>
      <div class="detail-grid">
        <div class="stack">
          <section id="run-metadata">
            <div class="panel-head">Run Metadata</div>
            <table class="kv-table">
              <tbody>
                <tr><td>Linear Issue</td><td>${renderLink(run.linearIssueUrl, run.issueIdentifier)}</td></tr>
                <tr><td>Workspace</td><td class="mono">${htmlEscape(run.workspacePath)}</td></tr>
                <tr><td>Prompt File</td><td class="mono">${htmlEscape(run.promptFile)}</td></tr>
                <tr><td>Manifest File</td><td class="mono">${htmlEscape(run.manifestFile)}</td></tr>
                <tr><td>Log File</td><td class="mono">${htmlEscape(run.logFile)}</td></tr>
                <tr><td>Exit File</td><td class="mono">${htmlEscape(run.exitFile)}</td></tr>
              </tbody>
            </table>
            ${run.error
              ? `<div class="result-box error">${htmlEscape(run.error)}</div>`
              : run.resultSummary
                ? `<div class="result-box">${htmlEscape(run.resultSummary)}</div>`
                : ''}
          </section>
        </div>
        <div class="stack">
          <section id="run-log">
            <div class="panel-head">Latest Log Tail</div>
            <pre class="log-tail">${htmlEscape(logTail)}</pre>
          </section>
        </div>
      </div>
    `,
  });
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  registryPath: string,
): Promise<boolean> {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const snapshot = await loadDashboardSnapshot(registryPath);

  if (url.pathname === '/api/v1/state') {
    sendJson(res, 200, snapshot.runtimeState);
    return true;
  }

  if (url.pathname === '/api/v1/projects') {
    sendJson(
      res,
      200,
      snapshot.registry.projects.map((project) => ({
        ...project,
        runtime:
          snapshot.runtimeState.projects.find((entry) => entry.projectKey === project.projectKey) ||
          null,
      })),
    );
    return true;
  }

  const projectMatch = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)$/);
  if (projectMatch) {
    const projectKey = decodeURIComponent(projectMatch[1] || '');
    const project = snapshot.registry.projects.find((entry) => entry.projectKey === projectKey);
    if (!project) {
      sendJson(res, 404, { error: `Unknown project: ${projectKey}` });
      return true;
    }
    const readyIssues = await listReadyIssuesForProject(project);
    sendJson(res, 200, {
      ...project,
      runtime:
        snapshot.runtimeState.projects.find((entry) => entry.projectKey === project.projectKey) ||
        null,
      readyIssues,
      runs: snapshot.runs.filter((run) => run.projectKey === projectKey),
    });
    return true;
  }

  if (url.pathname === '/api/v1/runs') {
    sendJson(res, 200, snapshot.runs);
    return true;
  }

  const runMatch = url.pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
  if (runMatch) {
    const runId = decodeURIComponent(runMatch[1] || '');
    try {
      sendJson(res, 200, readRunRecord(runId));
    } catch {
      sendJson(res, 404, { error: `Unknown run: ${runId}` });
    }
    return true;
  }

  return false;
}

async function handleHtml(
  req: IncomingMessage,
  res: ServerResponse,
  registryPath: string,
): Promise<void> {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const snapshot = await loadDashboardSnapshot(registryPath);

  if (url.pathname === '/' || url.pathname === '/projects') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderHome(snapshot));
    return;
  }

  const projectMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
  if (projectMatch) {
    const projectKey = decodeURIComponent(projectMatch[1] || '');
    const project = snapshot.registry.projects.find((entry) => entry.projectKey === projectKey);
    if (!project) {
      res.statusCode = 404;
      res.end('Unknown project');
      return;
    }
    const readyIssues = await listReadyIssuesForProject(project);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderProjectDetail({ snapshot, project, readyIssues }));
    return;
  }

  if (url.pathname === '/runs') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderRunsPage(snapshot));
    return;
  }

  const runMatch = url.pathname.match(/^\/runs\/([^/]+)$/);
  if (runMatch) {
    const runId = decodeURIComponent(runMatch[1] || '');
    try {
      const run = readRunRecord(runId);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(renderRunDetail(run));
      return;
    } catch {
      res.statusCode = 404;
      res.end('Unknown run');
      return;
    }
  }

  res.statusCode = 404;
  res.end('Not found');
}

export function startSymphonyServer(input: {
  port: number;
  registryPath: string;
}): Promise<Server> {
  const server = createServer(async (req, res) => {
    try {
      if (await handleApi(req, res, input.registryPath)) {
        return;
      }
      await handleHtml(req, res, input.registryPath);
    } catch (error) {
      sendJson(res, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(input.port, '127.0.0.1', () => resolve(server));
  });
}
