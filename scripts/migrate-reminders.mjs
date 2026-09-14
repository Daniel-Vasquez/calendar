/**
 * Convierte el recordatorio único de cada día en la lista de la tanda 9.
 *
 *   node --env-file=.env scripts/migrate-reminders.mjs           # solo mirar
 *   node --env-file=.env scripts/migrate-reminders.mjs migrar    # escribir
 *
 * Contra producción, con las credenciales de producción y **después de
 * desplegar**, no antes. Es el mismo orden que la tanda 8 y por la misma razón:
 * el código nuevo sabe leer las dos formas —`sanitizeWireDay` acepta `reminder`
 * y `reminders`—, pero el viejo no sabe leer la nueva. Migrar primero dejaría a
 * todo el mundo sin avisos hasta que subiera el despliegue.
 *
 * Es idempotente y reanudable. Por cada día con `reminder` se escribe primero
 * `reminders` y **solo entonces** se suelta el campo viejo, en dos escrituras:
 * cortado a la mitad deja un documento con las dos cosas, que es recuperable
 * —el saneado prefiere `reminders`— mientras que al revés dejaría uno sin
 * ninguna, que no lo es. Un día que ya tenga `reminders` se salta.
 *
 * **`updatedAt` no se toca.** Es el árbitro de la fusión, y subirlo haría que el
 * día del servidor le ganara a cualquier edición que alguien tenga sin subir en
 * su navegador. Perder una nota por una migración de forma sería un mal negocio.
 * El precio es que un dispositivo que ya conozca el día no verá el cambio hasta
 * que ese día cambie por otro motivo — y no importa, porque su propio
 * `localStorage` ya se convierte solo al leerlo (ver `sanitizeData`).
 */
import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Falta MONGODB_URI. ¿Lanzaste esto con `node --env-file=.env`?');
  process.exit(1);
}

function databaseName() {
  if (process.env.MONGODB_DB) return process.env.MONGODB_DB;
  try {
    const path = new URL(uri).pathname.replace(/^\//, '');
    if (path) return decodeURIComponent(path);
  } catch {
    /* URI rara: mejor un nombre conocido que `test`. */
  }
  return 'planificador';
}

/* El mismo identificador que genera `newReminderId` en `lib/reminder.ts`: doce
   caracteres del UUID. Va copiado porque este script no puede importar un
   módulo de Astro; si allí cambia la forma, aquí también. */
const nuevoId = () => randomUUID().replace(/-/g, '').slice(0, 12);

const accion = process.argv[2] ?? 'ver';

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
await client.connect();
const db = client.db(databaseName());
const days = db.collection('days');

/**
 * Cuántos avisos tiene cada persona, mire donde mire.
 *
 * Es la única comprobación que importa: el total por usuario tiene que ser el
 * mismo antes y después. Cuenta las dos formas a la vez a propósito, porque
 * durante la migración conviven.
 */
async function recuento(titulo) {
  const filas = await days
    .aggregate([
      { $match: { deleted: { $ne: true } } },
      {
        $project: {
          userId: 1,
          cuantos: {
            $add: [
              { $size: { $ifNull: ['$reminders', []] } },
              { $cond: [{ $ifNull: ['$reminder', false] }, 1, 0] },
            ],
          },
        },
      },
      { $group: { _id: '$userId', total: { $sum: '$cuantos' } } },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  console.log(`\n${titulo}`);
  if (filas.length === 0) console.log('  (ningún recordatorio)');
  for (const fila of filas) console.log(`  ${fila._id}: ${fila.total}`);
  return filas;
}

const antes = await recuento('Antes:');

const pendientes = await days
  .find({ reminder: { $exists: true }, reminders: { $exists: false } })
  .toArray();

console.log(`\nDías con el recordatorio en la forma vieja: ${pendientes.length}.`);

// Y los que ya están migrados pero conservan el campo viejo, que es lo que deja
// un corte a la mitad: solo les falta la segunda escritura.
const aMedias = await days.countDocuments({
  reminder: { $exists: true },
  reminders: { $exists: true },
});
if (aMedias) console.log(`Días a medias de una pasada anterior: ${aMedias}.`);

if (accion !== 'migrar') {
  console.log('\nEn seco. Añade `migrar` para escribir.\n');
  await client.close();
  process.exit(0);
}

/* --- La conversión ------------------------------------------------------- */

let convertidos = 0;
let descartados = 0;
let fallos = 0;

for (const day of pendientes) {
  const viejo = day.reminder;

  // Un recordatorio sin hora no es un recordatorio: el saneado del cliente lo
  // tiraría igual, así que aquí se suelta el campo y se cuenta aparte en vez de
  // arrastrar un objeto a medias hasta la lista nueva.
  if (!viejo || typeof viejo.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(viejo.time)) {
    try {
      await days.updateOne({ _id: day._id }, { $unset: { reminder: '' } });
      descartados++;
    } catch (error) {
      console.error(`  ${day.key}: no se pudo limpiar —`, error.message);
      fallos++;
    }
    continue;
  }

  const reminder = {
    id: typeof viejo.id === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(viejo.id) ? viejo.id : nuevoId(),
    time: viejo.time,
    at: Number.isFinite(viejo.at) ? viejo.at : 0,
    ...(typeof viejo.text === 'string' && viejo.text.trim() ? { text: viejo.text.trim().slice(0, 200) } : {}),
    ...(Number.isFinite(viejo.sent) && viejo.sent > 0 ? { sent: viejo.sent } : {}),
    ...(Number.isFinite(viejo.done) && viejo.done > 0 ? { done: viejo.done } : {}),
  };

  // Sin `at` no hay nada que el cron pueda mirar, y deducirlo aquí obligaría a
  // saber en qué zona horaria se escribió. Se deja que lo rehaga el navegador,
  // que sí lo sabe: `sanitizeReminder` lo calcula desde la clave del día.
  if (!reminder.at) delete reminder.at;

  try {
    // Primero la forma nueva.
    await days.updateOne({ _id: day._id }, { $set: { reminders: [reminder] } });
    // Y solo entonces se suelta la vieja.
    await days.updateOne({ _id: day._id }, { $unset: { reminder: '' } });
    convertidos++;
  } catch (error) {
    console.error(`  ${day.key}: no se pudo convertir —`, error.message);
    fallos++;
  }
}

// Los que se quedaron a medias en una pasada anterior: ya tienen `reminders`,
// así que lo único que falta es retirarles el campo viejo.
const terminados = await days.updateMany(
  { reminder: { $exists: true }, reminders: { $exists: true } },
  { $unset: { reminder: '' } },
);

console.log(
  `\nConvertidos: ${convertidos}. Sin hora, descartados: ${descartados}. ` +
    `Terminados de una pasada anterior: ${terminados.modifiedCount}. ` +
    `Fallos: ${fallos}${fallos ? ' (vuelve a lanzarlo: se saltará lo ya hecho)' : ''}.`,
);

/* --- El índice ----------------------------------------------------------- */

/*
 * El índice parcial sobre `reminder.at` ya no lo usa nadie: la consulta del cron
 * mira `reminders.at`, y el índice nuevo lo crea `getDays` sola en el primer
 * arranque. Dejarlo solo cuesta escrituras, así que se retira aquí.
 */
try {
  await days.dropIndex('reminder.at_1');
  console.log('Índice `reminder.at_1` retirado.');
} catch (error) {
  if (error.codeName === 'IndexNotFound') console.log('El índice `reminder.at_1` ya no estaba.');
  else console.error('No se pudo retirar `reminder.at_1` —', error.message);
}

/* --- La comprobación ----------------------------------------------------- */

const despues = await recuento('Después:');

const mismo =
  antes.length === despues.length &&
  antes.every((a, i) => String(a._id) === String(despues[i]._id) && a.total === despues[i].total);

console.log(
  mismo
    ? '\nEl total por usuario cuadra.\n'
    : `\n⚠️  El total por usuario NO cuadra${descartados ? ` (se descartaron ${descartados} sin hora, que lo explica)` : ''}. Mira el detalle de arriba antes de seguir.\n`,
);

await client.close();
