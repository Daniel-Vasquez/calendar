# Planificador 2026

Calendario anual con notas, colores, imágenes adjuntas y —próximamente—
recordatorios por Telegram. Astro + React, MongoDB Atlas, desplegado en Vercel;
las imágenes van camino de Cloudinary (tanda 7).

**En producción:** <https://planificador.danielvasquez.lat>
· estado: <https://planificador.danielvasquez.lat/api/health>

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
| `src/auth.ts` | Better Auth en el servidor; normaliza el origen público |
| `src/auth-client.ts` | Better Auth en el navegador, con **origen explícito** (ver Trampas) |
| `src/middleware.ts` | Sesión en `Astro.locals`; candado por defecto |
| `src/lib/wire.ts` | Formato en que un día viaja; lo importan los dos lados |
| `src/lib/sync.ts` | Cola, fusión, subida y descarga bajo demanda |
| `src/lib/storage.ts` | `localStorage`, saneado, forma de `DayEntry` |
| `src/lib/reminder.ts` | Hora, texto y estado del aviso; lo importan los dos lados |
| `src/lib/image.ts` | Redimensionado, compresión y miniaturas |
| `src/pages/api/days.ts` | Lectura y subida por lotes de días |
| `src/pages/api/images.ts` | Una imagen por petición; recorte de cola |
| `src/pages/api/health.ts` | ¿Alcanza la función desplegada a Atlas? |
| `src/components/SyncBadge.tsx` | «Al día» / «Guardando…» / «N sin subir» |

### Colecciones

| Colección | Contenido | Índice |
|---|---|---|
| `user` `session` `account` | Las crea Better Auth. Tu nombre vive en `user` | propios |
| `days` | Un día por usuario: marca, nota, color, `imageCount`, `thumb`, `reminder` | `{userId, key}` único |
| `images` | Una imagen por documento, con su posición. Hoy guarda la imagen entera como data URL; la tanda 7 deja aquí solo la referencia a Cloudinary | `{userId, key, index}` único |

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

Las que traen las tandas 6 y 7, todas de servidor y todas `secret`:

| Variable | Nota |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | El nombre de la nube, a secas |
| `CLOUDINARY_API_KEY` | Pública en la práctica, pero no hace falta que salga del servidor |
| `CLOUDINARY_API_SECRET` | Firma las URLs y las subidas. **Nunca al navegador** |
| `TELEGRAM_BOT_TOKEN` | El bot es de la aplicación, no de cada persona |
| `CRON_SECRET` | Cabecera que autoriza `POST /api/cron/reminders` |

La *API Environment Variable* de Cloudinary (`CLOUDINARY_URL`) **no se usa**: el
SDK la lee de `process.env` por su cuenta y en `astro dev` las variables del
`.env` no están ahí. Es la trampa que ya nos mordió con `BETTER_AUTH_URL`, y la
salida es la misma: declarar las tres piezas en `astro:env` y configurarlas a
mano. Ver *Trampas que ya nos han mordido*.

---

## Historial

### Migración de localStorage a MongoDB — septiembre de 2026

#### 1 · Servidor y conexión — `af32cfc`

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

#### 2 · Login — `af32cfc`

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

#### 3 · Sincronía de los días — `af32cfc`

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

#### 4 · Imágenes en su propia colección — `03b92ff`

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

#### 5 · Puesta en producción — `943751b`, `0cedf42`

Dos fallos que solo aparecían desplegados, ambos por la misma variable mal
escrita. Están contados en **Trampas que ya nos han mordido**, que es donde hay
que mirar antes de volver a pelearse con un 500 que en local no se reproduce.

De paso, `/api/health` dejó de depender del middleware y ahora informa también
del origen con el que se configuró la sesión, para poder comprobarlo desde
fuera sin entrar en el panel de Vercel.

### Recordatorios — septiembre de 2026

#### 6 · Modelo e interfaz — `ad97a65`

El aviso vive dentro del `DayEntry`, como la nota o el color: un día tiene como
mucho uno, borrar el día se lo lleva y la sincronía ya sabía mover días.

`reminder.ts` no importa nada del proyecto y no toca `window`. Lo necesitan los
dos lados —el navegador para editar, el cron para decidir qué manda— y la regla
de en qué punto está un aviso (`reminderState`) vive una sola vez, así que la
interfaz y el envío no pueden discrepar.

Se guarda `at` en milisegundos **además** de la hora local. Ninguno de los dos
se deduce del otro sin saber la zona horaria de quien escribió: el cron corre en
UTC y las claves del calendario son fechas locales. Al saneado se le pasa la
clave del día para deducir `at` cuando falta —datos de antes de esta tanda—,
pero **nunca se recalcula** si viene: el dispositivo que lee puede estar en otra
zona y reescribirlo movería el aviso.

`makeReminder` es el único sitio donde se construye uno, y por eso es el único
donde hay que acordarse de las dos reglas que se olvidan solas: recalcular `at`
con la hora nueva, y **soltar `sent` en cuanto cambia la hora o el texto**. Sin
lo segundo, mover un aviso ya enviado lo dejaría marcado como hecho para
siempre.

`hasContent` cuenta el recordatorio, y la misma condición está repetida en
`sanitizeData` al leer. Sin las dos, un día que solo lleva una hora se lee como
vacío: `handleSave` lo borra al guardar, o `loadData` lo tira al recargar.

Dos fallos que salieron al montarlo, ambos del mismo tipo —un campo que
desaparece no es lo mismo que un campo que no viaja—:

- `sameDay` en `sync.ts` no miraba el aviso, así que poner una hora y no tocar
  nada más no encolaba nada y el cambio no salía jamás de este navegador.
- `$set` en `POST /api/days` no borra lo que no le mandas. Apagar el aviso en el
  portátil dejaba el suyo intacto en Mongo y el móvil se lo bajaba de vuelta en
  la siguiente lectura. Ahora los opcionales ausentes se quitan con `$unset`, y
  eso arregla de paso la miniatura huérfana de un día al que se le quitaron
  todas las imágenes.

La alarma del `.ics` se ancla a un instante absoluto (`TRIGGER;VALUE=DATE-TIME`)
y no a un desfase desde `DTSTART`: el evento es de día completo y cada
calendario decide por su cuenta a qué hora empieza uno.

La interfaz avisa de que el envío todavía no existe. Prometer un mensaje que no
va a llegar es peor que no ofrecerlo.

---

## Lo que falta

### Tanda 6 · El envío por Telegram

El modelo ya está puesto: `dueReminders(data, now)` devuelve lo que toca mandar
y `GRACE_MS` es la ventana de gracia. Lo que falta es el canal y el disparador.

- [ ] `src/lib/telegram.ts`: `sendMessage(chatId, text)` contra
      `https://api.telegram.org/bot<token>/sendMessage`. El token sale del
      entorno, nunca de la base.
- [ ] `chatId` por usuario en una colección `settings`, **no en el navegador**:
      es el destino de una alerta, no una preferencia de este dispositivo.
- [ ] `POST /api/cron/reminders` con cabecera secreta (`CRON_SECRET`).
- [x] Ventana de gracia. Sin un tope, volver tras tres días dispara diez
      mensajes de golpe. Son 2 h (`GRACE_MS`), y lo que pasa de ahí ya se marca
      como perdido y se enseña en la agenda.
- [ ] Marcar `sent` al recibir `ok: true`, y que eso vuelva al navegador: hoy
      el campo existe y lo pinta la agenda, pero no lo escribe nadie.
- [ ] Programador externo apuntando al endpoint.
- [ ] Botón **Probar** en `SettingsModal`: manda un mensaje ahora y enseña lo
      que contestó Telegram. Descubrir que el `chatId` está mal a las 9:00 de
      un martes es tarde.

**Vercel Hobby no sirve como cron:** solo admite uno al día, y aun así se
dispara en cualquier momento dentro de la hora indicada. Alternativas gratis:
cron-job.org (precisión de minutos), GitHub Actions (retrasos de 5–20 min, pero
ahora vale porque los datos ya no están en el repo) o un Worker de Cloudflare de
cinco líneas que solo hace ping.

Canal elegido: **un bot de Telegram**. WhatsApp queda descartado por los dos
lados: CallMeBot es un tercero sin compromiso ninguno por el que pasarían los
recordatorios, y la Meta Cloud API exige plantilla aprobada y tarifa por mensaje
porque un recordatorio lo inicia el negocio. La API de bots de Telegram es
oficial, gratuita, sin plantillas y es un `POST`. Se mantiene lo que ya movía la
decisión anterior: desde el servidor no hay problema de CORS y la respuesta se
lee entera —trae `ok` y, si falla, `description`—, así que «enviado» será verdad
y no un acto de fe.

Tres cosas de la API que conviene tener presentes antes de escribir el envío:

- **Un bot no puede escribir primero.** Hasta que la persona no abre el chat y
  pulsa *Start*, cualquier `sendMessage` devuelve `403`. Por eso el `chatId` es
  un prerrequisito y no algo que la aplicación pueda averiguar sola.
- **El texto de la nota es texto de usuario.** Con `parse_mode` de Markdown, un
  guion bajo suelto en la nota tumba el envío con un `400`. Se manda **sin
  `parse_mode`** salvo que haga falta formato, y entonces se escapa. El tope es
  de 4096 caracteres por mensaje: la nota se recorta.
- **Los fallos no son todos iguales.** `429` trae `parameters.retry_after` y
  toca esperar; `403` significa que el bot está bloqueado o el chat ya no
  existe, y ahí reintentar no arregla nada — se marca y se enseña en la agenda.

El recordatorio solo se marca como `sent` cuando la respuesta trae `ok: true`.
Guardar también el `message_id` sale gratis y permite editar o borrar el aviso
más adelante.

#### Lo que necesito de tu lado

| Dato | Cómo se obtiene | Dónde va |
|---|---|---|
| **Bot Token** | @BotFather → `/newbot` → un nombre y un usuario que acabe en `bot`. Devuelve algo como `123456789:AAF…` | `TELEGRAM_BOT_TOKEN`, en `.env` y en Vercel |
| **Chat ID** | Abre el chat con tu bot y pulsa **Start**. Luego `https://api.telegram.org/bot<TOKEN>/getUpdates` y lee `result[0].message.chat.id`. @userinfobot también lo dice | `settings.telegram.chatId`, por usuario |
| **Usuario del bot** | El `@algo_bot` que te dé BotFather | Solo para el enlace del botón «Conectar» |
| **Secreto del cron** | Lo eliges tú: `openssl rand -hex 32` | `CRON_SECRET`, en Vercel y en el programador |

Y una decisión: si las alertas van a tu chat privado o a un grupo. En un grupo
hay que añadir el bot y el id es negativo (`-100…`); el modo privacidad que
traen por defecto da igual aquí, porque el bot solo escribe.

El token es la llave entera del bot. Si acaba en un commit hay que revocarlo con
`/revoke` en BotFather, no basta con borrarlo del archivo.

Cuando canse copiar el `chatId` a mano: el botón «Conectar» abre
`https://t.me/<bot>?start=<código>`, un webhook en `POST /api/telegram/webhook`
—protegido con el `secret_token` que admite `setWebhook`— recibe ese `/start` y
ata el chat al usuario él solo. Para una aplicación personal no compensa
todavía, pero es el camino si algún día la usa alguien más.

### Tanda 7 · Multimedia en Cloudinary

La tanda 4 sacó las imágenes del documento del día, pero los bytes siguen en
Atlas y una copia completa sigue en `localStorage`. Eso deja tres techos a la
vez: la cuota del navegador, el tope de 4,5 MB del cuerpo de una función y la
miniatura en base64 que baja con cada día. Cloudinary se queda con los bytes;
Mongo, con la referencia y el orden.

**Lo que no cambia:** el día sigue llevando solo la cuenta y una miniatura, las
imágenes se siguen pidiendo bajo demanda, y la cola de subida de `sync.ts` sigue
mandando una imagen por petición. Esto es un cambio de almacén, no de
arquitectura.

#### Dónde vive cada imagen

El `public_id` se compone en el servidor y es determinista:

```
uploads/users/{userId}/{key}/{index}
        └── ObjectId de la sesión, nunca lo que venga en el cuerpo
```

La carpeta **no es la frontera de seguridad** —eso lo hace la firma, más abajo—,
pero se gana lo suyo igualmente: borrar todo lo de una persona es borrar un
prefijo, y el panel de Cloudinary se puede leer. Que el `public_id` sea
determinista quita además el paso de «guardar qué id me devolvió»: la posición
del adjunto ya lo dice.

- [ ] `userId` siempre desde `locals.user`, jamás desde el cuerpo de la
      petición. Es la misma regla que ya siguen `days.ts` e `images.ts`.
- [ ] `overwrite: true` al subir: reemplazar el adjunto 2 de un día es escribir
      en el mismo sitio, y así no quedan dos versiones vivas.

#### Que nadie la vea sin sesión

- [ ] Subir todo con **`type: 'authenticated'`**. Es lo que hay que usar aquí y
      no `private`: con `private` solo el original queda protegido y las
      derivadas se sirven públicamente, que es justo el agujero por el que se
      vería una miniatura sin haber entrado nunca.
- [ ] **Las imágenes se sirven por proxy**, no con una URL de Cloudinary en el
      navegador: `GET /api/images/raw?key=…&i=N&size=thumb|view` valida la
      sesión, comprueba que ese día es de quien pregunta, firma la URL en el
      servidor, trae los bytes y los devuelve. La URL firmada no sale nunca de
      la función.
- [ ] `Cache-Control: private, max-age=31536000, immutable` en la respuesta del
      proxy. El `public_id` lleva la `version` pegada, así que una imagen
      cambiada es otra URL: se puede cachear para siempre sin miedo, y sin eso
      cada pintada de la galería sería una invocación.

Por qué proxy y no una URL firmada directa al CDN, que sería más barata: **una
URL firmada de Cloudinary no caduca**. Para que caduque hace falta
autenticación por token (`auth_token` con `duration`), y eso es plan *Advanced*
o superior. Con una firma perpetua, una URL que se escape por un historial, un
registro o un *Copiar dirección de la imagen* vale para siempre y para
cualquiera — que es exactamente lo que no queremos. El proxy cumple el
requisito sin depender del plan: sin cookie de sesión no hay bytes, punto.

- [ ] Con `type: 'authenticated'` **no hay transformaciones al vuelo**. Las dos
      medidas se piden **eager** al subir: 192 para la miniatura y 1280 para la
      vista, las mismas que hoy calcula `image.ts` en el navegador.
- [ ] El proxy acepta `size=thumb|view` y **nada más**. Admitir una cadena de
      transformación del cliente convierte esto en un proxy de transformaciones
      abierto, y las transformaciones son lo que gasta créditos.

Si algún día hay plan con token: el proxy se puede sustituir por un
`GET /api/images/urls?key=…` que devuelva URLs firmadas de diez minutos y deje
que el CDN sirva los bytes. El contrato del cliente apenas cambia; por eso
conviene que lo que se pinte salga de una función `srcOf(ref, size)` y no de una
cadena repartida por los componentes.

#### Qué se toca

| Archivo | Cambio |
|---|---|
| `src/lib/cloudinary.ts` | **Nuevo.** `cloudinary.config()` explícito con las tres variables de `astro:env`. Firma, sube, borra |
| `src/lib/image.ts` | Se queda: redimensionar y comprimir antes de subir sigue siendo lo que mantiene cada archivo pequeño |
| `src/pages/api/images.ts` | `PUT` sube a Cloudinary y guarda la referencia; `GET` devuelve referencias; `DELETE` borra también allí |
| `src/pages/api/images/raw.ts` | **Nuevo.** El proxy |
| `src/lib/sync.ts` | Casi nada: el cable de `PUT` no cambia (ver abajo) |
| `src/lib/wire.ts` | `thumb` deja de ser base64 |
| `src/lib/gallery.ts`, `GalleryView.tsx`, `Lightbox.tsx`, `DayModal.tsx` | `src` sale de `srcOf(ref, size)` en vez de ser la data URL |
| `src/lib/transfer.ts` | La exportación deja de llevar las imágenes dentro (ver *Lo que se pierde*) |

- [ ] **`PUT /api/images` mantiene su contrato**: sigue recibiendo
      `{ key, index, dataUrl, updatedAt }`. El cargador de Cloudinary acepta una
      data URI tal cual, así que el cambio se queda entero del lado del
      servidor y `flushImages()` no se entera. Cada archivo ya llega por debajo
      de los 700 KB, muy lejos del tope del cuerpo de la función.
- [ ] La colección `images` pasa a ser metadatos:
      `{ userId, key, index, publicId, version, format, bytes, width, height, updatedAt }`.
      El índice único `{userId, key, index}` sigue valiendo, y el recorte de
      cola con `from` también.
- [ ] `days.thumb` deja de guardar base64. La miniatura es la derivada eager de
      la primera imagen, así que el día solo necesita saber que existe. **Esto
      retira la deuda de los ~1,8 MB por carga.**
- [ ] `DayEntry.images` admite dos formas en el mismo array: una data URL
      mientras el adjunto está sin subir, y `cld:{publicId}@{version}` una vez
      confirmado. Se mantienen `sameImages`, el orden, la cola e `imagesReady`
      sin tocarlos, y quien pinta resuelve cuál es cuál.
- [ ] `isImageDataUrl` sigue guardando la puerta de subida —solo se acepta lo
      que el navegador podría haber generado—, pero hace falta un `isImageRef`
      aparte para lo que baja: hoy el saneado del cliente rechazaría una
      referencia por no ser una data URL.
- [ ] Borrar un adjunto tiene que borrar también en Cloudinary: `destroy` con
      `type: 'authenticated'` e `invalidate: true`. Y la lápida de un día
      arrastra los suyos; si no, el almacén crece con imágenes de días que ya no
      existen.

#### Las credenciales

Ya las tienes: *Cloud Name*, *API Key*, *API Secret* y la *API Environment
Variable*. No hace falta pedirte nada más para esta tanda.

Van en `.env` en local y en el panel de Vercel en producción, como las demás. Se
declaran **por separado** en el esquema de `astro:env` y se pasan a
`cloudinary.config()` a mano: la *API Environment Variable* (`CLOUDINARY_URL`)
funciona sola en producción y **no** en `astro dev`, porque el SDK la busca en
`process.env` y ahí no llega el `.env`. Esa asimetría es la que costó dos
despliegues con `BETTER_AUTH_URL`.

La *API Secret* no se declara nunca con `access: 'public'`. En este diseño no
hay subida desde el navegador, así que tampoco hace falta un *upload preset* sin
firmar — que es la otra forma habitual de dejar una nube abierta de par en par.

#### Lo que se pierde

Hoy las imágenes están en `localStorage` y se ven sin conexión. Con Cloudinary,
un dispositivo que no las haya abierto nunca no las tiene. La caché del proxy
mantiene visible lo ya visto, pero es una caché, no una garantía: **el
local-first se conserva para las notas y deja de valer para las imágenes.** Es
el precio de quitar los tres techos, y conviene tenerlo escrito antes de
descubrirlo en un avión.

A cambio, `MAX_DATA_URL_LENGTH` deja de estar atado a la cuota de
`localStorage`, y la exportación de `transfer.ts` deja de arrastrar megas de
base64 — pero también deja de ser una copia completa. Si se quiere que lo siga
siendo, exportar tiene que bajar las imágenes por el proxy primero.

#### Migrar lo que ya hay

- [ ] Un script suelto, **idempotente y reanudable**: por cada documento de
      `images`, subir su `dataUrl`, escribir `publicId` y `version`, y solo
      entonces quitar el `dataUrl`. Si se corta a la mitad, un documento que ya
      tenga `publicId` se salta.
- [ ] Correrlo desde el portátil contra Atlas con las credenciales de
      producción, no desde una función: no hay prisa y no hay límite de tiempo.
- [ ] Contar imágenes por usuario antes y después, y comparar. Es la única
      comprobación que importa.
- [ ] Regenerar las miniaturas de `days` como derivadas y vaciar el base64 en
      la misma pasada.

#### Riesgos

- El plan gratuito va por créditos, y el proxy hace que el tráfico pase dos
  veces: Cloudinary → función → navegador. La caché `immutable` es lo que
  mantiene eso en una vez por imagen y dispositivo; sin ella, cada visita a la
  galería lo paga entero.
- Un `destroy` que falle deja un huérfano que nadie mira y que sigue ocupando.
  Anotado en la deuda.

### Despliegue

`GET /api/health` es el primer sitio al que mirar: dice si la función alcanza
Atlas y con qué origen se configuró la sesión. No depende del middleware ni de
que la sesión sea válida, precisamente para seguir contestando cuando lo demás
no lo hace.

Ya resuelto, y anotado para cuando haya que montarlo otra vez:

- [x] Las tres variables en el panel de Vercel. `BETTER_AUTH_SECRET` conviene
      que sea **distinta** de la local; hoy es la misma.
- [x] `BETTER_AUTH_URL` **con `https://` delante**. Sin esquema lanza por dos
      sitios distintos —el servidor y el cliente— y ambos están cubiertos por
      código, pero la variable debe estar bien puesta igualmente.
- [x] *Network Access* de Atlas en `0.0.0.0/0`. Con la IP propia en lista
      blanca las funciones de Vercel no entran, y el síntoma despista: Atlas
      corta el saludo TLS y el driver lo reporta como `tlsv1 alert internal
      error`, que no se parece en nada a un problema de permisos.

Pendiente:

- [ ] `trustedOrigins` en `auth.ts` si se usan despliegues de vista previa: su
      URL no coincide con `BETTER_AUTH_URL` y el login devuelve `403`.
- [ ] Campo `engines` en `package.json`: local es Node 26, Vercel usa la 24.
- [ ] Las tres variables de Cloudinary y el `TELEGRAM_BOT_TOKEN` en el panel,
      cuando lleguen sus tandas. Hay que reiniciar `astro dev` después de
      declararlas en `astro.config.mjs`, o llegarán vacías.
- [ ] El programador externo necesita el `CRON_SECRET` y la URL del endpoint.
      Conviene comprobar que sin la cabecera contesta `401` **antes** de
      dejarlo corriendo.

### Deuda conocida

- [ ] Las miniaturas viajan dentro de `GET /api/days`. La actual pesa 5 KB y el
      tope son 20 KB: un año con imagen todos los días serían ~1,8 MB por carga.
      Irreal para uso personal, pero si se acerca, basta bajar `THUMB_SIDE` de
      192 a 128 o servirlas aparte. **La tanda 7 lo retira**: la miniatura pasa
      a ser una derivada y deja de viajar.
- [ ] Cambiar un adjunto reenvía los seis del día. Con seis como tope y
      ediciones contadas, comparar cuáles cambiaron costaría más de lo que
      ahorra — pero está ahí.
- [ ] Las lápidas no se purgan nunca. Sobra sitio, pero crecen sin fin.
- [ ] `localStorage` sigue guardando la copia completa con imágenes, así que su
      cuota sigue siendo un techo. `MAX_DATA_URL_LENGTH` (700 KB) se dimensionó
      para esa cuota y ahora podría subir. **La tanda 7 lo retira**, a cambio de
      que las imágenes dejen de verse sin conexión.
- [ ] No hay recuperación de contraseña: haría falta un servidor de correo.
- [ ] `IMAGE_ACTION` en `DayModal.tsx` no se usa. Anterior a esta sesión.
- [ ] El borrador del modal se reinicia si el día cambia de identidad mientras
      está abierto —que es lo que pasa cuando llegan sus imágenes—. Afecta por
      igual a la nota, al color y ahora al recordatorio; es anterior a esta
      tanda y se arregla comparando valores en vez de reaccionar al objeto.
- [ ] La galería descarga en serie todas las imágenes que falten, sin límite ni
      desalojo. Con muchas notas conviene paginar. La tanda 7 lo alivia —el
      navegador cachea lo servido por el proxy y ya no hay que guardarlo— pero
      no lo arregla: sigue faltando paginar.
- [ ] *(tanda 7)* Un `destroy` que falle deja la imagen huérfana en Cloudinary.
      Haría falta un repaso que liste el prefijo `uploads/users/{userId}` y
      borre lo que no tenga documento en Mongo.
- [ ] *(tanda 7)* La exportación de `transfer.ts` deja de ser una copia
      completa: para que lo siga siendo hay que bajar las imágenes al exportar.
- [ ] *(tanda 6)* El `chatId` se copia a mano. El enlace `?start=<código>` con
      webhook lo automatiza cuando compense.

---

## Trampas que ya nos han mordido

**`import.meta.env` no es `process.env`.** En `astro dev` las variables del
`.env` llegan a `import.meta.env`, pero **no** a `process.env`. En Vercel están
en `process.env`. Cualquier dependencia que lea `process.env` por su cuenta se
comporta distinto en local y en producción, y no hay forma de verlo sin
reproducirlo a mano.

Eso fue exactamente lo que pasó con `BETTER_AUTH_URL` sin esquema: en local no
fallaba nada, y en producción `/`, `/login` y `/galeria` devolvían 500 mientras
las APIs funcionaban. La causa era `createAuthClient()`, que lanza al
construirse si lee una URL sin esquema; `auth-client.ts` lo construye al
importarse y lo importan NavBar y LoginForm, así que el renderizado de todas
las páginas se caía. Las rutas de API no importan ese módulo, y por eso seguían
respondiendo — que es lo que hacía el fallo tan desconcertante.

Ahora el cliente recibe su origen explícito y ya no depende del entorno.
Para reproducir algo así en local: compilar con `@astrojs/node`, arrancar
`dist/server/entry.mjs` y poner la variable en `process.env` a mano.

**Tocar `astro.config.mjs` obliga a reiniciar el servidor.** El esquema de
`astro:env` se lee al arrancar; sin reinicio las variables llegan vacías.

**El aviso de npm sobre `esbuild` al desplegar no rompe nada.** npm 11.6+ pide
autorizar los `postinstall`; está concedido en `allowScripts` de
`package.json`, sin anclar a versión para que no vuelva a preguntar en cada
actualización. Si aparece de nuevo con otro paquete:
`npm approve-scripts <pkg> --no-allow-scripts-pin`.

## Trabajar en el proyecto

```bash
npm run dev                  # servidor de desarrollo
npx astro check              # tipos
npx astro build              # build de producción
curl localhost:4321/api/health   # ¿responde Atlas?
```

Reproducir un fallo que solo aparece desplegado:

```bash
npm i @astrojs/node --no-save
sed -e "s|import vercel from '@astrojs/vercel';|import node from '@astrojs/node';|" \
    -e 's|adapter: vercel(),|adapter: node({ mode: "standalone" }),|' \
    astro.config.mjs > astro.config.node.mjs
npx astro build --config astro.config.node.mjs
BETTER_AUTH_URL="lo-que-haya-en-vercel" PORT=4403 node --env-file=.env ./dist/server/entry.mjs
rm astro.config.node.mjs   # al terminar
```

Hay que sustituir también el `import`, no solo la llamada. Y la variable va
**delante** del comando: `--env-file` no pisa lo que ya venga del shell, que es
justo lo que aquí interesa.

claude --resume f1245293-0ffd-4582-ac35-4024aa8d6dc5