import { readdir, stat, open, mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { execFile, spawn } from 'child_process';
import { listAllWorktrees } from './git.js';
import { buildTaskBrief, sessionName } from './taskBrief.js';

// Claude Code writes one JSONL transcript per session under
// ~/.claude/projects/{encoded-cwd}/{sessionId}.jsonl. Each entry carries the cwd,
// and the file accumulates title entries ("ai-title", "custom-title") over time.
const PROJECTS_DIR = join(homedir(), '.claude', 'projects');
// Transcripts can be many MB — read only the head (for cwd / first prompt) and
// the tail (for latest title / last prompt)
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JIRA_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const GITHUB_REPO_RE = /^[\w.-]+\/[\w.-]+$/;
// Briefs live next to the personal state file (gitignored), not in the worktree
const BRIEFS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../data/briefs');

const cache = new Map(); // file → { mtimeMs, size, session }

async function readRange(file, start, length) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.toString('utf8', 0, bytesRead);
  } finally {
    await fh.close();
  }
}

function parseLines(text, { dropFirst = false, dropLast = false } = {}) {
  const lines = text.split('\n');
  if (dropFirst) lines.shift(); // partial line from reading mid-file
  if (dropLast) lines.pop();
  return lines.flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

// A prompt the user actually typed — not tool results, slash-command wrappers or meta entries
function promptText(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isSidechain) return null;
  const content = entry.message?.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.filter(p => p.type === 'text').map(p => p.text).join('\n')
      : '';
  const trimmed = text.trim();
  if (!trimmed || trimmed.startsWith('<')) return null;
  return trimmed.slice(0, 200);
}

function shellQuote(s) {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

async function readSession(file) {
  const { mtimeMs, size } = await stat(file);
  const cached = cache.get(file);
  if (cached && cached.mtimeMs === mtimeMs && cached.size === size) return cached.session;

  const headText = await readRange(file, 0, Math.min(size, HEAD_BYTES));
  const tailStart = Math.max(0, size - TAIL_BYTES);
  const tailText = size <= HEAD_BYTES ? headText : await readRange(file, tailStart, size - tailStart);
  const head = parseLines(headText, { dropLast: size > HEAD_BYTES });
  const tail = parseLines(tailText, { dropFirst: tailStart > 0 });

  const cwd = head.find(e => e.cwd)?.cwd ?? tail.find(e => e.cwd)?.cwd ?? null;
  let customTitle = null, aiTitle = null, lastPrompt = null;
  for (const entry of tail) {
    if (entry.type === 'custom-title') customTitle = entry.customTitle;
    else if (entry.type === 'ai-title') aiTitle = entry.aiTitle;
    lastPrompt = promptText(entry) ?? lastPrompt;
  }
  const firstPrompt = head.map(promptText).find(Boolean) ?? null;

  const id = basename(file, '.jsonl');
  const title = customTitle || aiTitle || firstPrompt;
  // Sessions with nothing typed in them (e.g. just /login) aren't worth listing
  const session = cwd && title ? {
    id,
    cwd,
    title,
    lastPrompt: lastPrompt ?? firstPrompt,
    lastActiveAt: new Date(mtimeMs).toISOString(),
    resumeCommand: `cd ${shellQuote(cwd)} && claude --resume ${id}`
  } : null;
  cache.set(file, { mtimeMs, size, session });
  return session;
}

export async function listSessions() {
  if (!existsSync(PROJECTS_DIR)) return [];
  const projects = await readdir(PROJECTS_DIR, { withFileTypes: true });
  const files = (await Promise.all(projects.filter(p => p.isDirectory()).map(async p => {
    const dir = join(PROJECTS_DIR, p.name);
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    return entries.filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => join(dir, e.name));
  }))).flat();
  const sessions = await Promise.all(files.map(f => readSession(f).catch(() => null)));
  return sessions.filter(Boolean);
}

function execOutput(cmd, args) {
  // lsof exits 1 when any pid has vanished but still prints the rest, so keep stdout on failure
  return new Promise(resolve => {
    execFile(cmd, args, (_err, stdout) => resolve(stdout || ''));
  });
}

// Working directories of every running `claude` process
async function runningClaudeCwds() {
  const ps = await execOutput('ps', ['-axo', 'pid=,comm=']);
  const pids = ps.split('\n')
    .map(line => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(m => m && basename(m[2]) === 'claude')
    .map(m => m[1]);
  if (pids.length === 0) return [];
  const out = await execOutput('lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fn']);
  return out.split('\n').filter(l => l.startsWith('n')).map(l => l.slice(1));
}

export async function attachClaudeSessions(worktrees) {
  const [sessions, running] = await Promise.all([
    listSessions().catch(() => []),
    runningClaudeCwds().catch(() => [])
  ]);
  return worktrees.map(wt => {
    const inside = p => p === wt.path || p.startsWith(wt.path + '/');
    const claudeSessions = sessions
      .filter(s => inside(s.cwd))
      .sort((a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt));
    const claudeRunning = running.some(inside);
    // The process can't be tied to a session id, but the live one is the most recently written
    if (claudeRunning && claudeSessions[0]) claudeSessions[0] = { ...claudeSessions[0], running: true };
    return {
      ...wt,
      claudeSessions,
      claudeRunning,
      lastSessionAt: claudeSessions[0]?.lastActiveAt ?? null
    };
  });
}

function appleScriptString(s) {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

// Single line, no control characters, short enough for a tab title
function terminalTitle(s) {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80);
}

// Opens a Terminal.app tab titled `title`, showing only that title. Claude
// Code's own title updates are turned off so they don't replace it.
function openInTerminal(command, title) {
  const child = spawn('osascript', [
    '-e', 'tell application "Terminal"',
    '-e', 'activate',
    '-e', `set newTab to do script ${appleScriptString(`export CLAUDE_CODE_DISABLE_TERMINAL_TITLE=1; ${command}`)}`,
    '-e', `set custom title of newTab to ${appleScriptString(terminalTitle(title))}`,
    '-e', 'set title displays custom title of newTab to true',
    '-e', 'set title displays shell path of newTab to false',
    '-e', 'set title displays device name of newTab to false',
    '-e', 'set title displays window size of newTab to false',
    '-e', 'set title displays file name of newTab to false',
    '-e', 'end tell'
  ], { detached: true, stdio: 'ignore' });
  child.unref();
}

// Opens a new Terminal.app window resuming the session in its original directory
export async function resumeSession(sessionId) {
  if (!SESSION_ID_RE.test(sessionId)) throw new Error('Invalid session id');
  const session = (await listSessions()).find(s => s.id === sessionId);
  if (!session) throw new Error('Session not found');
  if (!existsSync(session.cwd)) throw new Error(`Directory no longer exists: ${session.cwd}`);
  openInTerminal(session.resumeCommand, session.title);
}

function validateItem(item) {
  if (item?.source === 'jira') {
    if (!JIRA_KEY_RE.test(item.key ?? '')) throw new Error('Invalid Jira key');
  } else if (item?.source === 'github-pr' || item?.source === 'github-issue') {
    if (!GITHUB_REPO_RE.test(item.repo ?? '') || !Number.isInteger(item.number)) {
      throw new Error('Invalid GitHub repo or number');
    }
  } else {
    throw new Error(`Can't assign a ${item?.source ?? 'unknown'} item to Claude`);
  }
}

// Starts an interactive Claude session in the item's worktree, seeded with a
// task brief. Interactive so Claude can ask questions; the user's default
// permission mode applies.
export async function assignToClaude(item, worktreePath) {
  validateItem(item);
  const worktree = (await listAllWorktrees()).find(wt => wt.path === worktreePath);
  if (!worktree) throw new Error('Worktree not found');

  const brief = await buildTaskBrief(item, worktree);
  await mkdir(BRIEFS_DIR, { recursive: true });
  const slug = (item.key || `${item.repo}-${item.number}`).replace(/[^\w.-]+/g, '-');
  const briefPath = join(BRIEFS_DIR, `${new Date().toISOString().replace(/[:.]/g, '-')}-${slug}.md`);
  await writeFile(briefPath, brief);

  // The brief is read via $(cat …) so its contents never pass through quoting
  const name = sessionName(item);
  openInTerminal(
    `cd ${shellQuote(worktree.path)} && claude -n ${shellQuote(name)} "$(cat ${shellQuote(briefPath)})"`,
    name
  );
  return { briefPath };
}
