'use strict';
// Simula la llegada de alertas desde el sistema de monitoreo:
// cada N segundos crea un incidente nuevo y mueve un poco las métricas.

const TEMPLATES = [
  { sev: 'P1', titulo: 'Servicio sin respuesta en {servidor}',
    descripcion: 'El servidor {servidor} no responde a las comprobaciones de salud.',
    logs: ['ERROR  healthcheck failed 3/3', 'ALERT  service marked DOWN'] },
  { sev: 'P1', titulo: 'Pérdida total de conectividad con {servidor}',
    descripcion: 'No hay respuesta de red desde {servidor}. Los servicios dependientes están afectados.',
    logs: ['ERROR  ping timeout', 'ALERT  host unreachable'] },
  { sev: 'P2', titulo: 'Latencia elevada en {servidor}',
    descripcion: 'El tiempo de respuesta de {servidor} superó el umbral definido.',
    logs: ['WARN   response time p95 above threshold', 'WARN   queue length increasing'] },
  { sev: 'P2', titulo: 'Uso de memoria crítico en {servidor}',
    descripcion: 'La memoria de {servidor} supera el 90% de forma sostenida.',
    logs: ['WARN   memory_usage=93%', 'ALERT  swap in use'] },
  { sev: 'P2', titulo: 'Errores 5xx frecuentes en {servidor}',
    descripcion: 'Se detecta un aumento de respuestas con error de servidor.',
    logs: ['ERROR  HTTP 503 rate 12%', 'WARN   upstream timed out'] },
  { sev: 'P3', titulo: 'Espacio en disco bajo en {servidor}',
    descripcion: 'El volumen principal de {servidor} supera el 80% de uso.',
    logs: ['WARN   /data usage 82%'] },
  { sev: 'P3', titulo: 'Reinicio inesperado de servicio en {servidor}',
    descripcion: 'Un servicio de {servidor} se reinició y volvió a estado normal.',
    logs: ['WARN   service restarted automatically', 'INFO   health restored'] },
  { sev: 'P3', titulo: 'Tarea programada fallida en {servidor}',
    descripcion: 'Una tarea programada terminó con error y requiere revisión.',
    logs: ['WARN   cron job exit code 1'] },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const jitter = (n) => Math.round((Math.random() * 2 - 1) * n);

function hhmmss(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

async function tick(store) {
  const servers = await store.listServers();
  await store.updateServerMetrics(
    servers
      .filter((s) => s.estado !== 'Caído')
      .map((s) => ({
        nombre: s.nombre,
        cpu: clamp(s.cpu + jitter(4), 3, 99),
        memoria: clamp(s.memoria + jitter(2), 5, 99),
      })),
  );

  const r = Math.random();
  const sev = r < 0.15 ? 'P1' : r < 0.5 ? 'P2' : 'P3';
  const tpl = pick(TEMPLATES.filter((t) => t.sev === sev));
  const server = pick(servers);
  const fill = (txt) => txt.replaceAll('{servidor}', server.nombre);
  const now = new Date();

  return store.addIncident({
    titulo: fill(tpl.titulo),
    servidor: server.nombre,
    servicio: server.tipo,
    severidad: sev,
    descripcion: fill(tpl.descripcion),
    logs: tpl.logs.map((l) => `[${hhmmss(now)}] ${l}`),
  });
}

function startSimulator(store, seconds) {
  if (!seconds || seconds <= 0) return null;
  const timer = setInterval(() => {
    tick(store).catch((e) => console.error('Simulador:', e && e.message));
  }, seconds * 1000);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = { startSimulator, tick };
