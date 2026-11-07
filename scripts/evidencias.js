'use strict';
// Genera evidencias_backend.txt: levanta la API, ejecuta las pruebas
// de cada endpoint y registra petición, código HTTP y respuesta.
const fs = require('fs');
const path = require('path');
const { createApp } = require('../src/app');
const { createStore } = require('../src/store');
const { tick } = require('../src/simulator');

const lines = [];
const out = (s = '') => { lines.push(s); console.log(s); };
const mask = (s) => s.replace(/("token":\s*")[^"]{12}[^"]*(")/g, '$1<TOKEN_JWT_OMITIDO>$2');

(async () => {
  const store = await createStore({ url: 'file::memory:' });
  const { app } = createApp({ jwtSecret: 'evidencias-secret', loginLimit: 1000, store });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let n = 0;

  async function paso(titulo, esperado, path_, { method = 'GET', token, body, raw } = {}) {
    n += 1;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path_, {
      method, headers,
      body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (_) {}
    const recorte = pretty.length > 700 ? pretty.slice(0, 700) + '\n  ... (recortado)' : pretty;
    out(`--- Prueba ${n}: ${titulo}`);
    out(`Petición : ${method} ${path_}${token ? '  (con token)' : ''}`);
    if (body !== undefined) out(`Cuerpo   : ${mask(JSON.stringify({ ...body, clave: body.clave ? '********' : undefined }))}`);
    out(`Esperado : ${esperado}`);
    out(`Resultado: HTTP ${res.status} ${res.status === Number(esperado.match(/\d{3}/)[0]) ? '✔ OK' : '✘ FALLÓ'}`);
    out(mask(recorte));
    out();
    return { status: res.status, json: (() => { try { return JSON.parse(text); } catch (_) { return null; } })() };
  }

  out('=== EVIDENCIAS BACKEND – Sistema de alertas TI (Evaluación 2) ===');
  out(`Alumno: Daniel Ivan Lucas Molina`);
  out(`Fecha : ${new Date().toLocaleString('es-MX')}`);
  out(`Node  : ${process.version}`);
  out();

  await paso('Health check público', 'HTTP 200', '/api/health');
  await paso('Práctica 3: consulta de información (URL preasignada)', 'HTTP 200', '/api/info');
  await paso('Ruta protegida sin token', 'HTTP 401', '/api/incidentes');
  await paso('Login con clave incorrecta', 'HTTP 401', '/api/auth/login',
    { method: 'POST', body: { usuario: 'coordinador', clave: 'Incorrecta1' } });
  await paso('Login con usuario inexistente (mismo mensaje genérico)', 'HTTP 401', '/api/auth/login',
    { method: 'POST', body: { usuario: 'noexiste', clave: 'Incorrecta1' } });
  await paso('Login con usuario solo espacios (validación servidor)', 'HTTP 400', '/api/auth/login',
    { method: 'POST', body: { usuario: '   ', clave: 'Coord#2026' } });

  const lc = await paso('Login coordinador correcto', 'HTTP 200', '/api/auth/login',
    { method: 'POST', body: { usuario: 'coordinador', clave: 'Coord#2026' } });
  const lt = await paso('Login técnico correcto', 'HTTP 200', '/api/auth/login',
    { method: 'POST', body: { usuario: 'tecnico1', clave: 'Tecnico#2026' } });
  const tc = lc.json.token; const tt = lt.json.token;

  await paso('Listar incidentes (ordenados del más reciente)', 'HTTP 200', '/api/incidentes', { token: tt });
  await paso('Filtrar incidentes por severidad P1', 'HTTP 200', '/api/incidentes?severidad=P1', { token: tt });
  await paso('Filtro con severidad inválida', 'HTTP 400', '/api/incidentes?severidad=X', { token: tt });
  await paso('Detalle de incidente INC-1042', 'HTTP 200', '/api/incidentes/INC-1042', { token: tt });
  await paso('Incidente inexistente', 'HTTP 404', '/api/incidentes/INC-9999', { token: tt });
  await paso('Listar servidores', 'HTTP 200', '/api/servidores', { token: tt });
  await paso('Resumen para el dashboard', 'HTTP 200', '/api/resumen', { token: tt });

  const nuevo = { titulo: 'Prueba de alerta', servidor: 'APP-WEB-01', severidad: 'P1' };
  await paso('Técnico intenta crear incidente (sin permiso)', 'HTTP 403', '/api/incidentes',
    { method: 'POST', token: tt, body: nuevo });
  await paso('Coordinador crea incidente', 'HTTP 201', '/api/incidentes',
    { method: 'POST', token: tc, body: nuevo });
  await paso('Crear incidente con servidor inexistente', 'HTTP 400', '/api/incidentes',
    { method: 'POST', token: tc, body: { ...nuevo, servidor: 'NO-EXISTE' } });
  await paso('JSON mal formado (sin detalles técnicos)', 'HTTP 400', '/api/auth/login',
    { method: 'POST', raw: '{"usuario": ' });

  const antes = (await store.listIncidents()).length;
  await tick(store);
  const despues = await store.listIncidents();
  out(`--- Prueba ${++n}: Simulador de alertas (recepción de incidentes nuevos)`);
  out(`Incidentes antes: ${antes}  |  después de un ciclo del simulador: ${despues.length}  ${despues.length === antes + 1 ? '✔ OK' : '✘ FALLÓ'}`);
  out(`Nuevo incidente: ${despues[0].id} [${despues[0].severidad}] ${despues[0].titulo}`);
  out();

  const fallos = lines.filter((l) => l.includes('✘')).length;
  out(`=== RESUMEN: ${n} pruebas ejecutadas, ${fallos} fallidas ===`);
  server.close();
  const file = path.join(__dirname, '..', 'evidencias_backend.txt');
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  console.log(`\nArchivo generado: ${file}`);
  process.exit(fallos ? 1 : 0);
})();
