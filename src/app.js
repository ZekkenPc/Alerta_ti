'use strict';
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const { requireAuth } = require('./middleware/auth');
const infoRoutes = require('./routes/info');
const authRoutes = require('./routes/auth');
const incidentesRoutes = require('./routes/incidentes');
const servidoresRoutes = require('./routes/servidores');

function createApp({ jwtSecret, loginLimit = 20, store } = {}) {
  if (!jwtSecret) throw new Error('jwtSecret es obligatorio');
  if (!store) throw new Error('store es obligatorio');

  const app = express();
  const ctx = { store, jwtSecret };
  const auth = requireAuth(jwtSecret);

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors()); // Desarrollo: en producción limitar a los orígenes necesarios.
  app.use(express.json({ limit: '10kb' }));

  // Límite de intentos de login por IP (contra fuerza bruta).
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: loginLimit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiados intentos. Intenta más tarde.' },
  });

  // Públicas
  app.use('/api', infoRoutes(ctx));
  app.use('/api/auth', loginLimiter, authRoutes(ctx));

  // Protegidas (requieren token)
  app.use('/api/incidentes', auth, incidentesRoutes(ctx));
  app.use('/api/servidores', auth, servidoresRoutes(ctx));

  app.get('/api/resumen', auth, async (_req, res, next) => {
    try {
      res.json(await store.summary());
    } catch (e) {
      next(e);
    }
  });

  app.use((_req, res) => res.status(404).json({ error: 'No encontrado' }));

  // Manejo de errores: nunca se devuelven detalles técnicos al cliente
  // ni se registra el cuerpo de la petición (puede contener credenciales).
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err && (err.type === 'entity.parse.failed' || err.status === 400)) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Datos demasiado grandes' });
    }
    console.error('Error interno:', err && err.message);
    return res.status(500).json({ error: 'Error interno del servidor' });
  });

  return { app, store };
}

module.exports = { createApp };
