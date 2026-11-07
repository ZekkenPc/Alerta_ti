'use strict';
const express = require('express');
const { requireRole } = require('../middleware/auth');

const SEVERIDADES = ['P1', 'P2', 'P3'];

function textoValido(v, min, max) {
  return typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
}

module.exports = function incidentesRoutes({ store }) {
  const router = express.Router();

  // GET /api/incidentes?severidad=P1&estado=activo&desde=2026-10-05T08:00:00Z
  router.get('/', async (req, res, next) => {
    try {
      const { severidad, estado, desde } = req.query;
      if (severidad !== undefined && !SEVERIDADES.includes(severidad)) {
        return res.status(400).json({ error: 'Parámetro inválido' });
      }
      if (estado !== undefined && (typeof estado !== 'string' || estado.length > 20)) {
        return res.status(400).json({ error: 'Parámetro inválido' });
      }
      if (desde !== undefined && Number.isNaN(Date.parse(desde))) {
        return res.status(400).json({ error: 'Parámetro inválido' });
      }
      const lista = await store.listIncidents({ severidad, estado, desde });
      return res.json({ total: lista.length, incidentes: lista });
    } catch (e) {
      return next(e);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const incident = await store.findIncident(req.params.id);
      if (!incident) return res.status(404).json({ error: 'No encontrado' });
      return res.json(incident);
    } catch (e) {
      return next(e);
    }
  });

  // Solo el coordinador puede registrar incidentes manualmente (pruebas / demo).
  router.post('/', requireRole('coordinador'), async (req, res, next) => {
    try {
    const b = req.body || {};

    const logsOk =
      b.logs === undefined ||
      (Array.isArray(b.logs) &&
        b.logs.length <= 20 &&
        b.logs.every((l) => typeof l === 'string' && l.length <= 200));

    const valido =
      textoValido(b.titulo, 3, 120) &&
      typeof b.servidor === 'string' &&
      (await store.findServer(b.servidor)) &&
      SEVERIDADES.includes(b.severidad) &&
      (b.servicio === undefined || textoValido(b.servicio, 0, 80)) &&
      (b.descripcion === undefined || textoValido(b.descripcion, 0, 500)) &&
      logsOk;

    if (!valido) return res.status(400).json({ error: 'Datos inválidos' });

    const created = await store.addIncident({
      titulo: b.titulo.trim(),
      servidor: b.servidor,
      servicio: b.servicio && b.servicio.trim(),
      severidad: b.severidad,
      descripcion: b.descripcion && b.descripcion.trim(),
      logs: b.logs,
    });
    return res.status(201).json(created);
    } catch (e) {
      return next(e);
    }
  });

  return router;
};
