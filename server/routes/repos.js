import { Router } from 'express';
import { listLocalRepos } from '../services/git.js';

const router = Router();

router.get('/', (_req, res) => {
  try {
    res.json(listLocalRepos());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
