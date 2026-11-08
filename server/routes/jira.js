import { Router } from 'express';
import { getJiraItems, getJiraBoards, getJiraIssueTypes, createJiraIssue } from '../services/jira.js';

const router = Router();

router.get('/items', async (req, res) => {
  try {
    res.json(await getJiraItems());
  } catch (err) {
    console.error('Jira route error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/boards', async (req, res) => {
  try {
    res.json(await getJiraBoards());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/projects/:key/issuetypes', async (req, res) => {
  try {
    res.json(await getJiraIssueTypes(req.params.key));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/issues', async (req, res) => {
  try {
    res.json(await createJiraIssue(req.body ?? {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
