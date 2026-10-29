import { Router } from 'express';
import { resumeSession } from '../services/claude.js';

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

export default router;
