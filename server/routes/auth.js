const express = require('express');
const router = express.Router();
const { login, register } = require('../controllers/authController');
const { throttleByIp, authBruteForceGuard } = require('../middleware/authRateLimit');

router.post('/login', throttleByIp, authBruteForceGuard, login);
router.post('/register', register);

module.exports = router;
