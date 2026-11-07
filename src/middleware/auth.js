'use strict';
const jwt = require('jsonwebtoken');

// Verifica el token Bearer. Cualquier fallo responde igual (401 genérico).
function requireAuth(secret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    try {
      req.user = jwt.verify(token, secret, { algorithms: ['HS256'] });
      return next();
    } catch (_) {
      return res.status(401).json({ error: 'No autorizado' });
    }
  };
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'Acción no permitida' });
    }
    return next();
  };
}

module.exports = { requireAuth, requireRole };
