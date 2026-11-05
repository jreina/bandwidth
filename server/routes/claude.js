import { Router } from 'express';
import { resumeSession, assignToClaude } from '../services/claude.js';

const router = Router();

router.post('/resume', async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }
  try {
    await resumeSession(sessionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/assign', async (req, res) => {
  const { item, worktreePath } = req.body;
  if (!item || !worktreePath) {
    return res.status(400).json({ error: 'item and worktreePath are required' });
  }
  try {
    res.json(await assignToClaude(item, worktreePath));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
