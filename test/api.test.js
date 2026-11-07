'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { tick } = require('../src/simulator');

async function start() {
  const store = await createStore({ url: 'file::memory:' });
  const { app } = createApp({ jwtSecret: 'test-secret', loginLimit: 1000, store });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (path, { method = 'GET', token, body, raw } = {}) => {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, json: await res.json() };
  };
  const login = async (usuario, clave) => call('/api/auth/login', { method: 'POST', body: { usuario, clave } });
  return { server, store, call, login };
}

test('GET /api/info es público y devuelve JSON', async () => {
  const { server, call } = await start();
  const r = await call('/api/info');
  assert.equal(r.status, 200);
  assert.equal(r.json.proyecto, 'Sistema de alertas TI');
  assert.ok(Array.isArray(r.json.endpoints));
  server.close();
});

test('rutas protegidas sin token responden 401', async () => {
  const { server, call } = await start();
  for (const p of ['/api/incidentes', '/api/servidores', '/api/resumen']) {
    const r = await call(p);
    assert.equal(r.status, 401, p);
  }
  server.close();
});

test('login incorrecto: mismo mensaje genérico para usuario y clave', async () => {
  const { server, login } = await start();
  const a = await login('coordinador', 'ClaveIncorrecta1');
  const b = await login('noexiste', 'ClaveIncorrecta1');
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(a.json.error, b.json.error);
  server.close();
});

test('login con datos inválidos responde 400', async () => {
  const { server, login } = await start();
  assert.equal((await login('   ', 'Coord#2026')).status, 400);
  assert.equal((await login('usuario con espacios', 'Coord#2026')).status, 400);
  assert.equal((await login('a'.repeat(31), 'Coord#2026')).status, 400);
  assert.equal((await login('coordinador', 'x'.repeat(65))).status, 400);
  server.close();
});

test('login correcto no expone el hash y permite consultar incidentes', async () => {
  const { server, call, login } = await start();
  const l = await login('tecnico1', 'Tecnico#2026');
  assert.equal(l.status, 200);
  assert.ok(l.json.token);
  assert.equal(l.json.usuario.rol, 'tecnico');
  assert.ok(!JSON.stringify(l.json).includes('claveHash'));

  const r = await call('/api/incidentes', { token: l.json.token });
  assert.equal(r.status, 200);
  assert.ok(r.json.total >= 7);
  const fechas = r.json.incidentes.map((i) => Date.parse(i.detectado));
  assert.deepEqual(fechas, [...fechas].sort((a, b) => b - a));
  server.close();
});

test('filtro por severidad y parámetro inválido', async () => {
  const { server, call, login } = await start();
  const { json } = await login('tecnico1', 'Tecnico#2026');
  const ok = await call('/api/incidentes?severidad=P1', { token: json.token });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.incidentes.length > 0);
  assert.ok(ok.json.incidentes.every((i) => i.severidad === 'P1'));
  const bad = await call('/api/incidentes?severidad=X', { token: json.token });
  assert.equal(bad.status, 400);
  server.close();
});

test('solo el coordinador puede crear incidentes y se valida el cuerpo', async () => {
  const { server, call, login } = await start();
  const tec = (await login('tecnico1', 'Tecnico#2026')).json.token;
  const coord = (await login('coordinador', 'Coord#2026')).json.token;
  const nuevo = { titulo: 'Prueba de alerta', servidor: 'APP-WEB-01', severidad: 'P2' };

  assert.equal((await call('/api/incidentes', { method: 'POST', token: tec, body: nuevo })).status, 403);

  const creado = await call('/api/incidentes', { method: 'POST', token: coord, body: nuevo });
  assert.equal(creado.status, 201);
  assert.match(creado.json.id, /^INC-\d+$/);

  const lista = await call('/api/incidentes', { token: coord });
  assert.equal(lista.json.incidentes[0].id, creado.json.id);

  const malo = await call('/api/incidentes', {
    method: 'POST', token: coord, body: { ...nuevo, servidor: 'NO-EXISTE' },
  });
  assert.equal(malo.status, 400);
  const sinTitulo = await call('/api/incidentes', {
    method: 'POST', token: coord, body: { ...nuevo, titulo: ' ' },
  });
  assert.equal(sinTitulo.status, 400);
  server.close();
});

test('JSON mal formado responde 400 sin detalles técnicos', async () => {
  const { server, call } = await start();
  const r = await call('/api/auth/login', { method: 'POST', raw: '{"usuario": ' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.json, { error: 'Datos inválidos' });
  server.close();
});

test('el simulador agrega incidentes nuevos', async () => {
  const { server, store } = await start();
  const antes = (await store.listIncidents()).length;
  await tick(store);
  assert.equal((await store.listIncidents()).length, antes + 1);
  server.close();
});

test('los incidentes persisten al reiniciar el servidor (base de datos)', async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const file = path.join(os.tmpdir(), `alertas-test-${Date.now()}.db`);
  const url = `file:${file}`;

  const a = await createStore({ url });
  const creado = await a.addIncident({ titulo: 'Persistencia', servidor: 'APP-WEB-01', severidad: 'P2', logs: ['x'] });
  a.close();

  const b = await createStore({ url }); // "reinicio": se abre la misma base
  const leido = await b.findIncident(creado.id);
  assert.equal(leido.titulo, 'Persistencia');
  assert.deepEqual(leido.logs, ['x']);
  b.close();
  fs.rmSync(file, { force: true });
});

test('solo se conservan los 50 incidentes más recientes', async () => {
  const store = await createStore({ url: 'file::memory:' });
  for (let i = 0; i < 52; i++) {
    await store.addIncident({ titulo: `Alerta ${i}`, servidor: 'APP-WEB-01', severidad: 'P3' });
  }
  assert.equal((await store.listIncidents()).length, 50);
  store.close();
});
