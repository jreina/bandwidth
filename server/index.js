import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import githubRoutes from './routes/github.js';
import jiraRoutes from './routes/jira.js';
import worktreeRoutes from './routes/worktrees.js';
import repoRoutes from './routes/repos.js';
import stateRoutes from './routes/state.js';
import claudeRoutes from './routes/claude.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_, res) => res.json({ ok: true }));
app.get('/api/config', (_, res) => res.json({
  spotlightProject: process.env.JIRA_SPOTLIGHT_PROJECT || null
}));
app.use('/api/github', githubRoutes);
app.use('/api/jira', jiraRoutes);
app.use('/api/worktrees', worktreeRoutes);
app.use('/api/repos', repoRoutes);
app.use('/api/state', stateRoutes);
app.use('/api/claude', claudeRoutes);

app.listen(PORT, () => {
  console.log(`bandwidth server → http://localhost:${PORT}`);
});
