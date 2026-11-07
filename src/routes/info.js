'use strict';
const express = require('express');

// Rutas públicas: sirven para la práctica 3 (consulta de una URL preasignada)
// y para comprobar que el servidor está vivo.
module.exports = function infoRoutes({ store }) {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ estado: 'ok', hora: new Date().toISOString() });
  });

  router.get('/info', async (_req, res, next) => {
    try {
    const resumen = await store.summary();
    res.json({
      proyecto: 'Sistema de alertas TI',
      version: '2.0.0',
      descripcion:
        'API REST para recibir y consultar incidentes de infraestructura TI.',
      hora_servidor: new Date().toISOString(),
      incidentes_activos: resumen.incidentes_activos,
      servidores_monitoreados: await store.countServers(),
      endpoints: [
        'GET  /api/health',
        'GET  /api/info',
        'POST /api/auth/login',
        'GET  /api/incidentes',
        'GET  /api/incidentes/:id',
        'POST /api/incidentes (coordinador)',
        'GET  /api/servidores',
        'GET  /api/resumen',
      ],
    });
    } catch (e) {
      next(e);
    }
  });

  return router;
};
