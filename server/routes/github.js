import { Router } from 'express';
import { getGitHubItems } from '../services/github.js';

const router = Router();

router.get('/items', async (req, res) => {
  try {
    res.json(await getGitHubItems());
  } catch (err) {
    console.error('GitHub route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
