'use strict';
const express = require('express');

module.exports = function servidoresRoutes({ store }) {
  const router = express.Router();

  router.get('/', async (_req, res, next) => {
    try {
      const servidores = await store.listServers();
      res.json({ total: servidores.length, servidores });
    } catch (e) {
      next(e);
    }
  });

  return router;
};
