'use strict';
const os = require('os');
const { createApp } = require('./app');
const { createStore } = require('./store');
const { startSimulator } = require('./simulator');

const PORT = Number(process.env.PORT) || 3000;
const SIMULATOR_SECONDS = process.env.SIMULATOR_SECONDS === undefined
  ? 45
  : Number(process.env.SIMULATOR_SECONDS);

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret && process.env.NODE_ENV === 'production') {
  console.error('JWT_SECRET es obligatorio en producción.');
  process.exit(1);
}
if (!jwtSecret) {
  jwtSecret = 'clave-solo-para-desarrollo-cambiala';
  console.warn('⚠ JWT_SECRET no definido: usando clave de desarrollo.');
}

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) console.warn('⚠ TURSO_DATABASE_URL no definido: usando archivo local local.db (solo desarrollo).');

  const store = await createStore({ url, authToken });
  console.log(url ? 'Base de datos: Turso (nube)' : 'Base de datos: archivo local');

  const { app } = createApp({ jwtSecret, store });
  startSimulator(store, SIMULATOR_SECONDS);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`API de alertas TI escuchando en el puerto ${PORT}`);
    console.log(`  Local:            http://localhost:${PORT}/api/info`);
    console.log(`  Emulador Android: http://10.0.2.2:${PORT}`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) {
          console.log(`  Teléfono físico:  http://${n.address}:${PORT}`);
        }
      }
    }
    console.log(
      SIMULATOR_SECONDS > 0
        ? `Simulador: nuevo incidente cada ${SIMULATOR_SECONDS} s`
        : 'Simulador desactivado',
    );
  });
}

main().catch((e) => {
  console.error('No se pudo iniciar el servidor:', e && e.message);
  process.exit(1);
});
