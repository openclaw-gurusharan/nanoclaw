#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const DEFAULT_STATE_PATH = path.join(
  ROOT_DIR,
  '.nanoclaw',
  'nightly-improvement',
  'state.json',
);
const MAX_TRACKED_EVALUATIONS = 100;
const MAX_UPSTREAM_COMMITS = 12;
const MAX_TOOL_CANDIDATES = 3;
const REPO_OWNER = process.env.NANOCLAW_NIGHTLY_REPO_OWNER || 'ingpoc';
const REPO_NAME = process.env.NANOCLAW_NIGHTLY_REPO_NAME || 'nanoclaw';
const EXPECTED_GH_USER = process.env.NANOCLAW_PLATFORM_GH_ACCOUNT || 'ingpoc';
const UPSTREAM_REMOTE = process.env.NANOCLAW_NIGHTLY_UPSTREAM_REMOTE || 'upstream';
const UPSTREAM_BRANCH = process.env.NANOCLAW_NIGHTLY_UPSTREAM_BRANCH || 'main';

const DISCUSSION_KINDS = {
  upstream: {
    title: '[Nightly] NanoClaw Upstream Sync',
    categorySlug: 'upstream-nanoclaw-sync',
    marker: '<!-- nightly-improvement:upstream -->',
  },
  tooling: {
    title: '[Nightly] SDK and Tooling Opportunities',
    categorySlug: 'sdk-tooling-opportunities',
    marker: '<!-- nightly-improvement:tooling -->',
  },
};

const TOOL_SOURCES = [
  {
    key: 'claude_code',
    displayName: 'Claude Code',
    owner: 'anthropics',
    repo: 'claude-code',
  },
  {
    key: 'claude_agent_sdk',
    displayName: 'Claude Agent SDK',
    owner: 'anthropics',
    repo: 'claude-agent-sdk-typescript',
  },
  {
    key: 'opencode',
    displayName: 'OpenCode',
    owner: 'sst',
    repo: 'opencode',
  },
];

function usage() {
  console.log(`Usage: node scripts/workflow/nightly-improvement.js <command> [options]

Commands:
  scan [--output <path>] [--force] [--force-source <key>] [--force-key <key>]
  record --scan-file <path> [--upstream-discussion-number <n>] [--tooling-discussion-number <n>]
  upsert-discussion --kind <upstream|tooling> (--body-file <path> | --body-stdin) [--title <title>]
  comment-decision --discussion-number <n> --decision <pilot|defer|reject> --summary <text>
    [--agent-label <label>] [--to <agent>] [--status <status>] [--next <text>]
`);
}

function parseArgs(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      const existing = options.get(key) || [];
      existing.push('true');
      options.set(key, existing);
      continue;
    }
    const existing = options.get(key) || [];
    existing.push(next);
    options.set(key, existing);
    index += 1;
  }
  return options;
}

function optionValue(options, key) {
  return (options.get(key) || [])[0] || null;
}

function optionValues(options, key) {
  return options.get(key) || [];
}

function runGit(args) {
  return execFileSync('git', args, {
    cwd: ROOT_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function resolveToken() {
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.ADD_TO_PROJECT_PAT ||
    process.env.GH_TOKEN ||
    '';
  if (token) return token;

  try {
    return execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function hasExplicitGithubToken() {
  return Boolean(
    process.env.GITHUB_TOKEN || process.env.ADD_TO_PROJECT_PAT || process.env.GH_TOKEN,
  );
}

function activeGhUser() {
  try {
    return execFileSync('gh', ['api', 'user', '-q', '.login'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function ensureExpectedGhUser(expectedUser) {
  if (hasExplicitGithubToken()) return;
  const activeUser = activeGhUser();
  if (!activeUser) {
    throw new Error(`Unable to determine active gh account; expected ${expectedUser}`);
  }
  if (activeUser !== expectedUser) {
    throw new Error(`Active gh account must be ${expectedUser}; found ${activeUser}`);
  }
}

async function githubGraphql(query, variables) {
  ensureExpectedGhUser(EXPECTED_GH_USER);
  const token = resolveToken();
  if (!token) {
    throw new Error('Missing GitHub token. Set GITHUB_TOKEN, ADD_TO_PROJECT_PAT, or authenticate gh.');
  }

  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'nanoclaw-nightly-improvement',
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    throw new Error(
      `GitHub GraphQL request failed: ${response.status} ${
        response.statusText
      }\n${JSON.stringify(payload.errors || payload, null, 2)}`,
    );
  }

  return payload.data;
}

async function githubRest(url) {
  ensureExpectedGhUser(EXPECTED_GH_USER);
  const token = resolveToken();
  if (!token) {
    throw new Error('Missing GitHub token. Set GITHUB_TOKEN, ADD_TO_PROJECT_PAT, or authenticate gh.');
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'nanoclaw-nightly-improvement',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub REST request failed: ${response.status} ${response.statusText}\n${text}`);
  }

  return response.json();
}

function defaultState() {
  return {
    schema_version: 1,
    last_run_at: null,
    last_upstream_sha: null,
    tool_versions: {},
    discussion_refs: {},
    evaluated_keys: {},
  };
}

function loadState(statePath = DEFAULT_STATE_PATH) {
  if (!fs.existsSync(statePath)) {
    return defaultState();
  }
  const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return {
    ...defaultState(),
    ...parsed,
    tool_versions: parsed.tool_versions || {},
    discussion_refs: parsed.discussion_refs || {},
    evaluated_keys: parsed.evaluated_keys || {},
  };
}

function saveState(state, statePath = DEFAULT_STATE_PATH) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function nowIso() {
  return new Date().toISOString();
}

export function buildEvaluationKey(sourceKey, cursor) {
  if (sourceKey === 'upstream') {
    return `upstream:${cursor}`;
  }
  return `tool:${sourceKey}@${cursor}`;
}

export function shouldProcessEvaluation({
  evaluatedKeys,
  evaluationKey,
  sourceKey,
  force = false,
  forceSources = [],
  forceKeys = [],
}) {
  if (force) return true;
  if (forceKeys.includes(evaluationKey)) return true;
  if (forceSources.includes(sourceKey)) return true;
  return !evaluatedKeys[evaluationKey];
}

export function pruneEvaluatedKeys(evaluatedKeys) {
  const entries = Object.entries(evaluatedKeys || {}).sort((left, right) =>
    String(right[1]?.evaluatedAt || '').localeCompare(String(left[1]?.evaluatedAt || '')),
  );
  return Object.fromEntries(entries.slice(0, MAX_TRACKED_EVALUATIONS));
}

export function applyNightlyRecord(
  previousState,
  scan,
  refs = {},
  recordedAt = nowIso(),
) {
  const nextState = {
    ...defaultState(),
    ...previousState,
    last_run_at: recordedAt,
    last_upstream_sha: scan.upstream?.toSha || previousState.last_upstream_sha || null,
    tool_versions: {
      ...(previousState.tool_versions || {}),
    },
    discussion_refs: {
      ...(previousState.discussion_refs || {}),
    },
    evaluated_keys: {
      ...(previousState.evaluated_keys || {}),
    },
  };

  const deferredToolKeys = new Set(
    (scan.tooling?.deferredCandidates || []).map((candidate) => candidate.key),
  );
  for (const [toolKey, currentVersion] of Object.entries(
    scan.tooling?.currentVersions || {},
  )) {
    if (deferredToolKeys.has(toolKey)) continue;
    nextState.tool_versions[toolKey] = currentVersion;
  }

  if (refs.upstreamDiscussionNumber) {
    nextState.discussion_refs.upstream = {
      number: Number(refs.upstreamDiscussionNumber),
      kind: 'upstream',
    };
  }
  if (refs.toolingDiscussionNumber) {
    nextState.discussion_refs.tooling = {
      number: Number(refs.toolingDiscussionNumber),
      kind: 'tooling',
    };
  }

  if (scan.upstream?.pending && scan.upstream.evaluationKey) {
    nextState.evaluated_keys[scan.upstream.evaluationKey] = {
      kind: 'upstream',
      cursor: scan.upstream.toSha,
      discussionNumber: refs.upstreamDiscussionNumber
        ? Number(refs.upstreamDiscussionNumber)
        : previousState.discussion_refs?.upstream?.number || null,
      evaluatedAt: recordedAt,
    };
  }

  for (const candidate of scan.tooling?.candidates || []) {
    if (!candidate.pending || !candidate.evaluationKey) continue;
    nextState.evaluated_keys[candidate.evaluationKey] = {
      kind: 'tooling',
      sourceKey: candidate.key,
      cursor: candidate.currentVersion,
      discussionNumber: refs.toolingDiscussionNumber
        ? Number(refs.toolingDiscussionNumber)
        : previousState.discussion_refs?.tooling?.number || null,
      evaluatedAt: recordedAt,
    };
  }

  nextState.evaluated_keys = pruneEvaluatedKeys(nextState.evaluated_keys);
  return nextState;
}

function parseCommitLines(rawValue) {
  return rawValue
    .split('\x1e')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, body] = line.split('\x1f');
      return { sha, subject, body: body?.trim() || '' };
    });
}

function fetchUpstreamSummary(previousSha) {
  const remoteRef = `${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}`;
  runGit(['fetch', '--prune', UPSTREAM_REMOTE, UPSTREAM_BRANCH]);
  const headSha = runGit(['rev-parse', '--verify', `${remoteRef}^{commit}`]);
  const changed = previousSha !== headSha;
  const commitRange = previousSha ? `${previousSha}..${headSha}` : headSha;
  let commitCount = 0;
  let commits = [];

  if (changed) {
    const rawCommits = runGit([
      'log',
      '--max-count',
      String(MAX_UPSTREAM_COMMITS),
      '--format=%H%x1f%s%x1f%b%x1e',
      commitRange,
    ]);
    commits = parseCommitLines(rawCommits).map((commit) => ({
      ...commit,
      shortSha: commit.sha.slice(0, 7),
      url: `https://github.com/qwibitai/nanoclaw/commit/${commit.sha}`,
      evaluationKey: buildEvaluationKey('upstream', headSha),
    }));
    commitCount = previousSha
      ? Number.parseInt(runGit(['rev-list', '--count', commitRange]), 10)
      : commits.length;
  }

  return {
    bootstrap: !previousSha,
    fromSha: previousSha,
    toSha: headSha,
    changed,
    commitCount,
    commits,
  };
}

async function fetchLatestToolRelease(tool) {
  const releaseBase = `https://api.github.com/repos/${tool.owner}/${tool.repo}`;
  try {
    const release = await githubRest(`${releaseBase}/releases/latest`);
    return {
      version: release.tag_name || release.name || 'unknown',
      url: release.html_url || `https://github.com/${tool.owner}/${tool.repo}/releases`,
      bodyExcerpt: String(release.body || '').slice(0, 5000),
      publishedAt: release.published_at || null,
      sourceType: 'release',
    };
  } catch {
    const tags = await githubRest(`${releaseBase}/tags?per_page=1`);
    const tag = Array.isArray(tags) ? tags[0] : null;
    if (!tag) {
      throw new Error(`Unable to resolve latest version for ${tool.displayName}`);
    }
    return {
      version: tag.name,
      url: `https://github.com/${tool.owner}/${tool.repo}/tree/${tag.name}`,
      bodyExcerpt: '',
      publishedAt: null,
      sourceType: 'tag',
    };
  }
}

async function listRecentDiscussions() {
  const data = await githubGraphql(
    `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          discussions(first: 30, orderBy: { field: UPDATED_AT, direction: DESC }) {
            nodes {
              id
              number
              title
              body
              url
              updatedAt
              category { slug name }
              comments(first: 20) {
                nodes {
                  body
                }
              }
            }
          }
        }
      }
    `,
    { owner: REPO_OWNER, repo: REPO_NAME },
  );

  return data.repository.discussions.nodes;
}

function findDiscussionByKind(discussions, kind, knownNumber = null) {
  const config = DISCUSSION_KINDS[kind];
  return (
    discussions.find(
      (discussion) =>
        Number(knownNumber || 0) > 0 && discussion.number === Number(knownNumber),
    ) ||
    discussions.find(
      (discussion) =>
        discussion.category?.slug === config.categorySlug &&
        String(discussion.body || '').includes(config.marker),
    ) ||
    null
  );
}

function discussionSummary(discussion) {
  if (!discussion) return null;
  return {
    number: discussion.number,
    title: discussion.title,
    url: discussion.url,
    updatedAt: discussion.updatedAt,
  };
}

async function buildScan(options) {
  const statePath = optionValue(options, 'state-path') || DEFAULT_STATE_PATH;
  const state = loadState(statePath);
  const force = options.has('force');
  const forceSources = optionValues(options, 'force-source');
  const forceKeys = optionValues(options, 'force-key');
  const discussions = await listRecentDiscussions();

  const upstreamSummary = fetchUpstreamSummary(state.last_upstream_sha);
  const upstreamEvaluationKey = buildEvaluationKey('upstream', upstreamSummary.toSha);
  const upstreamPending =
    upstreamSummary.changed &&
    shouldProcessEvaluation({
      evaluatedKeys: state.evaluated_keys,
      evaluationKey: upstreamEvaluationKey,
      sourceKey: 'upstream',
      force,
      forceSources,
      forceKeys,
    });

  const toolingCandidates = [];
  for (const tool of TOOL_SOURCES) {
    const latest = await fetchLatestToolRelease(tool);
    const previousVersion = state.tool_versions?.[tool.key] || null;
    const changed = previousVersion !== latest.version;
    const evaluationKey = buildEvaluationKey(tool.key, latest.version);
    const pending =
      changed &&
      shouldProcessEvaluation({
        evaluatedKeys: state.evaluated_keys,
        evaluationKey,
        sourceKey: tool.key,
        force,
        forceSources,
        forceKeys,
      });

    toolingCandidates.push({
      ...tool,
      previousVersion,
      currentVersion: latest.version,
      changed,
      pending,
      evaluationKey,
      url: latest.url,
      publishedAt: latest.publishedAt,
      sourceType: latest.sourceType,
      bodyExcerpt: latest.bodyExcerpt,
    });
  }

  const pendingTooling = toolingCandidates.filter((candidate) => candidate.pending);
  const limitedTooling = pendingTooling.slice(0, MAX_TOOL_CANDIDATES);
  const deferredTooling = pendingTooling.slice(MAX_TOOL_CANDIDATES).map((candidate) => ({
    key: candidate.key,
    currentVersion: candidate.currentVersion,
  }));

  return {
    action: upstreamPending || limitedTooling.length > 0 ? 'evaluate' : 'noop',
    generatedAt: nowIso(),
    statePath,
    limits: {
      maxUpstreamCommits: MAX_UPSTREAM_COMMITS,
      maxToolCandidates: MAX_TOOL_CANDIDATES,
    },
    upstream: {
      ...upstreamSummary,
      pending: upstreamPending,
      evaluationKey: upstreamEvaluationKey,
      discussion: discussionSummary(
        findDiscussionByKind(
          discussions,
          'upstream',
          state.discussion_refs?.upstream?.number,
        ),
      ),
    },
    tooling: {
      discussion: discussionSummary(
        findDiscussionByKind(
          discussions,
          'tooling',
          state.discussion_refs?.tooling?.number,
        ),
      ),
      candidates: limitedTooling,
      deferredCandidates: deferredTooling,
      currentVersions: Object.fromEntries(
        toolingCandidates.map((candidate) => [candidate.key, candidate.currentVersion]),
      ),
    },
  };
}

async function upsertDiscussion(kind, body, titleOverride = null, statePath = DEFAULT_STATE_PATH) {
  const config = DISCUSSION_KINDS[kind];
  if (!config) {
    throw new Error(`Unsupported discussion kind: ${kind}`);
  }

  const title = titleOverride || config.title;
  const state = loadState(statePath);
  const discussions = await listRecentDiscussions();
  const existing = findDiscussionByKind(
    discussions,
    kind,
    state.discussion_refs?.[kind]?.number,
  );

  if (existing) {
    const data = await githubGraphql(
      `
        mutation($discussionId: ID!, $title: String!, $body: String!) {
          updateDiscussion(input: {
            discussionId: $discussionId
            title: $title
            body: $body
          }) {
            discussion {
              id
              number
              url
              title
            }
          }
        }
      `,
      { discussionId: existing.id, title, body },
    );
    return {
      kind,
      action: 'updated',
      ...data.updateDiscussion.discussion,
    };
  }

  const data = await githubGraphql(
    `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          id
          discussionCategories(first: 20) {
            nodes {
              id
              slug
            }
          }
        }
      }
    `,
    { owner: REPO_OWNER, repo: REPO_NAME },
  );
  const category = data.repository.discussionCategories.nodes.find(
    (node) => node.slug === config.categorySlug,
  );
  if (!category) {
    throw new Error(`Unable to find discussion category slug: ${config.categorySlug}`);
  }

  const created = await githubGraphql(
    `
      mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
        createDiscussion(input: {
          repositoryId: $repositoryId
          categoryId: $categoryId
          title: $title
          body: $body
        }) {
          discussion {
            id
            number
            url
            title
          }
        }
      }
    `,
    {
      repositoryId: data.repository.id,
      categoryId: category.id,
      title,
      body,
    },
  );

  return {
    kind,
    action: 'created',
    ...created.createDiscussion.discussion,
  };
}

async function addDecisionComment(discussionNumber, decision, summary, extras = {}) {
  const discussions = await listRecentDiscussions();
  const discussion = discussions.find(
    (candidate) => candidate.number === Number(discussionNumber),
  );
  if (!discussion) {
    throw new Error(`Unable to resolve discussion #${discussionNumber}`);
  }

  const bodyLines = [
    '<!-- nightly-improvement-decision -->',
    `Agent Label: ${extras.agentLabel || 'Claude Code'}`,
    `Decision: ${decision}`,
    `Summary: ${summary}`,
  ];

  if (extras.to) {
    bodyLines.push(`To: ${extras.to}`);
  }
  if (extras.status) {
    bodyLines.push(`Status: ${extras.status}`);
  }
  if (extras.next) {
    bodyLines.push(`Next: ${extras.next}`);
  }

  const body = bodyLines.join('\n');

  const data = await githubGraphql(
    `
      mutation($discussionId: ID!, $body: String!) {
        addDiscussionComment(input: {
          discussionId: $discussionId
          body: $body
        }) {
          comment {
            id
            url
          }
        }
      }
    `,
    { discussionId: discussion.id, body },
  );

  return data.addDiscussionComment.comment;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeOutput(value, outputPath = null) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, rendered);
    return;
  }
  process.stdout.write(rendered);
}

async function main() {
  const command = process.argv[2];
  const options = parseArgs(process.argv.slice(3));

  switch (command) {
    case 'scan': {
      const scan = await buildScan(options);
      writeOutput(scan, optionValue(options, 'output'));
      return;
    }

    case 'record': {
      const scanFile = optionValue(options, 'scan-file');
      if (!scanFile) {
        throw new Error('record requires --scan-file');
      }
      const statePath = optionValue(options, 'state-path') || DEFAULT_STATE_PATH;
      const state = loadState(statePath);
      const scan = readJsonFile(scanFile);
      const nextState = applyNightlyRecord(state, scan, {
        upstreamDiscussionNumber: optionValue(options, 'upstream-discussion-number'),
        toolingDiscussionNumber: optionValue(options, 'tooling-discussion-number'),
      });
      saveState(nextState, statePath);
      writeOutput(nextState);
      return;
    }

    case 'upsert-discussion': {
      const kind = optionValue(options, 'kind');
      const bodyFile = optionValue(options, 'body-file');
      const useBodyStdin = options.has('body-stdin');
      if (!kind || (!bodyFile && !useBodyStdin)) {
        throw new Error(
          'upsert-discussion requires --kind and either --body-file or --body-stdin',
        );
      }
      const result = await upsertDiscussion(
        kind,
        useBodyStdin ? fs.readFileSync(0, 'utf8') : fs.readFileSync(bodyFile, 'utf8'),
        optionValue(options, 'title'),
        optionValue(options, 'state-path') || DEFAULT_STATE_PATH,
      );
      writeOutput(result);
      return;
    }

    case 'comment-decision': {
      const discussionNumber = optionValue(options, 'discussion-number');
      const decision = optionValue(options, 'decision');
      const summary = optionValue(options, 'summary');
      const agentLabel = optionValue(options, 'agent-label');
      const to = optionValue(options, 'to');
      const status = optionValue(options, 'status');
      const next = optionValue(options, 'next');
      if (!discussionNumber || !decision || !summary) {
        throw new Error(
          'comment-decision requires --discussion-number, --decision, and --summary',
        );
      }
      const result = await addDecisionComment(discussionNumber, decision, summary, {
        agentLabel,
        to,
        status,
        next,
      });
      writeOutput(result);
      return;
    }

    default:
      usage();
      if (command) {
        process.exitCode = 1;
      }
  }
}

const isMainModule =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
