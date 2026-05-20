import { Router } from 'express';
import { getJiraItems } from '../services/jira.js';

const router = Router();

router.get('/items', async (req, res) => {
  try {
    res.json(await getJiraItems());
  } catch (err) {
    console.error('Jira route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
