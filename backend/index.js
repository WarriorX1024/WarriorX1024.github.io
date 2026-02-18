require('dotenv').config();

// Global handlers to log unexpected errors so the server doesn't silently exit
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('Unhandled Rejection at:', p, 'reason:', reason);
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const createRateLimiter = require('express-rate-limit');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const mongoose = require('mongoose');
const morgan = require('morgan');
const xssClean = require('xss-clean');
const { list } = require('@serialport/list');
const { spawn } = require('child_process');
const path = require('path');
const bcrypt = require('bcrypt');
const fs = require('fs');
const { signToken, authMiddleware } = require('./auth');
const fetch = (...args) => import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validates email format using RFC 5322 compliant regex
 */
function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validates password strength
 * - At least 8 characters
 * - Contains at least one number
 * - Contains at least one letter
 */
function isValidPassword(password) {
  if (typeof password !== 'string') return false;
  if (password.length < 8) return false;
  if (!/\d/.test(password)) return false;
  if (!/[a-zA-Z]/.test(password)) return false;
  return true;
}

/**
 * Simple in-memory rate limiter
 */
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_REQUESTS = 10; // max attempts per window

function rateLimit(key) {
  const now = Date.now();
  const record = rateLimitStore.get(key);
  
  if (!record || (now - record.windowStart) > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(key, { windowStart: now, count: 1 });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }
  
  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - record.windowStart)) / 1000);
    return { allowed: false, retryAfter };
  }
  
  record.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - record.count };
}

// Cleanup rate limit store periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if ((now - record.windowStart) > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS);

const credentialThrottleStore = new Map();
const CREDENTIAL_WINDOW_MS = 10 * 60 * 1000;
const CREDENTIAL_MAX_FAILURES = 5;

function getCredentialThrottle(key) {
  if (!key) return { blocked: false };
  const record = credentialThrottleStore.get(key);
  if (!record) return { blocked: false };

  const now = Date.now();
  if ((now - record.firstFailure) > CREDENTIAL_WINDOW_MS) {
    credentialThrottleStore.delete(key);
    return { blocked: false };
  }

  if (record.failures >= CREDENTIAL_MAX_FAILURES) {
    const retryAfter = Math.ceil((CREDENTIAL_WINDOW_MS - (now - record.firstFailure)) / 1000);
    return { blocked: true, retryAfter };
  }

  return { blocked: false };
}

function recordCredentialFailure(key) {
  if (!key) return;
  const now = Date.now();
  const record = credentialThrottleStore.get(key);

  if (!record || (now - record.firstFailure) > CREDENTIAL_WINDOW_MS) {
    credentialThrottleStore.set(key, { failures: 1, firstFailure: now });
    return;
  }

  record.failures += 1;
}

function resetCredentialFailures(key) {
  credentialThrottleStore.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of credentialThrottleStore.entries()) {
    if ((now - record.firstFailure) > CREDENTIAL_WINDOW_MS) {
      credentialThrottleStore.delete(key);
    }
  }
}, CREDENTIAL_WINDOW_MS);

/**
 * Sanitizes path to prevent directory traversal
 */
function sanitizePath(inputPath) {
  if (typeof inputPath !== 'string') return null;
  const trimmed = inputPath.replace(/\\/g, '/').trim();
  if (!trimmed) return null;
  const normalized = path.posix.normalize(trimmed);
  if (normalized.includes('..')) return null;
  return normalized;
}

const SERIAL_PORT_PATTERN = /^[\w\-\/.:]+$/;
const FQBN_PATTERN = /^[\w:.\-]{3,120}$/;
const ALLOWED_SKETCH_EXTENSIONS = new Set(['.ino', '.bin']);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const WEATHER_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const MAX_GEOCODE_RESULTS = 8;
const WEATHER_TIMEOUT_MS = 5000;
const WEATHER_ALLOWED_UNITS = new Set(['celsius', 'fahrenheit']);
const CLI_MAX_OUTPUT_BYTES = 4000;
const CLI_MAX_EXECUTION_MS = Number(process.env.ARDUINO_CLI_TIMEOUT_MS || 2 * 60 * 1000);

function isValidSerialPort(portPath) {
  return typeof portPath === 'string' && portPath.length <= 200 && SERIAL_PORT_PATTERN.test(portPath);
}

function isValidFqbn(fqbn) {
  if (!fqbn) return true; // optional
  return typeof fqbn === 'string' && fqbn.length <= 120 && FQBN_PATTERN.test(fqbn);
}

function safeNumber(value) {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return value;
  return Math.min(Math.max(value, min), max);
}

function formatCoordinate(value, digits = 4) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function blendTemperatures(currentTemp, nextTemp) {
  const currentValid = Number.isFinite(currentTemp) ? currentTemp : null;
  const nextValid = Number.isFinite(nextTemp) ? nextTemp : null;

  if (currentValid !== null && nextValid !== null) {
    return Number((currentValid * 0.7 + nextValid * 0.3).toFixed(1));
  }
  if (currentValid !== null) return Number(currentValid.toFixed(1));
  if (nextValid !== null) return Number(nextValid.toFixed(1));
  return null;
}

async function fetchJson(url, { timeout = WEATHER_TIMEOUT_MS, ...options } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Upstream responded with ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function buildWeatherUrl(latitude, longitude, unit = 'celsius') {
  const lat = formatCoordinate(latitude, 4);
  const lon = formatCoordinate(longitude, 4);
  if (lat === null || lon === null) {
    throw new Error('Invalid coordinates');
  }

  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature',
    hourly: 'temperature_2m',
    timezone: 'auto',
    forecast_days: '1',
    models: 'best_match'
  });

  const normalizedUnit = WEATHER_ALLOWED_UNITS.has(unit) ? unit : 'celsius';
  params.set('temperature_unit', normalizedUnit);
  return `${WEATHER_ENDPOINT}?${params.toString()}`;
}

function normalizeWeatherPayload(latitude, longitude, payload) {
  const currentTemp = Number.isFinite(payload?.current?.temperature_2m)
    ? payload.current.temperature_2m
    : null;
  const nextHourTemp = Array.isArray(payload?.hourly?.temperature_2m)
    ? Number(payload.hourly.temperature_2m[0])
    : null;
  const humidity = Number.isFinite(payload?.current?.relative_humidity_2m)
    ? payload.current.relative_humidity_2m
    : null;

  return {
    coords: {
      latitude: formatCoordinate(latitude, 4),
      longitude: formatCoordinate(longitude, 4)
    },
    provider: 'open-meteo',
    temperature: {
      current: currentTemp,
      nextHour: nextHourTemp,
      blended: blendTemperatures(currentTemp, nextHourTemp),
      unit: payload?.current_units?.temperature_2m || payload?.hourly_units?.temperature_2m || '°C'
    },
    humidity,
    fetchedAt: payload?.current?.time || new Date().toISOString()
  };
}

function mapGeocodeMatches(results = []) {
  return results.slice(0, MAX_GEOCODE_RESULTS).map((item) => ({
    name: item.name,
    country: item.country,
    region: item.admin1 || null,
    latitude: formatCoordinate(item.latitude, 4),
    longitude: formatCoordinate(item.longitude, 4)
  }));
}

const app = express();
app.disable('x-powered-by');
const isProduction = process.env.NODE_ENV === 'production';

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:5173', 'http://localhost:4173', 'http://localhost:3000'];
const allowedOrigins = (process.env.CORS_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOriginSet = new Set(allowedOrigins);
const connectSrcAllowList = new Set(["'self'", 'https://api.open-meteo.com']);
allowedOriginSet.forEach((origin) => connectSrcAllowList.add(origin));

const defaultCsp = helmet.contentSecurityPolicy.getDefaultDirectives();
const cspDirectives = {
  ...defaultCsp,
  'style-src': ["'self'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],
  'connect-src': Array.from(connectSrcAllowList),
  'img-src': ["'self'", 'data:', 'https:'],
  'frame-ancestors': ["'self'"],
  'form-action': ["'self'"],
  'base-uri': ["'self'"]
};

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOriginSet.has(origin)) return callback(null, true);
    const error = new Error('Origin not allowed');
    error.statusCode = 403;
    return callback(error);
  },
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  credentials: true,
  maxAge: 60 * 60 * 24
};

console.log('CORS allowlist:', [...allowedOriginSet].join(', ') || '(none)');

app.use(morgan(isProduction ? 'combined' : 'dev'));
app.use(cors(corsOptions));
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: cspDirectives
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  referrerPolicy: { policy: 'no-referrer' },
  hsts: isProduction ? undefined : false
}));
app.use(compression());
app.use(express.json({ limit: '20kb' }));
app.use(express.urlencoded({ extended: false, limit: '20kb' }));
app.use(hpp({ whitelist: ['sketchPath', 'port', 'fqbn'] }));
app.use(mongoSanitize());
app.use(xssClean());

const globalLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.GLOBAL_RATE_LIMIT || 500),
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', globalLimiter);

// MongoDB connection with fallback
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/esp32-demo';
let mongoConnected = false;

mongoose.connect(MONGO_URI)
  .then(() => {
    console.log('Connected to MongoDB');
    mongoConnected = true;
  })
  .catch((err) => {
    console.warn('MongoDB not available, using in-memory storage:', err.message);
    mongoConnected = false;
  });

// Handle MongoDB disconnection
mongoose.connection.on('disconnected', () => {
  console.warn('MongoDB disconnected');
  mongoConnected = false;
});

mongoose.connection.on('reconnected', () => {
  console.log('MongoDB reconnected');
  mongoConnected = true;
});

// User schema
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password_hash: { type: String, required: true },
  created_at: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);

// Fallback in-memory user storage
const inMemoryUsers = new Map();

const PORT = process.env.PORT || 4000;

app.get('/', (req, res) => res.json({ ok: true, msg: 'ESP32 demo backend' }));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    storage: mongoConnected ? 'mongodb' : 'in-memory',
    mongoConnected
  });
});

app.get('/api/geocode', authMiddleware, async (req, res) => {
  const query = (req.query.q || req.query.query || '').toString().trim();
  if (query.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }

  const requestedLimit = safeNumber(req.query.limit) || 5;
  const limit = Math.max(1, Math.min(requestedLimit, MAX_GEOCODE_RESULTS));
  const language = (req.query.lang || 'en').toString().slice(0, 5);

  const url = `${GEOCODE_ENDPOINT}?name=${encodeURIComponent(query)}&count=${limit}&language=${encodeURIComponent(language)}&format=json`;

  try {
    const payload = await fetchJson(url, { timeout: WEATHER_TIMEOUT_MS });
    const matches = mapGeocodeMatches(payload?.results || []);
    res.json({ ok: true, matches });
  } catch (err) {
    console.error('Geocode lookup failed:', err);
    res.status(502).json({ error: 'Geocode lookup failed', message: err.message || 'Upstream service error' });
  }
});

app.get('/api/weather', authMiddleware, async (req, res) => {
  let latitude = safeNumber(req.query.lat ?? req.query.latitude);
  let longitude = safeNumber(req.query.lon ?? req.query.longitude);

  if (latitude === null || longitude === null) {
    return res.status(400).json({ error: 'Latitude and longitude query parameters are required' });
  }

  latitude = clampNumber(latitude, -90, 90);
  longitude = clampNumber(longitude, -180, 180);

  const unit = typeof req.query.unit === 'string' ? req.query.unit.toLowerCase() : 'celsius';

  try {
    const weatherUrl = buildWeatherUrl(latitude, longitude, unit);
    const payload = await fetchJson(weatherUrl, { timeout: WEATHER_TIMEOUT_MS });
    const normalized = normalizeWeatherPayload(latitude, longitude, payload);
    res.json({ ok: true, ...normalized });
  } catch (err) {
    console.error('Weather lookup failed:', err);
    res.status(502).json({ error: 'Weather lookup failed', message: err.message || 'Upstream service error' });
  }
});

// list available serial ports
app.get('/api/ports', authMiddleware, async (req, res) => {
  try {
    const ports = await list();
    const output = ports.map((p) => ({ path: p.path, manufacturer: p.manufacturer, serialNumber: p.serialNumber }));
    res.json({ ok: true, ports: output });
  } catch (err) {
    console.error('Failed to list ports', err);
    res.status(500).json({ error: 'Failed to list ports', message: err.message || String(err) });
  }
});

// Flash a sketch using arduino-cli
app.post('/api/flash', authMiddleware, async (req, res) => {
  const { sketchPath, port, fqbn } = req.body || {};
  if (!sketchPath || !port) return res.status(400).json({ error: 'Missing sketchPath or port' });

  if (!isValidSerialPort(port)) {
    return res.status(400).json({ error: 'Invalid serial port identifier' });
  }

  if (!isValidFqbn(fqbn)) {
    return res.status(400).json({ error: 'Invalid FQBN value' });
  }

  const sanitizedPath = sanitizePath(sketchPath);
  if (!sanitizedPath) {
    return res.status(400).json({ error: 'Invalid sketch path' });
  }

  const resolvedSketch = path.resolve(PROJECT_ROOT, sanitizedPath);
  if (!resolvedSketch.startsWith(PROJECT_ROOT)) {
    return res.status(400).json({ error: 'Sketch path must stay within project workspace' });
  }

  const extension = path.extname(resolvedSketch).toLowerCase();
  if (!ALLOWED_SKETCH_EXTENSIONS.has(extension)) {
    return res.status(400).json({ error: 'Unsupported sketch file extension' });
  }

  try {
    const stats = fs.statSync(resolvedSketch);
    if (!stats.isFile()) {
      return res.status(400).json({ error: 'Sketch path must point to a file' });
    }
  } catch (err) {
    return res.status(400).json({ error: 'Sketch file not found' });
  }

  try {
    await new Promise((resolve, reject) => {
      const cmd = spawn('arduino-cli', ['version']);
      cmd.on('error', reject);
      cmd.on('close', (code) => (code === 0 ? resolve() : reject(new Error('arduino-cli not found'))));
    });
  } catch (err) {
    return res.status(500).json({ error: 'arduino-cli not available on PATH' });
  }

  const compileArgs = ['compile', resolvedSketch];
  if (fqbn) compileArgs.push('--fqbn', fqbn);

  console.log('Compiling', resolvedSketch, 'fqbn', fqbn);

  try {
    await spawnCliAndStream(compileArgs);
    const uploadArgs = ['upload', resolvedSketch, '--port', port];
    if (fqbn) uploadArgs.push('--fqbn', fqbn);
    await spawnCliAndStream(uploadArgs);
    res.json({ ok: true, msg: 'Upload complete' });
  } catch (err) {
    console.error('arduino-cli invocation failed:', err.cliOutput || err);
    const clientMessage = err.timedOut
      ? 'Flash operation timed out. Please verify the board connection.'
      : 'Failed to compile or upload sketch';
    res.status(500).json({ error: clientMessage });
  }
});

function spawnCliAndStream(args, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : CLI_MAX_EXECUTION_MS;
    const maxBuffer = Number.isFinite(options.maxBuffer) && options.maxBuffer > 0
      ? options.maxBuffer
      : CLI_MAX_OUTPUT_BYTES;

    const child = spawn('arduino-cli', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let timedOut = false;

    const appendChunk = (chunk) => {
      output += chunk.toString();
      if (output.length > maxBuffer) {
        output = output.slice(output.length - maxBuffer);
      }
    };

    child.stdout.on('data', appendChunk);
    child.stderr.on('data', appendChunk);

    const killTimer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, timeoutMs);
    killTimer.unref();

    child.on('error', (err) => {
      clearTimeout(killTimer);
      const error = new Error('Failed to run arduino-cli');
      error.cause = err;
      error.cliOutput = output;
      reject(error);
    });

    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (!timedOut && code === 0) {
        return resolve(output);
      }
      const error = new Error(timedOut ? 'arduino-cli timed out' : `arduino-cli exited with code ${code}`);
      error.timedOut = timedOut;
      error.cliOutput = output;
      reject(error);
    });
  });
}

// register
app.post('/api/register', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

  if (typeof email !== 'string' || typeof password !== 'string')
    return res.status(400).json({ error: 'Bad input types' });

  const normalizedEmail = email.trim().toLowerCase();

  // Validate email format
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Validate password strength
  if (!isValidPassword(password)) {
    return res.status(400).json({ 
      error: 'Password must be at least 8 characters and contain at least one letter and one number' 
    });
  }

  // Rate limiting by IP
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const rateLimitResult = rateLimit(`register:${ip}`);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({ 
      error: 'Too many registration attempts. Please try again later.',
      retryAfter: rateLimitResult.retryAfter
    });
  }

  try {
    const password_hash = await bcrypt.hash(password, 12); // Increased rounds for better security

    if (mongoConnected) {
      const user = new User({ email: normalizedEmail, password_hash });
      await user.save();
      const token = signToken({ id: user._id, email: user.email });
      res.json({ ok: true, id: user._id, token });
    } else {
      if (inMemoryUsers.has(normalizedEmail)) {
        return res.status(409).json({ error: 'User already exists' });
      }
      const id = 'user_' + Date.now();
      inMemoryUsers.set(normalizedEmail, { id, email: normalizedEmail, password_hash });
      const token = signToken({ id, email: normalizedEmail });
      res.json({ ok: true, id, token });
    }
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'User already exists' });
    }
    console.error('DB error', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing email or password' });

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Bad input types' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!isValidEmail(normalizedEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  // Rate limiting by IP to prevent brute force
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const rateLimitResult = rateLimit(`login:${ip}`);
  if (!rateLimitResult.allowed) {
    return res.status(429).json({ 
      error: 'Too many login attempts. Please try again later.',
      retryAfter: rateLimitResult.retryAfter
    });
  }

  const credentialThrottle = getCredentialThrottle(normalizedEmail);
  if (credentialThrottle.blocked) {
    return res.status(429).json({
      error: 'Too many failed login attempts for this account. Please try again later.',
      retryAfter: credentialThrottle.retryAfter
    });
  }

  try {
    let user = null;

    if (mongoConnected) {
      user = await User.findOne({ email: normalizedEmail });
    } else {
      user = inMemoryUsers.get(normalizedEmail);
    }

    if (!user) {
      recordCredentialFailure(normalizedEmail);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      recordCredentialFailure(normalizedEmail);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    resetCredentialFailures(normalizedEmail);

    const token = signToken({ id: user._id || user.id, email: user.email });
    res.json({ ok: true, token });
  } catch (err) {
    console.error('DB error', err);
    res.status(500).json({ error: 'DB error' });
  }
});

// logout
app.post('/api/logout', authMiddleware, (req, res) => {
  res.json({ ok: true });
});

// protected route - get current user
app.get('/api/me', authMiddleware, async (req, res) => {
  try {
    let user = null;

    if (mongoConnected) {
      user = await User.findById(req.user.id);
    } else {
      for (const u of inMemoryUsers.values()) {
        if (u.id === req.user.id) {
          user = u;
          break;
        }
      }
    }

    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, user: { id: user._id || user.id, email: user.email } });
  } catch (err) {
    console.error('Error fetching user:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// Serve frontend static build
const frontBuild = path.join(PROJECT_ROOT, 'frontend', 'dist');
if (fs.existsSync(frontBuild)) {
  app.use(express.static(frontBuild));

  // fallback to index.html for client-side routing
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(frontBuild, 'index.html'));
  });
}

// Global error handler
app.use((err, req, res, next) => {
  const status = err.statusCode || err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  let message = 'Internal server error';

  if (status === 400) message = 'Malformed request payload';
  if (status === 401) message = 'Unauthorized';
  if (status === 403) message = 'CORS origin denied';

  console.error('Unhandled error:', err);
  res.status(status).json({ error: message });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Storage: ${mongoConnected ? 'MongoDB' : 'In-memory (demo only)'}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

// Graceful shutdown
function gracefulShutdown(signal) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  server.close(async () => {
    console.log('HTTP server closed');
    
    try {
      await mongoose.connection.close();
      console.log('MongoDB connection closed');
    } catch (err) {
      console.error('Error closing MongoDB connection:', err);
    }
    
    process.exit(0);
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
