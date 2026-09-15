/**
 * Mueve los adjuntos ya subidos a `{CLOUDINARY_FOLDER}/{userId}/{key}/{index}`
 * y reescribe en Mongo lo que ese cambio invalida.
 *
 *   node --env-file=.env scripts/migrate-image-folders.mjs           # solo mirar
 *   node --env-file=.env scripts/migrate-image-folders.mjs migrar    # moverlas
 *
 * Contra producción, con las credenciales de producción y **desde el
 * portátil**: mover cientos de imágenes de una en una no cabe en los diez
 * segundos de una función de Vercel, y esto no tiene prisa.
 *
 * ## Qué hay que reescribir
 *
 * Renombrar en Cloudinary cambia el `public_id` y, con él, la URL: lo que
 * había guardado apuntando al nombre viejo deja de resolver. En esta base eso
 * es **un solo campo en un solo sitio**, `images.publicId`, y conviene saber
 * por qué no hay más:
 *
 * - `images.version` también cambia —el renombrado cuenta como escritura— y
 *   entra en la URL firmada, así que se actualiza en la misma operación.
 * - `images.etag` **no** cambia: es el hash del contenido y los bytes son los
 *   mismos en otro sitio. De ahí que `days.thumb`, que desde la tanda 8 guarda
 *   ese hash y no una miniatura, no haya que tocarlo.
 * - Los navegadores guardan referencias `cld:{publicId}@{etag}` en su
 *   almacenamiento local, y las suyas quedan viejas. No se rompe nada: lo que
 *   se pinta se pide por `key`, `index` y `etag` (ver `rawSrc`), donde el
 *   `publicId` no aparece; y el único sitio que lo mira, el `PUT` de
 *   `api/images.ts`, ya sabe no encontrar el documento de origen y responder
 *   con la referencia que hay ahora.
 *
 * ## Si se corta a la mitad
 *
 * Es idempotente y reanudable, y lo es en los dos sentidos del fallo:
 *
 * - **Falla Cloudinary**: no se ha movido nada, el documento se queda como
 *   estaba y la imagen se sigue sirviendo desde su sitio de siempre.
 * - **Falla Mongo después de mover**: el documento apuntaría a un nombre que
 *   ya no existe, que es la única forma de perder una imagen de vista. Se
 *   deshace el renombrado en el acto; y si tampoco se puede deshacer, la
 *   siguiente pasada lo recoge —un origen que no está y un destino que sí es
 *   exactamente eso— y solo arregla Mongo.
 */
import { MongoClient } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';

/* --- Entorno ------------------------------------------------------------- */

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Falta MONGODB_URI. ¿Lanzaste esto con `node --env-file=.env`?');
  process.exit(1);
}

/*
 * Las tres de Cloudinary, y las tres de verdad: esto usa la **API Admin**
 * —`api.resource`, `api.resources`— además del cargador, y ninguna de las dos
 * firma nada sin la *API Secret*. Una subida sin firmar podría hacerse con un
 * preset; renombrar y listar, no.
 */
for (const nombre of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
  if (!process.env[nombre]) {
    console.error(`Falta ${nombre}.`);
    process.exit(1);
  }
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

/* El mismo nombre que construye el servidor, con la misma normalización. Va
   copiado porque este script no puede importar `lib/cloudinary.ts`: aquello
   lee sus credenciales de `astro:env`, que solo existe dentro de Astro. Si
   allí cambia la forma del `public_id`, aquí también. */
const FOLDER = (process.env.CLOUDINARY_FOLDER ?? 'planificador').replace(/^\/+|\/+$/g, '') || 'planificador';
const AUTH = { type: 'authenticated', resource_type: 'image' };
const publicIdFor = (userId, key, index) => `${FOLDER}/${userId}/${key}/${index}`;

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

const accion = process.argv[2] ?? 'ver';

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
await client.connect();
const db = client.db(databaseName());
const images = db.collection('images');

/** Cierra la conexión pase lo que pase: un `throw` suelto dejaría el proceso colgado. */
async function salir(codigo) {
  await client.close();
  process.exit(codigo);
}

/* --- Qué hay que mover --------------------------------------------------- */

/*
 * Todo lo que tenga bytes arriba y no esté ya bajo la carpeta nueva. El filtro
 * va por prefijo y no por «es distinto del destino» para que una imagen que ya
 * esté en su sitio no cueste ni una consulta, que son la mayoría en cuanto
 * esto se haya corrido una vez.
 *
 * Los documentos sin `publicId` —los que se quedaron sin migrar en la tanda
 * 8— no son de aquí: no tienen nada arriba que mover. Los recoge
 * `migrate-images.mjs`, que es quien sube lo que aún vive en Mongo.
 */
const prefijo = new RegExp(`^${FOLDER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`);

async function recuento(titulo) {
  const [total, dentro, sinSubir] = await Promise.all([
    images.countDocuments({ publicId: { $exists: true } }),
    images.countDocuments({ publicId: prefijo }),
    images.countDocuments({ publicId: { $exists: false } }),
  ]);
  console.log(`\n${titulo}`);
  console.log(`  ${total} imágenes con bytes en Cloudinary`);
  console.log(`  ${dentro} ya bajo «${FOLDER}/» · ${total - dentro} fuera`);
  if (sinSubir) {
    console.log(`  ${sinSubir} sin subir todavía (son de \`migrate-images.mjs\`, no de aquí)`);
  }
  return { total, dentro };
}

const antes = await recuento('Antes:');

const pendientes = await images
  .find({ publicId: { $exists: true, $not: prefijo } })
  .sort({ userId: 1, key: 1, index: 1 })
  .toArray();

if (pendientes.length === 0) {
  console.log('\nNo hay nada que mover.\n');
  await salir(0);
}

/* Un vistazo a lo que va a pasar, que en `ver` es todo lo que pasa. */
console.log(`\n${pendientes.length} imágenes que mover:`);
for (const doc of pendientes.slice(0, 5)) {
  console.log(`  ${doc.publicId}\n    → ${publicIdFor(String(doc.userId), doc.key, doc.index)}`);
}
if (pendientes.length > 5) console.log(`  …y ${pendientes.length - 5} más`);

if (accion !== 'migrar') {
  console.log('\n(nada escrito — repite con `migrar` para hacerlo de verdad)\n');
  await salir(0);
}

/* --- El movimiento ------------------------------------------------------- */

/**
 * Deja el documento apuntando a donde está ahora la imagen.
 *
 * `etag` no entra: son los mismos bytes y el renombrado no lo devuelve. Y el
 * filtro repite el `publicId` de origen a propósito —una escritura
 * condicionada—: si otra pasada de esto, o una subida de la persona desde el
 * navegador, ya ha tocado ese documento, aquí no se pisa nada.
 */
function apuntar(doc, recurso) {
  return images.updateOne(
    { _id: doc._id, publicId: doc.publicId },
    { $set: { publicId: recurso.public_id, version: recurso.version } },
  );
}

let movidas = 0;
let recuperadas = 0;
let fallos = 0;
/** Lo que quedó a medias y no se pudo deshacer. Se nombra al final, en alto. */
const rotas = [];

console.log('\nMoviendo…');

for (const doc of pendientes) {
  const desde = doc.publicId;
  const hasta = publicIdFor(String(doc.userId), doc.key, doc.index);

  if (desde === hasta) continue;

  let recurso;
  try {
    /*
     * `to_type` tan explícito como `type`: sin él, renombrar un recurso
     * `authenticated` lo devuelve al tipo de fábrica, `upload`, y entonces sus
     * bytes serían públicos para quien acertara la dirección. Es el mismo
     * cuidado que tiene `renameImage` en `lib/cloudinary.ts`.
     *
     * `invalidate` purga el CDN del nombre viejo. El nuevo no lo necesita —no
     * ha servido nada todavía—, pero el viejo puede tener copias intermedias
     * de sus derivadas, y esas copias no deben sobrevivir a la imagen.
     */
    recurso = await cloudinary.uploader.rename(desde, hasta, {
      ...AUTH,
      to_type: 'authenticated',
      overwrite: true,
      invalidate: true,
    });
  } catch (error) {
    /*
     * Lo más probable, si es un 404, es que **ya se moviera** en una pasada
     * anterior que se cortó antes de escribir en Mongo. No hay nada que mover:
     * hay que preguntarle a Cloudinary si el destino existe y, si existe,
     * arreglar solo el documento. Cualquier otro fallo es un fallo: la imagen
     * se queda donde estaba, servida por su `publicId` de siempre.
     */
    const codigo = error?.error?.http_code ?? error?.http_code;
    if (codigo !== 404) {
      fallos++;
      console.error(`  falló ${desde}: ${error?.message ?? error}`);
      continue;
    }

    try {
      recurso = await cloudinary.api.resource(hasta, AUTH);
      recuperadas++;
    } catch {
      fallos++;
      console.error(`  ni origen ni destino: ${desde} (¿borrada a mano?)`);
      continue;
    }
  }

  try {
    await apuntar(doc, recurso);
  } catch (error) {
    /*
     * Los bytes están en el sitio nuevo y el documento sigue nombrando el
     * viejo: la imagen ha dejado de verse. Se deshace el renombrado, que
     * devuelve las dos mitades a un estado coherente y deja el trabajo para
     * otra pasada.
     */
    console.error(`  Mongo falló tras mover ${desde}: ${error?.message ?? error}`);
    try {
      await cloudinary.uploader.rename(recurso.public_id, desde, {
        ...AUTH,
        to_type: 'authenticated',
        overwrite: true,
        invalidate: true,
      });
      fallos++;
      console.error('    deshecho: la imagen se sigue sirviendo desde su sitio de antes');
    } catch (vuelta) {
      rotas.push({ desde, hasta: recurso.public_id });
      console.error(`    NO se pudo deshacer: ${vuelta?.message ?? vuelta}`);
    }
    continue;
  }

  movidas++;
  if (movidas % 25 === 0) console.log(`  …${movidas}/${pendientes.length}`);
}

console.log(
  `\nMovidas: ${movidas}` +
    (recuperadas ? ` (${recuperadas} ya estaban movidas y solo había que apuntarlas)` : '') +
    `. Fallos: ${fallos}${fallos ? ' (vuelve a lanzarlo: se saltará lo ya hecho)' : ''}.`,
);

if (rotas.length) {
  console.error(
    `\n⚠️  ${rotas.length} imágenes movidas en Cloudinary y sin apuntar en Mongo.` +
      '\n    No se ven hasta que se arreglen. Vuelve a lanzar esto en cuanto Mongo responda:' +
      '\n    la pasada siguiente encuentra el origen vacío, el destino puesto, y solo escribe.',
  );
  for (const r of rotas) console.error(`    ${r.desde} → ${r.hasta}`);
}

/* --- La comprobación ----------------------------------------------------- */

const despues = await recuento('Después:');
console.log(
  despues.total === antes.total
    ? '  El total cuadra: no se ha perdido ningún metadato.'
    : `  ⚠️  El total ha cambiado (${antes.total} → ${despues.total}). Míralo antes de seguir.`,
);

/*
 * Y un repaso desde el otro lado, que es el que ve lo que a Mongo no le consta:
 * lo que quede en la nube fuera de la carpeta nueva. Normalmente será lo que
 * dejó un borrado que no llegó a `destroy` —huérfanos que ocupan cuota y que no
 * mira nadie—, pero si aparece algo aquí después de una pasada limpia, conviene
 * saberlo antes de borrar la carpeta vieja a mano.
 *
 * Se mira hasta cinco páginas de 500: suficiente para un archivo de este
 * tamaño y un tope para no gastar la cuota de la API Admin —500 llamadas por
 * hora en el plan gratuito— en un listado informativo.
 */
console.log('\nRepasando la nube…');
let cursor;
let sueltas = 0;
let paginas = 0;
try {
  do {
    const pagina = await cloudinary.api.resources({ ...AUTH, max_results: 500, next_cursor: cursor });
    for (const recurso of pagina.resources ?? []) {
      if (!recurso.public_id.startsWith(`${FOLDER}/`)) {
        if (sueltas < 10) console.log(`  fuera de «${FOLDER}/»: ${recurso.public_id}`);
        sueltas++;
      }
    }
    cursor = pagina.next_cursor;
  } while (cursor && ++paginas < 5);

  if (sueltas > 10) console.log(`  …y ${sueltas - 10} más`);
  console.log(
    sueltas === 0
      ? `  Nada fuera de «${FOLDER}/».`
      : `  ${sueltas} recursos fuera de «${FOLDER}/». Si no salen arriba como fallo,` +
          '\n  son huérfanos de algún borrado a medias: no los mira nadie y se pueden quitar.',
  );
  if (cursor) console.log('  (quedaban más páginas por mirar: el repaso se corta a las cinco)');
} catch (error) {
  // El repaso es informativo: que falle no invalida lo que ya se movió.
  console.error(`  no se pudo listar la nube: ${error?.message ?? error}`);
}

console.log('');
await salir(fallos || rotas.length ? 1 : 0);
