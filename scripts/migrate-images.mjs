/**
 * Lleva a Cloudinary los adjuntos que todavía viven dentro de Mongo.
 *
 *   node --env-file=.env scripts/migrate-images.mjs           # solo mirar
 *   node --env-file=.env scripts/migrate-images.mjs migrar    # subir y reescribir
 *
 * Contra producción, con las credenciales de producción y **desde el
 * portátil**, no desde una función: no hay prisa, no hay límite de tiempo y
 * subir cientos de imágenes no cabe en los diez segundos de una invocación.
 *
 * Es idempotente y reanudable. Cada imagen se sube primero, se escribe después
 * su referencia y solo entonces se suelta el `dataUrl`; un documento que ya
 * tenga `publicId` se salta. Si esto se corta a la mitad —o se lanza dos
 * veces—, lo que ya pasó no vuelve a pasar.
 */
import { MongoClient } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('Falta MONGODB_URI. ¿Lanzaste esto con `node --env-file=.env`?');
  process.exit(1);
}
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

/* Las mismas dos medidas y el mismo nombre que usa el servidor. Van copiados
   porque este script no puede importar `lib/cloudinary.ts`: aquello lee sus
   credenciales de `astro:env`, que solo existe dentro de Astro. Si allí
   cambian, aquí también. */
const THUMB = { width: 192, height: 192, crop: 'limit', quality: 'auto:eco' };
const VIEW = { width: 1280, height: 1280, crop: 'limit', quality: 'auto:good' };
const AUTH = { type: 'authenticated', resource_type: 'image' };
/* La carpeta sale del entorno, como en el servidor, para que lo que suba esto
   caiga donde caería una subida normal. Antes estaba fija en `uploads/users`;
   lo que quedara allí lo mueve `migrate-image-folders.mjs`. */
const FOLDER = (process.env.CLOUDINARY_FOLDER ?? 'planificador').replace(/^\/+|\/+$/g, '') || 'planificador';
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
const days = db.collection('days');

/**
 * Cuántas imágenes tiene cada persona y en qué estado. Es la única
 * comprobación que importa: el total por usuario tiene que ser el mismo antes
 * y después.
 */
async function recuento(titulo) {
  const porUsuario = await images
    .aggregate([
      {
        $group: {
          _id: '$userId',
          total: { $sum: 1 },
          enMongo: { $sum: { $cond: [{ $ifNull: ['$dataUrl', false] }, 1, 0] } },
          enCloudinary: { $sum: { $cond: [{ $ifNull: ['$publicId', false] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();

  console.log(`\n${titulo}`);
  if (porUsuario.length === 0) console.log('  (no hay imágenes)');
  for (const u of porUsuario) {
    console.log(
      `  ${String(u._id).padEnd(26)} ${String(u.total).padStart(4)} imágenes` +
        ` · ${u.enCloudinary} en Cloudinary · ${u.enMongo} aún en Mongo`,
    );
  }
  const conBase64 = await days.countDocuments({ thumb: /^data:/ });
  console.log(`  Días con miniatura en base64: ${conBase64}`);
  return porUsuario;
}

const antes = await recuento('Antes:');

if (accion !== 'migrar') {
  console.log('\n(nada escrito — repite con `migrar` para hacerlo de verdad)\n');
  await client.close();
  process.exit(0);
}

/* --- Las imágenes ------------------------------------------------------- */

/*
 * Pendiente es todo lo que aún guarda bytes en Mongo y, además, lo que ya está
 * en Cloudinary pero sin `etag`. Eso segundo lo dejaron las imágenes que
 * subieron por la vía normal antes de que la referencia llevara el hash del
 * contenido, y sin él la caché del proxy no sabría distinguir una imagen de
 * otra en la misma posición.
 */
const pendientes = await images
  .find({ $or: [{ dataUrl: { $exists: true } }, { etag: { $exists: false } }] })
  .sort({ userId: 1, key: 1, index: 1 })
  .toArray();
console.log(`\nSubiendo ${pendientes.length} imágenes…`);

let subidas = 0;
let fallos = 0;

for (const doc of pendientes) {
  // Ya subida y con todo lo suyo: solo queda soltar los bytes, si es que
  // todavía los arrastra. Es la vuelta anterior que se cortó a la mitad.
  if (doc.publicId && doc.etag) {
    await images.updateOne({ _id: doc._id }, { $unset: { dataUrl: '' } });
    continue;
  }

  // Está arriba pero sin `etag` y ya no quedan bytes que resubir: se le
  // pregunta a Cloudinary, que es quien lo sabe.
  if (doc.publicId && !doc.dataUrl) {
    try {
      const recurso = await cloudinary.api.resource(doc.publicId, AUTH);
      await images.updateOne({ _id: doc._id }, { $set: { etag: recurso.etag, version: recurso.version } });
      subidas++;
    } catch (error) {
      fallos++;
      console.error(`  sin etag y sin bytes ${doc.key}#${doc.index}:`, error?.message ?? error);
    }
    continue;
  }

  const publicId = publicIdFor(String(doc.userId), doc.key, doc.index);
  try {
    const subida = await cloudinary.uploader.upload(doc.dataUrl, {
      ...AUTH,
      public_id: publicId,
      overwrite: true,
      eager: [THUMB, VIEW],
      eager_async: false,
    });

    // Primero la referencia y **después** el `dataUrl`, en dos escrituras: si
    // esto se corta entre medias queda un documento con las dos cosas, que es
    // recuperable. Al revés quedaría uno sin ninguna, que no lo es.
    await images.updateOne(
      { _id: doc._id },
      {
        $set: {
          publicId: subida.public_id,
          version: subida.version,
          etag: subida.etag,
          format: subida.format,
          bytes: subida.bytes,
          width: subida.width,
          height: subida.height,
        },
      },
    );
    await images.updateOne({ _id: doc._id }, { $unset: { dataUrl: '' } });

    subidas++;
    if (subidas % 10 === 0) console.log(`  …${subidas}/${pendientes.length}`);
  } catch (error) {
    fallos++;
    console.error(`  falló ${doc.key}#${doc.index} de ${doc.userId}:`, error?.message ?? error);
  }
}

console.log(`Subidas: ${subidas}. Fallos: ${fallos}${fallos ? ' (vuelve a lanzarlo: se saltará lo ya hecho)' : ''}.`);

/* --- Las miniaturas del día --------------------------------------------- */

/*
 * `days.thumb` deja de ser una miniatura en base64 y pasa a ser el testigo de
 * la primera imagen, que es lo que el navegador necesita para pedirle la
 * derivada al proxy. Aquí se retira de golpe la deuda de ~1,8 MB por carga.
 *
 * **`updatedAt` no se toca.** Es el árbitro de la fusión: subirlo haría que el
 * día del servidor le ganara a cualquier edición que alguien tenga sin subir
 * en su navegador, y eso es perder datos por una miniatura. El precio de no
 * tocarlo es que un dispositivo que ya conozca el día no verá la miniatura
 * nueva hasta que ese día cambie por cualquier otro motivo — y como los
 * navegadores que aún guarden las imágenes las resuben al arrancar (ver
 * `pull`), eso pasa solo.
 */
const conImagenes = await days.find({ imageCount: { $gt: 0 } }).project({ userId: 1, key: 1 }).toArray();
let puestas = 0;

for (const day of conImagenes) {
  const primera = await images.findOne({ userId: day.userId, key: day.key, index: 0 });
  if (!primera?.etag) continue;
  const r = await days.updateOne({ _id: day._id }, { $set: { thumb: primera.etag } });
  puestas += r.modifiedCount;
}

// Y las de los días que ya no tienen imágenes: nada que pedir, nada que
// guardar. Cabe un base64 huérfano de un día al que se le quitaron todas.
const limpiadas = await days.updateMany({ thumb: /^data:/ }, { $unset: { thumb: '' } });

console.log(`Miniaturas puestas: ${puestas}. Base64 sobrantes retirados: ${limpiadas.modifiedCount}.`);

/* --- La comprobación ----------------------------------------------------- */

const despues = await recuento('Después:');

const mismo =
  antes.length === despues.length &&
  antes.every((a, i) => String(a._id) === String(despues[i]._id) && a.total === despues[i].total);
console.log(
  mismo
    ? '\nEl total por usuario cuadra.\n'
    : '\n⚠️  El total por usuario NO cuadra. Mira el detalle de arriba antes de seguir.\n',
);

await client.close();
