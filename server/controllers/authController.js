const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/db');
const { getPool } = require('../db/registry');
const {
  recordAuthFailure,
  clearAuthFailures,
} = require('../middleware/authRateLimit');

// mst_user lives on the external DB_USERS_* source (read-only).
const login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const usersPool = getPool('users');
    const result = await usersPool.query(
      'SELECT user_id, user_password, user_name FROM public.mst_user WHERE user_id = $1',
      [username]
    );

    const user = result.rows[0];
    const isValid = !!user && user.user_password === String(password);
    if (!isValid) {
      recordAuthFailure(req);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    clearAuthFailures(req);

    const token = jwt.sign(
      { id: user.user_id, username: user.user_name },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '1h' }
    );

    res.json({ token, user: { id: user.user_id, username: user.user_name } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

const register = async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const query = 'INSERT INTO mst_employee (employee_id, employee_password) VALUES ($1, $2) RETURNING employee_id';
    const values = [username, passwordHash];
    const result = await pool.query(query, values);

    const user = result.rows[0];

    res.status(201).json({ message: 'User registered successfully', user: { id: user.employee_id, username: user.employee_id } });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
};

module.exports = { login, register };
