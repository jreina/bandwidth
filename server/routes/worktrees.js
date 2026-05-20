import { Router } from 'express';
import { listWorktrees, createWorktree, removeWorktree } from '../services/git.js';

const router = Router();

router.get('/:repoName', async (req, res) => {
  try {
    res.json(await listWorktrees(req.params.repoName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { repoName, branch } = req.body;
  if (!repoName || !branch) {
    return res.status(400).json({ error: 'repoName and branch are required' });
  }
  try {
    const path = await createWorktree(repoName, branch);
    res.json({ path });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/', async (req, res) => {
  const { repoName, branch } = req.body;
  if (!repoName || !branch) {
    return res.status(400).json({ error: 'repoName and branch are required' });
  }
  try {
    await removeWorktree(repoName, branch);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
