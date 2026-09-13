/**
 * Quién puede crearse una cuenta.
 *
 * El registro del sitio está abierto a cualquiera que dé con la URL; esta lista
 * es lo que decide quién llega a tener cuenta. Se gestiona desde aquí y no
 * desde una pantalla porque cambia unas pocas veces en la vida del proyecto, y
 * un panel de administración —con su concepto de administrador, sus permisos y
 * su interfaz— sería más superficie que el problema que resuelve.
 *
 *   node --env-file=.env scripts/allowlist.mjs                       # ver la lista
 *   node --env-file=.env scripts/allowlist.mjs add correo@ejemplo.com ["nota"]
 *   node --env-file=.env scripts/allowlist.mjs remove correo@ejemplo.com
 *
 * Contra producción usa las credenciales de producción: es la misma base que
 * lee el sitio desplegado.
 */
import { MongoClient } from 'mongodb';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Falta MONGODB_URI. ¿Lanzaste esto con `node --env-file=.env`?');
  process.exit(1);
}

/** El mismo criterio que usa el servidor al comparar. Ver `normalizeEmail`. */
const normalize = (value) => value.trim().toLowerCase();

/** Suficiente para atrapar un dedazo; la validación de verdad la hace el alta. */
const PARECE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

const [accion = 'list', correoCrudo, nota] = process.argv.slice(2);

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
await client.connect();
const db = client.db(databaseName());
const allowlist = db.collection('allowlist');
await allowlist.createIndex({ email: 1 }, { unique: true });

/** La lista, y de paso quién tiene ya cuenta: lo segundo explica lo primero. */
async function mostrar() {
  const invitados = await allowlist.find({}).sort({ addedAt: 1 }).toArray();
  const usuarios = await db.collection('user').find({}).project({ email: 1, name: 1 }).toArray();
  const conCuenta = new Set(usuarios.map((u) => normalize(u.email ?? '')));

  console.log(`\nInvitados (${invitados.length}):`);
  if (invitados.length === 0) {
    console.log('  (ninguno — con la lista vacía no puede registrarse nadie)');
  }
  for (const i of invitados) {
    const estado = conCuenta.has(i.email) ? 'ya tiene cuenta' : 'sin registrar todavía';
    console.log(`  ${i.email.padEnd(32)} ${estado}${i.note ? `  · ${i.note}` : ''}`);
  }

  // Quien ya tiene cuenta entra aunque no esté en la lista —el gancho solo mira
  // las altas—, pero verlo aquí evita creer que la lista está completa.
  const fuera = usuarios.filter((u) => !invitados.some((i) => i.email === normalize(u.email ?? '')));
  if (fuera.length) {
    console.log(`\nCon cuenta pero fuera de la lista (${fuera.length}) — siguen entrando igual:`);
    for (const u of fuera) console.log(`  ${u.email}${u.name ? `  · ${u.name}` : ''}`);
  }
  console.log();
}

try {
  if (accion === 'list') {
    await mostrar();
  } else if (accion === 'add') {
    const email = normalize(correoCrudo ?? '');
    if (!PARECE_CORREO.test(email)) {
      console.error(`«${correoCrudo ?? ''}» no parece un correo.`);
      process.exitCode = 1;
    } else {
      // `upsert` para que repetir el comando no falle contra el índice único:
      // añadir a quien ya está no debería ser un error, sino no hacer nada.
      const r = await allowlist.updateOne(
        { email },
        { $set: { email, ...(nota ? { note: nota } : {}) }, $setOnInsert: { addedAt: Date.now() } },
        { upsert: true },
      );
      console.log(r.upsertedCount ? `Añadido: ${email}` : `Ya estaba: ${email}`);
      await mostrar();
    }
  } else if (accion === 'remove') {
    const email = normalize(correoCrudo ?? '');
    const r = await allowlist.deleteOne({ email });
    console.log(r.deletedCount ? `Quitado: ${email}` : `No estaba en la lista: ${email}`);
    // Quitarlo no cierra ninguna sesión ni borra la cuenta: solo impide que
    // ese correo vuelva a registrarse. Dicho, porque es fácil esperar lo otro.
    if (r.deletedCount) console.log('(si ya tenía cuenta, sigue teniéndola y sigue entrando)');
    await mostrar();
  } else {
    console.error(`Acción desconocida: ${accion}. Usa list, add o remove.`);
    process.exitCode = 1;
  }
} finally {
  await client.close();
}
