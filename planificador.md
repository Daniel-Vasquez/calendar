# Planificador 2026

Calendario anual con notas, colores, imágenes adjuntas y —próximamente—
recordatorios por WhatsApp. Astro + React, MongoDB Atlas, desplegado en Vercel.

Este archivo es el mapa del proyecto y la lista de lo que falta. El *por qué* de
cada decisión está en los comentarios del código; aquí va lo que no cabe en un
comentario.

---

## Cómo está montado

**Local-first.** Guardar escribe en `localStorage` de forma síncrona y la subida
va detrás. La interfaz nunca espera a la red y sigue funcionando sin conexión;
MongoDB es la fuente de verdad, no el camino crítico.

El sitio era estático. Al añadir sesiones dejó de serlo: el middleware de Astro
no corre en rutas prerenderizadas —ahí se ejecuta en el build, cuando no hay
sesión que leer—, así que todas las páginas son `prerender = false`.

```
navegador                     servidor                   Atlas
─────────                     ────────                   ─────
DayModal → handleSave
        → localStorage  (instantáneo, sin red)
        → sync.ts (cola)  ──POST /api/days──────────────→ days
                          ──PUT  /api/images (1 a 1)────→ images
middleware ──────────────────────────────────────────────→ session, user
```

### Archivos

| Archivo | Qué hace |
|---|---|
| `src/lib/mongo.ts` | Cliente cacheado en `globalThis`, colecciones e índices |
| `src/auth.ts` · `src/auth-client.ts` | Better Auth, servidor y navegador |
| `src/middleware.ts` | Sesión en `Astro.locals`; candado por defecto |
| `src/lib/wire.ts` | Formato en que un día viaja; lo importan los dos lados |
| `src/lib/sync.ts` | Cola, fusión, subida y descarga bajo demanda |
| `src/lib/storage.ts` | `localStorage`, saneado, forma de `DayEntry` |
| `src/lib/image.ts` | Redimensionado, compresión y miniaturas |
| `src/pages/api/days.ts` | Lectura y subida por lotes de días |
| `src/pages/api/images.ts` | Una imagen por petición; recorte de cola |
| `src/pages/api/health.ts` | ¿Alcanza la función desplegada a Atlas? |
| `src/components/SyncBadge.tsx` | «Al día» / «Guardando…» / «N sin subir» |

### Colecciones

| Colección | Contenido | Índice |
|---|---|---|
| `user` `session` `account` | Las crea Better Auth. Tu nombre vive en `user` | propios |
| `days` | Un día por usuario: marca, nota, color, `imageCount`, `thumb` | `{userId, key}` único |
| `images` | Una imagen por documento, con su posición | `{userId, key, index}` único |

`userId` se guarda como **ObjectId**, no como cadena.

Los meses plegados **no** suben: son preferencia de este dispositivo y se
quedan en `localStorage`.

### Cómo se resuelven los conflictos

El árbitro es `updatedAt`, en milisegundos del reloj del cliente que escribió.
Gana la versión más reciente; un empate lo gana lo local, que es lo que la
persona tiene delante.

El `updateOne` filtra por `updatedAt: { $lt: entrante }`. Si lo guardado es
igual o más reciente el filtro no encaja, el `upsert` intenta insertar y el
índice único lo rechaza con E11000. **Ese error es el resultado correcto**, no
una avería: significa que el servidor ya tenía algo mejor, y se cuenta como
descartado.

Un día borrado no se elimina: se marca con una **lápida**. Sin ellas, borrar un
día en el móvil y abrir el portátil —que aún lo tiene— lo resucitaría.

### Variables de entorno

`.env` en local (ignorado por git), panel de Vercel en producción. Ver
`.env.example`.

| Variable | Nota |
|---|---|
| `MONGODB_URI` | Si la ruta trae nombre de base, manda esa |
| `MONGODB_DB` | Opcional. Manda sobre la anterior |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. **Distinta en producción** |
| `BETTER_AUTH_URL` | Origen público **con esquema** y sin barra final |

---

## Lo hecho en esta sesión

### 1 · Servidor y conexión — `af32cfc`

Adaptador de Vercel y `astro:env`, para que una variable ausente falle
nombrándose en vez de aparecer como un error de conexión a mitad de petición.

`MongoClient` cacheado en `globalThis`: uno por petición agota el límite de
conexiones de Atlas en serverless. Se cachea también la promesa de conexión,
porque en un arranque en frío dos peticiones simultáneas abrirían dos clientes
y solo uno quedaría referenciado. Si falla, la promesa se descachea: si no, un
fallo puntual envenenaría todas las peticiones siguientes.

`serverSelectionTimeoutMS: 8000` en vez de los 30 s de fábrica, que superan la
duración máxima de la función en Hobby.

Comprobado: 1272 ms en frío → 80 ms en la segunda llamada.

### 2 · Login — `af32cfc`

Better Auth con adaptador de Mongo. No hay esquema que declarar ni migración
que correr; las colecciones se crean solas.

**El candado va en el middleware, no en cada página.** Solo `/login`,
`/api/health` y `/api/auth/*` son públicas; todo lo demás exige sesión. Así una
página nueva nace protegida en vez de nacer abierta esperando a que alguien se
acuerde. Las APIs reciben `401`; las páginas, redirección con `next` validado
contra rutas internas.

`context.isPrerendered` corta el middleware durante el build, que si no abriría
conexiones a Atlas al generar páginas.

Caché de sesión en cookie, 5 minutos: sin ella, cada carga de página consulta
la colección `session` antes de pintar nada.

Sesiones de 30 días, renovadas una vez al día como mucho.

### 3 · Sincronía de los días — `af32cfc`

La sincronía se engancha en **un único punto**: el efecto que ya guardaba en
`localStorage` compara contra la versión anterior —guardada en un `ref`, sin
reparsear el año entero— y anota qué cambió. Todas las vías de edición
desembocan ahí, así que ninguna puede olvidarse de avisar. El tramo de slate de
diciembre, marcado con Shift, lo confirmó.

La migración de lo que ya había en el navegador **no es un caso especial**: sale
de la propia fusión. Un día local que el servidor no conoce se encola y sube.

Un día solo sale de la cola si su marca de tiempo sigue siendo la que se envió.
Sin eso, editarlo mientras subía lo habría borrado de la cola sin haber llegado
nunca al servidor.

### 4 · Imágenes en su propia colección — `03b92ff`

Seis adjuntos son más de 4 MB de data URL. Ahora viajan aparte y bajo demanda;
con el día solo van la cuenta y una miniatura.

Medido con datos reales: **17 días en 7,1 KB** frente a 0,18 MB de imágenes,
26 veces menos al abrir el calendario.

Una imagen por petición: seis a la vez quedarían al filo del tope de 4,5 MB del
cuerpo de una función de Vercel.

La miniatura se genera al subir el conjunto, no al adjuntar: es el momento en
que se sabe que ya no va a cambiar. Localmente la agenda usa la imagen completa
que ya tiene, así que la miniatura existe solo para los demás dispositivos.

**Guardar nunca borra adjuntos que no están descargados.** Abrir un día en el
móvil antes de que lleguen sus imágenes y pulsar Guardar habría mandado
`imageCount: 0`. Ahora se conservan intactos los campos que las describen.

`imagesAt` distingue «el servidor sabe que hay dos» de «el servidor tiene las
dos»: la cuenta viajó desde la tanda 3, los adjuntos no.

---

## Lo que falta

### Tanda 5 · Recordatorios: modelo e interfaz

- [ ] `src/lib/reminder.ts`: tipo `Reminder`, saneado, `toEpoch(key, 'HH:MM')`,
      `dueReminders(data, now)` y el texto por defecto.
- [ ] `reminder?: Reminder` en `DayEntry` y en `WireDay`, con su saneado.
- [ ] **`hasContent` tiene que contar el recordatorio.** Sin eso, guardar solo
      una hora borra el día al instante.
- [ ] Editar la hora o el texto **limpia `sent`**. Si no, cambiar las 9:00 por
      las 18:00 deja el recordatorio como ya enviado y no suena nunca.
- [ ] `ReminderField.tsx` en el modal: interruptor, `<input type="time">`,
      texto y estado. `DayModal` ya pasa de 400 líneas: va aparte.
- [ ] Campana en `DayCell` y hora en `AgendaPanel`, junto a los indicadores
      que ya existen.
- [ ] `VALARM` en el `.ics` de `transfer.ts`.

Guardar `at` en epoch ms además de la hora local: el cron corre en UTC y las
claves del día son locales, y el absoluto es lo único que ambos interpretan
igual.

### Tanda 6 · El envío

- [ ] Ajustes de WhatsApp (número y `apikey`) en una colección `settings`,
      **no en el navegador**.
- [ ] `POST /api/cron/reminders` con cabecera secreta (`CRON_SECRET`).
- [ ] Ventana de gracia. Sin un tope —2 h parece razonable— volver tras tres
      días dispara diez mensajes de golpe. Lo que pase de ahí se marca como
      perdido y se enseña en la agenda.
- [ ] Programador externo apuntando al endpoint.

**Vercel Hobby no sirve como cron:** solo admite uno al día, y aun así se
dispara en cualquier momento dentro de la hora indicada. Alternativas gratis:
cron-job.org (precisión de minutos), GitHub Actions (retrasos de 5–20 min, pero
ahora vale porque los datos ya no están en el repo) o un Worker de Cloudflare de
cinco líneas que solo hace ping.

Canal elegido: **CallMeBot**. Un `GET`, sin registro ni plantillas. Meta Cloud
API queda descartada porque un recordatorio lo inicia el negocio y eso exige
plantilla aprobada y tarifa por mensaje. Desde el servidor no hay problema de
CORS y la respuesta se lee entera, así que «enviado» será verdad y no un acto
de fe.

### Despliegue

`GET /api/health` es el primer sitio al que mirar: dice si la función alcanza
Atlas y con qué origen se configuró la sesión. No depende del middleware ni de
que la sesión sea válida, precisamente para seguir contestando cuando lo demás
no lo hace.

- [ ] Las tres variables en el panel de Vercel, con `BETTER_AUTH_SECRET`
      **distinta** de la local.
- [ ] `BETTER_AUTH_URL` **con `https://` delante**. Sin esquema, Better Auth
      lanza al construirse; como el middleware lo importa, cae el sitio entero
      con 500 vacíos. Hoy se completa solo y se avisa en el log, pero la
      variable debería estar bien puesta.
- [ ] *Network Access* de Atlas: con la IP propia en lista blanca en vez de
      `0.0.0.0/0`, las funciones de Vercel no entran.
- [ ] `trustedOrigins` en `auth.ts` si se usan despliegues de vista previa: su
      URL no coincide con `BETTER_AUTH_URL` y el login devuelve `403`.
- [ ] Campo `engines` en `package.json`: local es Node 26, Vercel usa la 24.

### Deuda conocida

- [ ] Las miniaturas viajan dentro de `GET /api/days`. La actual pesa 5 KB y el
      tope son 20 KB: un año con imagen todos los días serían ~1,8 MB por carga.
      Irreal para uso personal, pero si se acerca, basta bajar `THUMB_SIDE` de
      192 a 128 o servirlas aparte.
- [ ] Cambiar un adjunto reenvía los seis del día. Con seis como tope y
      ediciones contadas, comparar cuáles cambiaron costaría más de lo que
      ahorra — pero está ahí.
- [ ] Las lápidas no se purgan nunca. Sobra sitio, pero crecen sin fin.
- [ ] `localStorage` sigue guardando la copia completa con imágenes, así que su
      cuota sigue siendo un techo. `MAX_DATA_URL_LENGTH` (700 KB) se dimensionó
      para esa cuota y ahora podría subir.
- [ ] No hay recuperación de contraseña: haría falta un servidor de correo.
- [ ] `IMAGE_ACTION` en `DayModal.tsx` no se usa. Anterior a esta sesión.
- [ ] La galería descarga en serie todas las imágenes que falten, sin límite ni
      desalojo. Con muchas notas conviene paginar.
- [ ] `allowScripts` en `package.json` autoriza el `postinstall` de esbuild.
      npm 11.6+ lo pide; sin ello solo avisa, no rompe el build. Sin anclar a
      versión, para que no vuelva a preguntar en cada actualización.

---

## Trabajar en el proyecto

```bash
npm run dev                  # servidor de desarrollo
npx astro check              # tipos
npx astro build              # build de producción
curl localhost:4321/api/health   # ¿responde Atlas?
```

Tocar `astro.config.mjs` obliga a **reiniciar** el servidor: el esquema de
`astro:env` se lee al arrancar, y sin reinicio las variables llegan vacías.
