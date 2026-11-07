'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const USUARIO_RE = /^[A-Za-z0-9._-]+$/;
const ERROR_LOGIN = 'Usuario o contraseña incorrectos';

// Hash válido usado para igualar el tiempo de respuesta cuando el usuario no existe.
const HASH_FALSO = bcrypt.hashSync('relleno-para-igualar-tiempo', 10);

module.exports = function authRoutes({ store, jwtSecret }) {
  const router = express.Router();

  router.post('/login', async (req, res, next) => {
  try {
    const { usuario, clave } = req.body || {};

    // Validación en el servidor (la del cliente no basta)
    const valido =
      typeof usuario === 'string' &&
      typeof clave === 'string' &&
      usuario.trim().length > 0 &&
      usuario.length <= 30 &&
      USUARIO_RE.test(usuario) &&
      clave.length > 0 &&
      clave.length <= 64;
    if (!valido) return res.status(400).json({ error: 'Datos inválidos' });

    const user = await store.findUser(usuario);
    const ok = await bcrypt.compare(clave, user ? user.claveHash : HASH_FALSO);

    // Mismo mensaje genérico para usuario inexistente y clave incorrecta
    if (!user || !ok) return res.status(401).json({ error: ERROR_LOGIN });

    const token = jwt.sign({ id: user.id, rol: user.rol }, jwtSecret, {
      algorithm: 'HS256',
      expiresIn: '8h',
    });

    return res.json({
      token,
      usuario: { id: user.id, usuario: user.usuario, nombre: user.nombre, rol: user.rol },
    });
  } catch (e) {
    return next(e);
  }
  });

  return router;
};
