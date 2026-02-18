const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const TOKEN_EXPIRY = process.env.JWT_TTL || '4h';

function resolveSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) {
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be defined and at least 32 characters in production.');
  }

  const fallback = crypto.randomBytes(48).toString('hex');
  console.warn('JWT_SECRET missing or too short; using ephemeral secret for this process (development only).');
  return fallback;
}

const SECRET = resolveSecret();

function signToken(payload) {
  return jwt.sign(payload, SECRET, {
    expiresIn: TOKEN_EXPIRY,
    issuer: 'esp32-demo-backend',
    audience: 'esp32-climate-suite'
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET, {
      issuer: 'esp32-demo-backend',
      audience: 'esp32-climate-suite'
    });
  } catch (err) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: 'Missing Authorization header' });

  const parts = auth.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer')
    return res.status(401).json({ error: 'Bad Authorization format' });

  const payload = verifyToken(parts[1]);
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

  req.user = payload;
  next();
}

module.exports = { signToken, verifyToken, authMiddleware };
