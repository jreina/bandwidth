import { Router } from 'express';
import { getState, annotate, addCommitment, removeCommitment } from '../services/store.js';

const router = Router();

router.get('/', async (_req, res) => {
  try {
    res.json(await getState());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Item ids can contain slashes (ad-hoc worktrees), so the id goes in the body
router.put('/annotations', async (req, res) => {
  const { id, ...patch } = req.body;
  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }
  try {
    res.json({ annotation: await annotate(id, patch) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/commitments', async (req, res) => {
  const title = req.body.title?.trim();
  if (!title) {
    return res.status(400).json({ error: 'title is required' });
  }
  try {
    res.json(await addCommitment({ title, dueDate: req.body.dueDate }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/commitments/:id', async (req, res) => {
  try {
    await removeCommitment(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
