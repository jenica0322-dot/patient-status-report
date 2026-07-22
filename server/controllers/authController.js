const pool = require('../db/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const login = async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const result = await pool.query(
      'SELECT employee_id, employee_password, employee_name FROM mst_employee WHERE employee_id = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValid = password === user.employee_password;
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.employee_id, username: user.employee_name },
      process.env.JWT_SECRET || 'default_secret',
      { expiresIn: '1h' }
    );

    res.json({ token, user: { id: user.employee_id, username: user.employee_name } });
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
    await bcrypt.hash(password, 10);

    const query = 'INSERT INTO mst_employee (employee_id, employee_password) VALUES ($1, $2) RETURNING employee_id';
    const values = [username, password];
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
