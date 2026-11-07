'use strict';
// Almacén de datos sobre Turso (libSQL / SQLite en la nube).
// Con TURSO_DATABASE_URL + TURSO_AUTH_TOKEN usa la base remota; sin ellas usa
// un archivo local (solo desarrollo y pruebas). Las rutas no conocen el SQL.
const { createClient } = require('@libsql/client');
const seed = require('../data/seed.json');
const seedUsers = require('../data/users.json');

const MAX_INCIDENTS = 50;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS usuarios (
     id TEXT PRIMARY KEY,
     usuario TEXT NOT NULL UNIQUE,
     nombre TEXT NOT NULL,
     rol TEXT NOT NULL CHECK (rol IN ('coordinador','tecnico')),
     clave_hash TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS servidores (
     nombre TEXT PRIMARY KEY,
     ip TEXT,
     tipo TEXT,
     estado TEXT NOT NULL CHECK (estado IN ('En línea','Degradado','Caído')),
     cpu INTEGER,
     memoria INTEGER,
     uptime TEXT)`,
  `CREATE TABLE IF NOT EXISTS incidentes (
     id TEXT PRIMARY KEY,
     num INTEGER NOT NULL,
     titulo TEXT NOT NULL,
     servidor TEXT NOT NULL,
     servicio TEXT,
     severidad TEXT NOT NULL CHECK (severidad IN ('P1','P2','P3')),
     estado TEXT NOT NULL DEFAULT 'activo',
     detectado TEXT NOT NULL,
     descripcion TEXT)`,
  `CREATE TABLE IF NOT EXISTS logs_incidente (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     incidente_id TEXT NOT NULL,
     orden INTEGER NOT NULL,
     linea TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_inc_detectado ON incidentes(detectado)`,
  `CREATE INDEX IF NOT EXISTS idx_logs_inc ON logs_incidente(incidente_id)`,
];

async function createStore({ url, authToken } = {}) {
  const db = createClient({ url: url || 'file:local.db', authToken });
  await db.batch(SCHEMA, 'write');

  // --- Datos iniciales (solo si las tablas están vacías) ---
  const vacio = async (t) => Number((await db.execute(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n) === 0;

  if (await vacio('usuarios')) {
    await db.batch(
      seedUsers.map((u) => ({
        sql: 'INSERT INTO usuarios (id, usuario, nombre, rol, clave_hash) VALUES (?,?,?,?,?)',
        args: [u.id, u.usuario, u.nombre, u.rol, u.claveHash],
      })),
      'write',
    );
  }
  if (await vacio('servidores')) {
    await db.batch(
      seed.servidores.map((s) => ({
        sql: 'INSERT INTO servidores (nombre, ip, tipo, estado, cpu, memoria, uptime) VALUES (?,?,?,?,?,?,?)',
        args: [s.nombre, s.ip, s.tipo, s.estado, s.cpu, s.memoria, s.uptime],
      })),
      'write',
    );
  }
  if (await vacio('incidentes')) {
    const now = Date.now();
    const stmts = [];
    for (const i of seed.incidentes) {
      stmts.push({
        sql: `INSERT INTO incidentes (id, num, titulo, servidor, servicio, severidad, estado, detectado, descripcion)
              VALUES (?,?,?,?,?,?,'activo',?,?)`,
        args: [i.id, Number(i.id.split('-')[1]), i.titulo, i.servidor, i.servicio, i.severidad,
          new Date(now - i.hace_min * 60000).toISOString(), i.descripcion],
      });
      i.logs.forEach((l, n) => stmts.push({
        sql: 'INSERT INTO logs_incidente (incidente_id, orden, linea) VALUES (?,?,?)',
        args: [i.id, n, l],
      }));
    }
    await db.batch(stmts, 'write');
  }

  // --- Consultas ---
  async function conLogs(rows) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const marks = ids.map(() => '?').join(',');
    const logs = (await db.execute({
      sql: `SELECT incidente_id, linea FROM logs_incidente WHERE incidente_id IN (${marks}) ORDER BY orden`,
      args: ids,
    })).rows;
    const porInc = {};
    for (const l of logs) (porInc[l.incidente_id] ||= []).push(l.linea);
    return rows.map((r) => ({
      id: r.id, titulo: r.titulo, servidor: r.servidor, servicio: r.servicio || '',
      severidad: r.severidad, estado: r.estado, detectado: r.detectado,
      descripcion: r.descripcion || '', logs: porInc[r.id] || [],
    }));
  }

  async function listIncidents({ severidad, estado, desde } = {}) {
    const where = []; const args = [];
    if (severidad) { where.push('severidad = ?'); args.push(severidad); }
    if (estado) { where.push('estado = ?'); args.push(estado); }
    if (desde) { where.push('detectado > ?'); args.push(new Date(desde).toISOString()); }
    const sql = `SELECT * FROM incidentes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY detectado DESC`;
    return conLogs((await db.execute({ sql, args })).rows);
  }

  async function findIncident(id) {
    const rows = (await db.execute({ sql: 'SELECT * FROM incidentes WHERE id = ?', args: [id] })).rows;
    return (await conLogs(rows))[0] || null;
  }

  // Las altas se encolan para que dos peticiones simultáneas no repitan el número.
  let cola = Promise.resolve();
  function addIncident(data) {
    const tarea = cola.then(async () => {
      const n = Number((await db.execute('SELECT COALESCE(MAX(num), 1041) + 1 AS n FROM incidentes')).rows[0].n);
      const id = `INC-${n}`;
      const detectado = new Date().toISOString();
      const stmts = [{
        sql: `INSERT INTO incidentes (id, num, titulo, servidor, servicio, severidad, estado, detectado, descripcion)
              VALUES (?,?,?,?,?,?,'activo',?,?)`,
        args: [id, n, data.titulo, data.servidor, data.servicio || '', data.severidad, detectado, data.descripcion || ''],
      }];
      (data.logs || []).forEach((l, o) => stmts.push({
        sql: 'INSERT INTO logs_incidente (incidente_id, orden, linea) VALUES (?,?,?)',
        args: [id, o, l],
      }));
      // Conserva solo los MAX_INCIDENTS más recientes.
      stmts.push({
        sql: `DELETE FROM logs_incidente WHERE incidente_id IN
              (SELECT id FROM incidentes ORDER BY detectado DESC LIMIT -1 OFFSET ?)`,
        args: [MAX_INCIDENTS],
      });
      stmts.push({
        sql: `DELETE FROM incidentes WHERE id IN
              (SELECT id FROM incidentes ORDER BY detectado DESC LIMIT -1 OFFSET ?)`,
        args: [MAX_INCIDENTS],
      });
      await db.batch(stmts, 'write');
      return { id, titulo: data.titulo, servidor: data.servidor, servicio: data.servicio || '',
        severidad: data.severidad, estado: 'activo', detectado,
        descripcion: data.descripcion || '', logs: data.logs || [] };
    });
    cola = tarea.catch(() => {});
    return tarea;
  }

  async function listServers() {
    return (await db.execute('SELECT nombre, ip, tipo, estado, cpu, memoria, uptime FROM servidores ORDER BY rowid')).rows
      .map((r) => ({ nombre: r.nombre, ip: r.ip, tipo: r.tipo, estado: r.estado,
        cpu: Number(r.cpu), memoria: Number(r.memoria), uptime: r.uptime }));
  }

  async function findServer(nombre) {
    const r = (await db.execute({ sql: 'SELECT nombre, tipo FROM servidores WHERE nombre = ?', args: [nombre] })).rows[0];
    return r ? { nombre: r.nombre, tipo: r.tipo } : null;
  }

  async function updateServerMetrics(updates) {
    if (updates.length === 0) return;
    await db.batch(updates.map((u) => ({
      sql: 'UPDATE servidores SET cpu = ?, memoria = ? WHERE nombre = ?',
      args: [u.cpu, u.memoria, u.nombre],
    })), 'write');
  }

  async function findUser(usuario) {
    const r = (await db.execute({ sql: 'SELECT * FROM usuarios WHERE usuario = ?', args: [usuario] })).rows[0];
    return r ? { id: r.id, usuario: r.usuario, nombre: r.nombre, rol: r.rol, claveHash: r.clave_hash } : null;
  }

  async function summary() {
    const n = async (sql, args = []) => Number((await db.execute({ sql, args })).rows[0].n);
    const sev = (v) => n("SELECT COUNT(*) AS n FROM incidentes WHERE estado = 'activo' AND severidad = ?", [v]);
    const srv = (v) => n('SELECT COUNT(*) AS n FROM servidores WHERE estado = ?', [v]);
    return {
      incidentes_activos: await n("SELECT COUNT(*) AS n FROM incidentes WHERE estado = 'activo'"),
      por_severidad: { P1: await sev('P1'), P2: await sev('P2'), P3: await sev('P3') },
      servidores: { en_linea: await srv('En línea'), degradado: await srv('Degradado'), caido: await srv('Caído') },
    };
  }

  async function countServers() {
    return Number((await db.execute('SELECT COUNT(*) AS n FROM servidores')).rows[0].n);
  }

  return {
    listIncidents, findIncident, addIncident, listServers, findServer,
    updateServerMetrics, findUser, summary, countServers,
    close: () => db.close(),
  };
}

module.exports = { createStore };
