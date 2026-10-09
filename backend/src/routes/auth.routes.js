const express = require('express');
const { login, getMe } = require('../controllers/auth.controller');
const { requireAdmin } = require('../middleware/require-admin');

const router = express.Router();

router.post('/login', login);
router.get('/me', requireAdmin, getMe);

module.exports = router;
