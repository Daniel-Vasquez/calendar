# Planificador 2026

Calendario anual —2026 y 2027, un año a la vista— con notas, colores, imágenes
adjuntas y recordatorios diarios por Telegram. Astro + React, MongoDB Atlas y
Cloudinary para los adjuntos, desplegado en Vercel.

**En producción:** <https://planificador.danielvasquez.lat>
· estado: <https://planificador.danielvasquez.lat/api/health>

Este archivo es el mapa del proyecto y la lista de lo que falta. El *por qué* de
cada decisión está en los comentarios del código; aquí va lo que no cabe en un
comentario. Lo que hace falta para **arrancarlo** —qué es, qué hace y cómo se
levanta— está en el `README.md`, que es la puerta para quien llega de fuera;
este archivo da por sabido todo eso.

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
| `src/lib/calendar.ts` | Los años cubiertos, la rejilla de cada mes y las claves `YYYY-MM-DD` |
| `src/lib/collapse.ts` | Qué meses están plegados, por año y mes |
| `src/components/YearTabs.tsx` | El conmutador de año de la cabecera del calendario |
| `src/lib/reminder.ts` | Identidad, hora, texto y estado del aviso; lo importan los dos lados |
| `src/lib/reminders.ts` | La lista: recoger, ordenar, filtrar y escribir avisos |
| `src/components/useCalendarStore.ts` | El calendario y su sincronía, para toda página que escriba |
| `src/pages/recordatorios.astro` | La lista de recordatorios |
| `src/pages/agenda.astro` | La agenda del año y las cuentas del calendario |
| `src/lib/theme.ts` | Claro u oscuro: dónde se guarda y quién manda |
| `src/lib/palette.ts` | Los ocho colores, la paleta propia de cada persona y su variable CSS |
| `src/lib/tags.ts` | El catálogo de etiquetas, el `slug` y lo que lleva puesto un día |
| `src/lib/prefs.ts` | Lleva la paleta y el catálogo a la cuenta, y decide quién manda |
| `src/components/usePalette.ts` | Lee, guarda, aplica y vigila la paleta; lo usa toda página que pinte |
| `src/components/usePrefs.ts` | Compone la paleta y el catálogo, y los sincroniza con la cuenta |
| `src/components/useSettings.ts` | Los ajustes enteros —paleta, etiquetas, entrada y salida— para la barra |
| `src/components/NoticeBar.tsx` | El aviso del pie y su deshacer, uno para las cuatro páginas |
| `src/components/ThemeToggle.tsx` | El sol y la luna de la barra |
| `src/lib/telegram.ts` | El bot: enviar, leer `getUpdates`, clasificar fallos |
| `src/pages/api/telegram.ts` | Vincular, comprobar, probar y desvincular |
| `src/pages/api/settings.ts` | La paleta y el catálogo de etiquetas de la cuenta |
| `src/pages/api/cron/reminders.ts` | Lo dispara el programador externo |
| `src/lib/image.ts` | Redimensionado y compresión antes de subir; y de qué `src` sale cada imagen |
| `src/lib/cloudinary.ts` | El almacén de los bytes: sube, renombra, borra y firma. Solo servidor |
| `src/lib/gallery.ts` | Reúne las imágenes del año y da la vista previa de un día |
| `src/pages/api/days.ts` | Lectura y subida por lotes de días |
| `src/pages/api/images.ts` | Una imagen por petición; recorte de cola |
| `src/pages/api/images/raw.ts` | El proxy: valida la sesión, firma y sirve los bytes |
| `scripts/migrate-images.mjs` | Llevó a Cloudinary los adjuntos que estaban en Mongo |
| `scripts/migrate-image-folders.mjs` | Movió los adjuntos a `{CLOUDINARY_FOLDER}/{userId}/…` y reescribió sus `publicId` |
| `scripts/migrate-reminders.mjs` | Convirtió el aviso único de cada día en la lista de la tanda 9 |
| `src/pages/api/health.ts` | ¿Alcanza la función desplegada a Atlas? |
| `src/components/SyncBadge.tsx` | «Al día» / «Guardando…» / «N sin subir» |
| `src/components/Fold.tsx` | Una sección plegable de los ajustes; quién está abierta lo decide el panel |
| `src/components/Legend.tsx` | Qué significa cada marca del calendario, al fondo de los ajustes |

### Colecciones

| Colección | Contenido | Índice |
|---|---|---|
| `user` `session` `account` | Las crea Better Auth. Tu nombre vive en `user` | propios |
| `days` | Un día por usuario: marca, nota, color, `imageCount`, `thumb` —el testigo de la primera imagen, no la imagen—, `reminders` —una lista, hasta diez—, `removedReminders` —sus lápidas—, `tags` | `{userId, key}` único + parcial multiclave sobre `reminders.at` |
| `settings` | Lo que es de la persona y no del aparato: el chat de Telegram, la paleta y el catálogo de etiquetas | `{userId}` único |
| `allowlist` | Qué correos pueden **crearse** una cuenta. No afecta a quien ya la tiene | `{email}` único |
| `images` | Una imagen por documento, con su posición. **Aquí no hay bytes**: solo el `publicId`, la `version` y el `etag` de lo que guarda Cloudinary | `{userId, key, index}` único |

`userId` se guarda como **ObjectId**, no como cadena.

Los meses plegados **no** suben: son preferencia de este dispositivo y se
quedan en `localStorage`. La paleta y el **catálogo** de etiquetas sí, desde la
tanda 11: son de la persona, no del aparato. Lo que un día lleva puesto viaja
aparte, dentro del día, porque es del día.

### Más de una persona

El bot de Telegram es **uno, de la aplicación**, no uno por usuario. El token
vive en el entorno del servidor, igual que la URI de Mongo, y nunca sale de él.

Así que **alguien nuevo no crea ningún bot ni consigue ningún token**: entra en
Ajustes, abre el chat del bot, pulsa *Start* y vuelve a pulsar *Comprobar*. Lo
único suyo es el `chatId`, que queda en `settings`, una fila por persona.

El resto ya era multiusuario desde la tanda 2: `userId` sale siempre de la
sesión y nunca del cuerpo de una petición, así que cada quien ve sus días y
recibe sus avisos. El cron recorre los recordatorios de todo el mundo, los
agrupa por usuario y manda a cada chat lo que le toca.

**El registro está cerrado con lista de invitados.** Solo puede crearse una
cuenta quien esté en la colección `allowlist`; el resto recibe un «Este correo
no tiene invitación» en el propio formulario. La lista se gestiona con
`scripts/allowlist.mjs` — ver *Trabajar en el proyecto*.

La comprobación vive en el gancho `databaseHooks.user.create.before` de
`auth.ts`, y no en el formulario, a propósito: así cubre cualquier vía de alta
que se añada después sin que nadie tenga que acordarse de repetirla. Y **solo
mira a quien se da de alta**: quien ya tiene cuenta entra aunque no esté en la
lista, porque el gancho es de creación y no de entrada.

Si la base no contesta, el alta se rechaza en vez de dejar pasar: ante la duda
no se abre la puerta.

Una sola cosa queda en *Deuda conocida*: la vinculación de Telegram no aguanta
a mucha gente vinculando el mismo día.

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

**Los recordatorios son la excepción, desde la tanda 10.** Se funden uno a uno
por su `id`, cada uno con su propia marca (`editedAt`), así que dos dispositivos
que tocan avisos distintos del mismo día conservan los dos cambios. El resto del
día —nota, color, marca, adjuntos— se sigue arbitrando en bloque a propósito:
son campos de una misma edición, y mezclarlos daría un día que nadie escribió.

Un aviso borrado deja también su lápida (`removedReminders`), por lo mismo que
la deja un día, y estas sí se podan: noventa días, veinte por día.

La marca de un día **nunca retrocede**. Es sutil y cuesta un fallo entenderlo:
ver *Trampas que ya nos han mordido*.

### Variables de entorno

`.env` en local (ignorado por git), panel de Vercel en producción. Ver
`.env.example`.

| Variable | Nota |
|---|---|
| `MONGODB_URI` | Si la ruta trae nombre de base, manda esa |
| `MONGODB_DB` | Opcional. Manda sobre la anterior |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. **Distinta en producción** |
| `BETTER_AUTH_URL` | Origen público **con esquema** y sin barra final |

#### Si algún día cambia el dominio

`BETTER_AUTH_URL` es la única variable atada al dominio, y no se toca nunca
salvo por esto. Pero no va sola: el dominio está escrito en dos sitios más que
**dejan de funcionar** si se queda el viejo, y en ninguno de los dos se nota
enseguida.

1. **`BETTER_AUTH_URL` en Vercel, y redesplegar.** Editar la variable no la
   mete en la función que ya corre. Con el origen viejo, Better Auth construye
   sus rutas contra un dominio que ya no es el del sitio y el login empieza a
   devolver `403`.
2. **El dominio nuevo en Vercel**, evidentemente, y con el viejo redirigiendo
   mientras haya enlaces por ahí.
3. **El programador del cron.** `.github/workflows/recordatorios.yml` cae en
   `https://planificador.danielvasquez.lat` cuando no hay nada configurado, así
   que seguiría llamando al dominio viejo y **dejarían de salir los avisos**.
   No hace falta tocar el archivo: basta una variable de repositorio
   `PLANIFICADOR_URL` en *Settings → Secrets and variables → Actions*. El fallo
   aparece en la pestaña Actions, no en el sitio, así que es el que más tarda
   en descubrirse.

Lo demás que menciona el dominio —las cabeceras de este archivo y del `README`,
los ejemplos de `curl`— es documentación: queda desfasada, no rota.

Y si además se usan despliegues de vista previa, su URL tampoco coincidirá con
`BETTER_AUTH_URL`: eso es `trustedOrigins`, anotado en *Lo que falta*.

Las de los recordatorios son **opcionales**, al revés que las de arriba: sin
ellas el calendario funciona entero y solo deja de haber avisos. Obligatorias
tumbarían el sitio por una función accesoria.

| Variable | Nota |
|---|---|
| `TELEGRAM_BOT_TOKEN` | El bot es de la aplicación, no de cada persona. **Nunca a Mongo** |
| `TELEGRAM_BOT_USERNAME` | El `@algo_bot`. No es secreto: va dentro del enlace |
| `CRON_SECRET` | Cabecera que autoriza `POST /api/cron/reminders` |

Las de Cloudinary son **obligatorias** como las primeras, no opcionales como
las de Telegram: sin ellas no se puede ni guardar un adjunto ni enseñar uno ya
guardado. Todas de servidor y todas `secret`:

| Variable | Nota |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | El nombre de la nube, a secas |
| `CLOUDINARY_API_KEY` | Pública en la práctica, pero no hace falta que salga del servidor |
| `CLOUDINARY_API_SECRET` | Firma las URLs y las subidas. **Nunca al navegador** |
| `CLOUDINARY_FOLDER` | Opcional. Carpeta raíz de los adjuntos; sin ella, `planificador` |

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
*(La tanda 8 se quedó con el momento y cambió el contenido: donde había un
base64 hay ahora el testigo de una derivada.)*

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

La interfaz avisaba de que el envío todavía no existía. Prometer un mensaje que
no va a llegar es peor que no ofrecerlo — pero ese texto **sobrevivió a la tanda
siguiente**, que es la que lo hizo mentira, y se quedó diciendo «el envío llega
en la próxima tanda» con el envío ya funcionando. Lo quitó `2d60a98`, que puso
en su lugar algo que sí aporta: un aviso cuando no hay Telegram conectado, que
es el caso en que el recordatorio se guarda y no llega a ninguna parte.

#### 7 · El envío por Telegram — `8ebb04e`

El bot es **uno, de la aplicación**, no uno por persona. Eso decide dónde vive
cada cosa y es lo que más se malinterpreta al montarlo: el token es
configuración de despliegue, como `MONGODB_URI`, y no un ajuste que nadie
teclee en una pantalla. Nunca va a Mongo — una filtración de la base no debe
ser también una del bot— ni baja al navegador.

Lo único de cada persona es el `chatId`, y vive en una colección `settings`.

**Nadie tiene que copiar su «chat ID».** Averiguarlo pasa por `getUpdates`, que
exige el token; enseñárselo a un usuario para que se configure es justo lo que
no puede ser. En su lugar el servidor entrega un enlace `t.me/<bot>?start=<código>`,
la persona pulsa Start y vuelve a pulsar *Comprobar*: el `/start <código>`
aparece en `getUpdates` y ata el chat a quien abrió **ese** enlace, no a quien
diga ser. Se descartó el webhook porque obliga a una URL pública y en local no
hay forma de probarlo sin un túnel.

El `offset` de `getUpdates` **no se avanza**: confirmarlos los borra de la cola
de Telegram, y dos personas vinculando a la vez se pisarían. Telegram los tira
solo a las 24 h. A cambio, el bot no puede tener webhook puesto: con uno,
`getUpdates` contesta 409.

El envío **reclama antes de mandar**. El filtro exige que `sent` siga sin
existir, así que dos pasadas solapadas no pueden llevarse el mismo aviso; si el
envío falla, se suelta la reclamación y la pasada siguiente lo reintenta
mientras siga dentro de la ventana. Al revés —mandar y marcar después— la misma
persona podría recibirlo dos veces.

Lo más delicado: **el cron no toca `updatedAt` al marcar `sent`**. Subirlo
haría que el servidor le ganara a una edición local que aún no hubiera subido,
borrándola. Pero entonces el día vuelve con la marca de siempre y la fusión lo
descartaría con el `sent` dentro, así que `pull()` adopta ese campo aparte: lo
escribe solo el servidor, no puede entrar en conflicto con nada de aquí, y se
compara `at` porque un aviso movido de hora es otro aviso.

Dos trampas que costaron rato y están contadas en **Trampas que ya nos han
mordido**: el `content-type` que exige la protección CSRF de Astro, y una
comilla sin cerrar en el `.env` que hizo que el error señalara a la variable
equivocada.

Comprobado de punta a punta contra Atlas: el cron encontró un aviso pendiente
real y lo saltó como «sin destino» por no haber chat vinculado todavía, sin
marcarlo como enviado. `getMe` confirma el bot y no hay webhook puesto.

##### Quién llama al cron — `6a0f8da`, `824738a`, `d7551c6`

El endpoint no se despierta solo: en Vercel no corre ningún proceso nuestro, una
función solo vive mientras contesta. Sin alguien que pregunte «¿hay algo que
mandar?» cada pocos minutos, el aviso se queda en Mongo esperando a nadie. Fue
justo el primer síntoma al probarlo en producción: los recordatorios solo
llegaban al lanzar el `curl` a mano.

**GitHub Actions no sirvió.** El workflow está en
`.github/workflows/recordatorios.yml` y es correcto —las ejecuciones manuales
salen en verde—, pero su `schedule` no se ejecutó **ni una vez**: cero de unas
veintisiete esperadas en 137 minutos, contadas contra la API, con el workflow
`active`, en la rama por defecto y sin ser un fork. No es configuración del
repositorio; GitHub sencillamente no atiende los `*/5` aquí. Se queda de todas
formas, porque el botón *Run workflow* es la forma cómoda de disparar a mano
mientras se prueba algo.

**El programador de verdad es una cuenta gratuita en cron-job.org**, con un job
que hace `POST` cada 5 minutos, cuerpo `{}` y tipo `application/json`.

Y ahí vino lo caro. El secreto viajaba bien desde una terminal y no llegaba
desde cron-job.org, con las dos cabeceras probadas y el mismo valor de 64
caracteres. Un `401` no distingue «secreto equivocado» de «cabecera que nunca
salió», y el formulario no enseña qué envía: no queda nada que depurar, solo que
adivinar. La salida fue dejar de exigir una única forma. El endpoint acepta el
secreto en cinco sitios —cabecera propia, `Bearer`, pelado, `Basic` en
cualquiera de sus dos mitades, y `?secret=` en la URL— y **la que funcionó fue
la de la URL**:

```
https://planificador.danielvasquez.lat/api/cron/reminders?secret=<el secreto>
```

Es la peor de las cinco y la única que deja rastro: lo que va en una URL acaba
en los registros de acceso, en el historial del programador y en cualquier
intermediario. El riesgo está acotado —quien la consiga solo puede pedir que
salgan los avisos que ya tocaban, a los chats de siempre; no lee ni borra nada—
pero **ese secreto conviene rotarlo más a menudo que los demás**. Está ahí
porque rodear un formulario opaco sale más barato que seguir adivinando qué no
le gusta.

Por el camino salieron dos trampas, contadas en **Trampas que ya nos han
mordido**: las casillas de cabecera no son JSON, y la URL tiene que llevar
`https://` porque el 308 desde `http` se lleva por delante las credenciales.

Y un fallo de verdad que el diagnóstico destapó, sin relación con el cron: un
día borrado y vuelto a crear se quedaba marcado como borrado en el servidor.
Ver `b0935f2`.

Con esto **la tanda de recordatorios queda cerrada**: se programan en el
calendario, salen solos y llegan a Telegram sin que nadie toque nada.

---

### La lista de recordatorios — septiembre de 2026

#### `/recordatorios`

Va sin número a propósito: cuando se hizo, la tanda 8 —las imágenes en
Cloudinary— seguía sin hacerse, y numerar esta como la 9 habría dado a entender
que sí. Llegó después, y esta se quedó sin número.

Tercera pregunta que el proyecto no sabía contestar. La rejilla responde a «¿qué
pasa este día?» y la agenda a «¿qué tengo por delante?»; faltaba «¿qué me queda
por hacer, y qué ya está?», que obligaba a recorrer doce meses cazando campanas.

**`done` es un campo nuevo, y va aparte de `sent` a propósito.** Son dos cosas
distintas: `sent` lo escribe *solo* el servidor y dice que el aviso salió;
`done` lo escribe *solo* el navegador y dice que la persona ya lo ha resuelto.
Reutilizar `sent` habría roto la fusión —se adopta sin arbitrar marcas de tiempo
justamente porque nadie de este lado lo toca (ver `pull()`)— y habría dejado sin
respuesta la pregunta de la lista: ¿esto está hecho, o solo ha sonado?

Lo hecho **no suena**: el cron añade `'reminder.done': { $exists: false }` a su
filtro. Es lo que hace útil la casilla — tachar algo por la mañana evita el
aviso de por la tarde, en vez de solo pintarlo distinto. Y `makeReminder` suelta
`done` con la misma regla que ya soltaba `sent`: cambiar la hora o el texto
devuelve el aviso a pendiente, porque reprogramar algo resuelto es programar
algo nuevo.

**La sincronía se extrajo a `useCalendarStore`.** Vivía dentro de
`CalendarDashboard` mientras la única página que escribía era el calendario; con
dos, copiarla habría sido copiar lo más delicado del proyecto —la referencia de
lo persistido, el orden entre guardar y encolar, el único vuelo a la vez— y una
copia que se desviara de la otra rompería la subida en silencio. La página nueva
no toca `localStorage` ni la cola: escribe en `setData` y el resto pasa solo.

El mismo modal crea y edita, y lo único que los distingue es si hay día de
origen: sin él se está creando. Van juntos porque son la misma pantalla —fecha,
hora y texto— y separarlos habría dejado dos copias que se desviarían a la
primera corrección. Crear pone el aviso en un día que puede no existir todavía,
y entonces nace vacío: sin marca, sin nota y sin imágenes. Un día que solo
existe por su recordatorio es legítimo, y `hasContent` lo reconoce como tal.

El marcador de posición del texto sigue a la **fecha elegida**, no al día de
origen: sin texto propio lo que se manda es la nota del día en el que el aviso
acabe, así que preguntar por el de partida enseñaría una nota que no es la que
se va a mandar.

La edición rápida puede **cambiar la fecha**, y eso mueve el aviso de día: el
recordatorio vive dentro de su día, así que se saca de uno y se mete en otro. De
ahí las tres reglas de `reminders.ts`: el día de destino nace si no existía, el
de origen desaparece si se queda sin nada, y si el destino ya tenía aviso lo
pierde —solo cabe uno— previo aviso en el propio modal. Al mudarse **no se
hereda nada del anterior**: el instante es otro, y con él la respuesta a «¿ya
salió?» y a «¿ya está hecho?».

El orden es el del uso, no el del almanaque: lo próximo de lo más inminente en
adelante, y lo pasado **al revés**, del más reciente hacia atrás. De un aviso
vencido importa el de ayer, no el de hace ocho meses. El corte entre los dos
grupos es el instante del aviso y no su estado: uno que venció hace diez minutos
y sigue sin enviarse está en «ya pasaron», que es donde se le busca.

`ReminderChip` salió de la agenda (entonces `AgendaPanel`, hoy `AgendaList`) a
su propio archivo. El mismo dato merece
el mismo aspecto en los dos sitios, o el ámbar de «se pasó» dejaría de
significar lo mismo según desde qué página se mire.


#### La barra en un teléfono

Seis elementos de texto en una barra de catorce píxeles de alto no caben en 360
px de ancho: se amontonaban y acababan solapándose. Ahora todo lo que puede ser
un icono lo es, y los rótulos vuelven a partir de `sm`.

Los dos enlaces que quedan —recordatorios y galería— van igual: icono solo en un
teléfono, icono y rótulo a partir de `sm`. Que fueran distintos se probó y se
descartó: leer una barra donde un enlace lleva texto y el de al lado no cuesta
más que el ancho que ahorra.

**Nada de lo que se oculta desaparece.** El nombre accesible vive en
`aria-label`, que es lo único que sigue en pie cuando el texto se va, y los
rótulos de los contadores ya vivían en su `<dt>`.

El indicador de sincronía se probó condensado del todo y **se echó atrás**: un
visto suelto no dice «Al día», así que el estado normal dice su palabra en todas
las pantallas. Lo único que sigue escondido en un teléfono es la frase «cambios
sin subir», y ahí sí hay un motivo de sitio: en la cabecera del calendario este
distintivo ocupa media fila —unos 160 px— y ya lleva el icono, el número y el
botón de reintentar, que es lo que hace falta. Se va con `sr-only` y no con
`display:none`, para que el `role="status"` siga teniendo qué anunciar justo
donde menos sitio hay para enterarse de otro modo.

El enlace «Calendario» se fue entero: la marca ya lleva a la portada, y
repetirlo al lado gastaba el ancho que hacía falta para el resto. Por eso la
marca lleva ahora `aria-current="page"` en la portada — es el único elemento que
la representa.

El título «Enero — Diciembre 2026» se quitó de la vista: los doce meses ya lo
dicen y ocupaba una línea entera de un teléfono. Queda como `<h1 class="sr-only">`,
porque la página sigue necesitando un encabezado del que colgar el resto.

La fila de contadores se parte en tres bloques apilados —acciones, cuentas,
plegado— de dos columnas iguales, y vuelve a una sola fila en `sm`. De paso sale
del `<dl>` el indicador de sincronía, que llevaba dentro sin ser ni `dt` ni `dd`.

#### La agenda se muda a `/agenda`

Vivía apretada al pie del calendario, con `max-h-96` y scroll propio para no
empujar el pie de página fuera de la vista. Eso es una lista de hasta trescientos
sesenta y seis días mirada por una rendija de trescientos ochenta píxeles. Ahora
tiene página: sin marco, sin título propio —el de la página ya lo dice— y sin
alto máximo. Con ella se fue la regla de impresión de `.max-h-96`, que describía
un scroll que ya no existe.

Las filas pasaron de botón a **enlace** a `/?day=…`. En el calendario abrían el
modal del día porque el modal estaba ahí al lado; desde otra página el camino era
el que ya usaban «Ver nota» en la galería y «Ver en el calendario» en los
recordatorios, y editar un día entero seguía siendo cosa de su modal, que vive
donde está la rejilla.

**Duró lo que tardó la agenda en tener buscador.** Con filtros y un texto
tecleado que perder por el camino, el salto a la portada dejó de salir a cuenta y
las filas volvieron a ser botones. Ver *El día se edita donde se está mirando*,
más abajo.

Las dos cuentas —días marcados y notas guardadas— se fueron con ella. Estaban en
la cabecera de la portada, que es donde menos falta hacían: encima de una rejilla
que ya enseña de un vistazo cuántos días llevan color. Junto a la lista de la que
salen sí dicen algo, y la cabecera del calendario se queda con lo que solo sirve
allí: ir a hoy, el estado de la sincronía y el plegado de los meses.

`AgendaPanel` pasó a llamarse `AgendaList`: dejó de ser un panel dentro de otra
página el día que tuvo la suya.

#### Modo oscuro

**El tema se cambia en un sitio: los tokens.** Todo el color de la aplicación
salía ya de las variables de `@theme`, así que el modo oscuro son quince líneas
que las redefinen bajo `:root.dark` en vez de un `dark:` repartido por doscientas
clases. Lo que costó no fue eso, fue lo que estaba escrito a mano: veintinueve
`bg-white` y un puñado de `text-white`.

De ahí salen tres tokens nuevos, y cada uno por una razón concreta:

- `raised` es lo que era `bg-white`: campos, botones y tarjetas **sobre** una
  superficie. Blanco en claro, un escalón por encima de `surface` en oscuro.
- `scrim` es el velo de los modales y las chapas sobre fotos. **No cambia con el
  tema**, y es el único que no lo hace: lo que va encima es blanco en los dos, y
  un velo claro no oscurecería nada. Antes era `bg-ink/40`, que al invertirse
  habría puesto una niebla blanca sobre la página.
- `accent-ink` y `today-ink` separan el papel de *texto* del de *fondo*. Un teal
  que lleva texto blanco encima y un teal que se lee sobre un tinte tiran hacia
  lados opuestos al oscurecer: el primero tiene que quedarse oscuro y el segundo
  aclararse. Con un solo token no hay forma de contentar a los dos. En claro
  valen lo mismo, así que el tema claro no se movió ni un punto.

`bg-ink` se quedó como lo que era sin que nadie lo dijera: la superficie
invertida del aviso del pie y de los chips activos. Su texto pasó de `text-white`
a `text-canvas`, y así se invierte solo en los dos temas.

Un fallo que solo se ve de noche: la casilla de «hecho» de los recordatorios
escondía el visto pintándolo de blanco sobre fondo blanco. En oscuro el fondo
deja de ser blanco y el visto aparecía en todas las filas, con todo marcado.
Ahora se esconde con `text-transparent`, que es lo que se quería decir.

**El destello se evita en el `<head>`, no en React.** Un script bloqueante de seis
líneas decide la clase de `<html>` antes de que exista el `<body>`, así que el
primer píxel ya sale con el tema puesto. Es el mismo truco que ya usaba
`index.astro` para los meses plegados, subido a `Layout.astro` para que valga
también en la pantalla de acceso.

Por eso **la fuente de verdad es la clase del DOM**, no un `useState`. El
interruptor no tiene estado: qué icono se ve lo decide la variante `dark:`, es
decir CSS, y al pulsar se lee la clase para saber qué toca. Con estado habría un
primer render que el servidor no puede acertar —no sabe qué guardó este
navegador— y se vería un instante el icono equivocado.

Sin nada guardado manda `prefers-color-scheme`, y se le sigue en caliente: el
portátil que se oscurece al anochecer arrastra la página sin recargarla. Pero
seguir al sistema **no** escribe en `localStorage`: guardarlo ahí congelaría la
preferencia la primera vez que el sistema cambiara de humor, y ya no volvería a
seguirlo.

La transición de doscientos milisegundos vive en una clase temporal que el
interruptor pone y quita. Dejarla siempre puesta metería ese retardo en cada
`hover` de la aplicación y pelearía con las transiciones propias de los botones.
Se quita con un temporizador y no con `transitionend`: ese evento llega una vez
por propiedad y por elemento —miles aquí—, y con `prefers-reduced-motion` no
llega ninguno, que es justo cuando dejaría la clase puesta para siempre.

El bloque oscuro va dentro de `@media screen`: en papel manda siempre la paleta
clara, que es la que ya contemplan las reglas de impresión.

### Editar sin salir, colores propios y etiquetas — septiembre de 2026

#### El día se edita donde se está mirando

La agenda estrenó buscador y filtros, y con ellos el enlace a `/?day=…` se volvió
caro: buscar «médico», pulsar un resultado y aparecer en la portada dejaba atrás
lo tecleado, las pestañas, el color elegido y el sitio en la lista. Todo eso
había que rehacerlo a mano para seguir repasando.

Ahora la fila abre **el mismo `DayModal`** sobre la propia agenda. El mismo y no
uno más pequeño a propósito: un segundo editor sería un segundo sitio del que
acordarse la próxima vez que un día gane un campo, y los dos acabarían
separándose. `AgendaList` no se desmonta mientras el modal está abierto, así que
la lente sobre la lista se conserva por construcción y no por guardarla y
reponerla.

Escribe por `useCalendarStore`, la misma puerta que la rejilla y la lista de
recordatorios. Con ella se trajo la banda de aviso con **Deshacer**, porque dos
de las cosas que ahora se pueden hacer desde aquí —vaciar un día y mudarlo— no
tienen vuelta sin ella. De paso le da sitio a lo que cuenta la sincronía: la
agenda lo estaba tirando al suelo.

#### Un día se puede mudar de fecha

El modal recibe cuatro props opcionales, y sin ellas la rejilla dibuja
exactamente lo que dibujaba antes. `onMove` convierte la fecha en un campo: **en
una lista la fecha es un dato del día; en la rejilla la casilla *es* la fecha**, y
un selector allí solo pediría decir dos veces dónde ya se ha pulsado.

`moveDay` rehace el aviso con la fecha nueva. Un recordatorio guarda el instante
absoluto de su día, así que arrastrarlo tal cual dejaría la alarma sonando en la
fecha de la que se acaba de salir; `makeReminder` recalcula ese instante y de
paso suelta `sent` y `done`, que es lo correcto: en el día nuevo está por sonar y
por hacer.

**El campo se apaga mientras los adjuntos no hayan bajado a este navegador**, y
ese es el detalle que no se ve venir: el día de origen se borra, su lápida borra
sus imágenes en la cuenta, y el destino heredaría solo la cuenta de imágenes,
apuntando a nada. Es la misma razón por la que el botón de adjuntar ya estaba
apagado en ese estado.

`hasDay` avisa antes de pisar un destino que ya tenga contenido, y
`showCalendarLink` deja la salida a la rejilla para quien quiera el día con su
mes alrededor.

#### «Dado por hecho» baja al día

Tachar un aviso vivía solo en `/recordatorios`, lo que obligaba a salir del día
que se estaba leyendo para tachar justo lo que se acababa de leer. La casilla
está ahora en `ReminderField`, que es campo compartido: la rejilla la gana
también. Un mismo formulario comportándose de dos maneras según quién lo abra
habría sido peor que el cambio.

#### Las muestras de color, a un tamaño que sirva

Las ocho se repartían el ancho del modal en partes iguales, y eso salía mal por
los dos extremos: unos setenta píxeles en un portátil —un mural de color encima
de la nota— y veintiocho en un teléfono, por debajo de lo que un dedo acierta.
Ahora son columnas fijas de 2.75rem: cuatro por fila en un teléfono y las ocho
seguidas a partir de `sm`. El tamaño se declara una sola vez, en la rejilla.

#### Los colores dejan de ser de fábrica

En Ajustes, cada categoría tiene su `<input type="color">` junto al nombre, y hay
un botón que devuelve los ocho a como vinieron.

**No hubo que migrar ni un dato**, y eso no fue suerte: un día guarda `color:
'rose'`, nunca `#be123c`. Lo que estaba mal era el otro extremo, `colorHex`, que
resolvía siempre contra la tabla de fábrica. Si en el día viajara el
hexadecimal, retocar un tono habría sido recorrer trescientos sesenta y seis
días, subirlos todos y confiar en que ningún dispositivo se quedara a medias.

Se guarda en **la clave de siempre** —la de los nombres— y el saneado entiende el
formato anterior, un texto suelto por color, y lo convierte al de ahora. Nadie
pierde sus categorías bautizadas.

Y se guarda **solo lo retocado**, no el esquema completo. Copiar los ocho colores
enteros dentro de cada navegador congelaría la paleta de fábrica: afinar un tono
en el código no le llegaría nunca a quien ya tuviera algo guardado, aunque jamás
hubiera tocado ese color. `resolvePalette` devuelve el esquema completo para
quien lo necesite. Por lo mismo, un color retocado al mismo tono de fábrica no
cuenta como retoque: si contara, «Restablecer» parecería tener trabajo pendiente
cuando no lo tiene.

El hexadecimal se comprueba en los tres sitios por los que puede entrar, y **no
es cosmético**: ese valor acaba en una propiedad personalizada del documento y se
sustituye tal cual allí donde se use la variable, así que un texto cualquiera
podría colar más CSS del que aparenta.

Restablecer pregunta antes. No toca ningún día, pero se lleva los ocho nombres de
una vez y la paleta no tiene el Deshacer del pie del calendario, porque no viaja
con los datos.

#### El color no viaja por las props

El color de un día se dibuja en una docena de sitios —la casilla, su punto, la
fila de la agenda, la tarjeta del recordatorio, la leyenda, las muestras del
modal— y la mitad no recibe la paleta ni tendría por qué: `DayCell` solo sabe de
un día, y hacérsela llegar obligaba a atravesar `MonthCard` con una prop que no
usa.

Así que viaja por una **propiedad personalizada del documento**. Cada id tiene la
suya y pintar es pedirla con el color de fábrica como respaldo:
`var(--day-rose, #be123c)`. De ahí salen tres cosas gratis:

1. Retocar un color repinta **todo** lo que lo usa en el mismo cuadro, sin un
   solo repintado de React y sin que nadie se suscriba a nada.
2. El HTML del servidor ya trae el color correcto dentro del respaldo: ni
   destello ni desajuste de hidratación.
3. Una página que no sabe nada de la paleta pinta bien igualmente.

Las variables se ponen en el `<head>` con un guion en línea, **por el mismo
motivo y en el mismo momento que el tema**: montado en React, el calendario se
pintaría un cuadro con los colores de fábrica y otro con los suyos.

`labels.ts` se disolvió dentro de `palette.ts`: los colores de fábrica y los de
cada persona se buscan en el mismo sitio. Y `usePalette` recogió la copia doble
de «leer `localStorage` tras montar y vigilar el evento `storage`» que había en
el calendario y en la agenda; la tercera copia habría sido la que se desviara.
Escribe por una función y no por un `useEffect` que vigile el estado, porque ese
efecto corre también en el primer render —cuando la paleta aún está vacía porque
no se ha leído— y guardaría ese vacío encima de lo que hubiera.

#### Etiquetas

Siete de fábrica —Deporte, Ejercicio, Diversión, Descanso, No molestar, Trabajo,
Estudio— y las que se quieran añadir. Clasifican el día por lo que **es**, que es
otra pregunta que la del color: el color dice de qué va —«Entrega», «Guardia»— y
es uno solo; las etiquetas son varias y se cruzan con él.

**Son dos cosas y viven en dos sitios, y eso es lo único importante de esta
tanda.** El catálogo —qué etiquetas existen— es configuración de este
dispositivo, como la paleta, y se queda en `localStorage`. Lo que un día lleva
puesto es **contenido del día**: va dentro del `DayEntry`, sube a la cuenta y se
resuelve en conflictos por la misma vía que la nota. Guardar las asignaciones en
`localStorage` con el catálogo habría sido más fácil de escribir y habría dejado
fuera de la sincronía la mitad que importa: etiquetar en el portátil no se vería
en el móvil, y un día borrado o mudado de fecha dejaría las suyas colgando de una
clave que ya no existe.

El día guarda el **`slug`**, no el rótulo: la misma indirección que con los
colores, y por lo mismo. Con el texto dentro, «Trabajo» y «trabajo» serían dos
etiquetas y no habría forma de volver a juntarlas.

Que viajen obligó a tocar la cadena entera, y conviene tenerlo escrito porque el
siguiente campo del día pasará por los mismos cinco sitios: `DayEntry`, el
saneado de `storage.ts`, `WireDay` con su saneado, `toWire`/`fromWire`, y
`sameDay` en `sync.ts`. **Ese último es el que se olvida**: sin él, poner una
etiqueta y no tocar nada más se guardaría aquí y no se encolaría jamás, que es
exactamente lo que ya pasó con `reminder`. El sexto sitio lo exige el compilador:
`OPTIONAL_FIELDS` en `days.ts` es un `Record` sobre las claves opcionales, así
que el build no pasa hasta que `tags` está en la lista de campos que hay que
borrar cuando desaparecen.

Un día que solo lleva etiquetas **cuenta como contenido**. Es discutible —una
etiqueta clasifica algo, y sola no clasifica nada— pero la alternativa es peor:
elegir «Descanso» en un día vacío, guardar, y que no pase nada sin que nada lo
explique. `hasContent` y el saneado de `sanitizeData` tienen que decir lo mismo o
el día se guardaría y desaparecería al recargar.

Borrar una etiqueta del catálogo **la quita de todos los días que la llevaban**.
La alternativa era dejarlas puestas y que se vieran sin poder elegirse, que no
pierde nada pero deja la única forma de quitarlas en abrir los días uno a uno.
Así que se quitan de golpe, Ajustes dice de cuántos días antes de hacerlo, y el
aviso del pie lo deshace —el catálogo también, por eso `Notice` ganó un campo
`tags`: deshacer solo la mitad dejaría etiquetas puestas que ya nadie puede
quitar.

Lo que un día lleva **no se comprueba contra el catálogo**. Un día etiquetado en
el portátil no puede perder su etiqueta por abrirse en un móvil que aún no
conoce el catálogo, que no viaja; por eso `labelOf` sabe componer un rótulo a
partir del `slug`, y el selector enseña —y deja quitar— lo que lleva puesto
aunque ya no esté en la lista.

En el selector no se renombran. Cambiar el rótulo cambiaría el `slug`, y eso
dejaría a los días apuntando a algo que ya no existe: sería borrar y crear con
otro nombre, disfrazado de edición. En dos pasos se puede hacer igual, viendo lo
que se pierde.

Las etiquetas del recordatorio son **las del día**. Un día tiene como mucho un
aviso, así que separarlas daría dos juegos de etiquetas para la misma fecha sin
nada que los distinga. Por eso el modal rápido pregunta por el día **elegido** y
no por el de origen, igual que ya hacía con la nota: mover el aviso a otra fecha
enseña —y escribe— las de esa fecha.

La agenda **filtra por ellas**, y el filtro vive donde vivían los otros cuatro:
dentro de la base de la que salen las cuentas de las pestañas, no después. Así
«Recordatorios 2» sigue contestando a «cuántos avisos hay entre lo que estoy
mirando» con la etiqueta ya puesta, que es la pregunta del momento; contarlos
después de elegir pestaña daría siempre el total de esa pestaña o cero.

Los cinco se cumplen a la vez —texto, tipo, etiqueta, color y pasado—, así que la
regla dejó de ser un `filter` en el componente y se fue a `matchesLens`, en
`search.ts`, donde se puede probar sin pintar nada. Y un filtro puesto sobre algo
que ya no existe se suelta solo: borrar la etiqueta en Ajustes, o quitársela al
último día que la llevaba, hacía desaparecer el chip dejando el filtro puesto, y
la lista se quedaba vacía sin nada encendido que explicara por qué. Le pasaba
igual al color desde que existe.

Donde no se ven es en la casilla del calendario. No cabe: son cuarenta píxeles
que ya llevan el color, el punto de la nota, la campana del aviso y el aro de
hoy. Se ven en la agenda, en las tarjetas de recordatorio y dentro del día.

#### Un `README.md`

Este archivo abre por la arquitectura y da por sabido qué es el proyecto. Es lo
que quiere quien trabaja aquí y lo contrario de lo que necesita quien acaba de
clonar, así que el README cubre el terreno que este se salta: qué problema
resuelve, qué sabe hacer, sobre qué está construido y los pasos de `git clone` a
un servidor de desarrollo que contesta. Los límites que cita —seis imágenes por
día, doce megas por archivo, la ventana de gracia— están leídos del código, no
recordados.

### Los ajustes salen del calendario — septiembre de 2026

El engrane vivía en `CalendarDashboard`, que era la única página con los datos y
los manejadores que el panel necesita. El precio lo pagaba quien estuviera en
otra: para renombrar una categoría o exportar había que volver a la portada,
perdiendo de paso lo que se estuviera mirando. Ahora está en la barra, que es la
única pieza que se dibuja en todas, y lo que le falta para funcionar sale de
`useSettings`.

**La barra pinta el botón y el diálogo.** No están repartidos porque son la misma
cosa: el modal nace del engrane —de ahí saca su `transform-origin`— y a él
devuelve el foco al cerrarse.

`useSettings` **devuelve también la paleta y el catálogo**, y eso no es
comodidad. Son estado con dueño único: si la página llamara a `usePalette` por su
cuenta y el hook llamara a otra, renombrar una categoría escribiría en un
ejemplar y la lista seguiría leyendo del otro —el evento `storage` no llega a la
pestaña que escribe—, así que el nombre nuevo no aparecería hasta recargar. Un
ejemplar por página, y sale de ahí.

De paso cayeron dos duplicados. El aviso del pie —el estado, el temporizador de
ocho segundos y treinta líneas de JSX— estaba copiado en tres páginas y hacía
falta una cuarta en la galería; ahora es `useNotice` y `NoticeBar`. Y lo que se
deshace pasó de ser **una instantánea del calendario a una función**: desde que
hay cosas que deshacer fuera del calendario —borrar una etiqueta cambia los días
*y* el catálogo— una instantánea de los días solo sabía devolver la mitad.

**La galería dejó de leer `localStorage` por su cuenta** y usa el mismo almacén
que el resto. Tenía que hacerlo: desde sus ajustes ahora se importa y se borran
etiquetas, y su `setData` de antes escribía en el estado sin guardar, sin encolar
y sin subir. Gana el `pull` inicial, que no tenía —un dispositivo recién
estrenado enseñaba la galería vacía hasta pasar por otra página—, y las imágenes
que baja entran por `adopt` y no como edición: lo que acaba de llegar no tiene
que volver a subir.

Eso obligó a rehacer su barrido de descargas. Antes miraba una vez, al hidratar;
con el `pull` los días llegan después, así que ahora **relee el calendario en
cada vuelta** y recoge lo que aparezca a media faena. Y no se cancela cuando
cambian sus dependencias, solo al desmontar: cada imagen que entra cambia la
lista de pendientes, y cortar por eso abandonaría la descarga en vuelo dejando
días sin pedir. Mientras hay un barrido en marcha, los disparos siguientes se van
de vacío.

### Dos años en el mismo calendario — septiembre de 2026

`YEAR = 2026` era una constante, y todo lo que colgaba de ella la leía como el
único año que hay: `MonthCard` construía su rejilla con ella, los campos de fecha
se acotaban a ella, e `isInQuarter` —que para entonces ya no tenía nada que ver
con un trimestre— contestaba a «¿está este día en el calendario?» mirando por qué
**mes** empezaba la clave.

Ahora es `YEARS`, una lista. `isCovered` pregunta por el año de la clave y no por
su mes, así que añadir 2028 es una línea. La rejilla sigue dibujando doce meses en
las mismas dos columnas, pero del año que diga el conmutador; los días, la
alineación de la semana y la cuenta de los bisiestos salen de ese año. 2026 y 2027
rinden 365 días cada uno y **76 y 62 huecos** de rejilla respectivamente: eso
último es lo que habría salido mal si los meses se hubieran reetiquetado en vez de
recalcularse.

**El conmutador es un `tablist` de verdad y la rejilla es su `tabpanel`.** No es
ceremonia: es lo que la cosa *es*, y paga las flechas del teclado, la parada de
tabulación itinerante y que un lector diga «pestaña 2 de 2» sin escribir nada de
eso a mano.

**El año se resuelve en el servidor, no al hidratar.** Manda `?year=` —lo que deja
el conmutador con `replaceState`—, luego el año de `?day=`, porque
`/?day=2027-05-10` lleva el suyo dentro y así llegan los enlaces de la galería y
de los recordatorios, y a falta de los dos, el año corriente si el calendario lo
cubre. Leerlo en el navegador habría mandado el HTML de 2026 para cambiarlo por el
de 2027 un fotograma después, que es el mismo destello que el script del tema se
toma tantas molestias en evitar.

No hizo falta tocar el almacenamiento, el cable ni Mongo: un día siempre se ha
identificado por su fecha completa, así que 2027 se guarda y se sincroniza aparte
de 2026 sin pagar nada. Lo que sí cambió es el alcance de la interfaz: los campos
de fecha van de `2026-01-01` a `2027-12-31`, y los dos modales dejan de decir que
el calendario solo cubre un año.

Dos detalles del recorrido, por si alguien los da por descuido: las flechas del
teclado **paran en el borde del año** —el 31 de diciembre no entra en el 1 de
enero del siguiente, porque esa rejilla no está en la página—, mientras que «Ir a
hoy» **sí cruza**, cambiando de pestaña por el camino en vez de desaparecer cuando
hoy cae en el otro año.

**Y el plegado de los meses se aisló por año**, que en la primera versión no lo
estaba. El estado se guardaba con el nombre del mes a secas —`{ enero: false }`—,
lo que bastaba mientras 2026 era el único año y dejó de bastar en cuanto llegó
2027: plegar enero en 2026 plegaba el enero de 2027, porque era la misma casilla
del registro, y cambiar de pestaña arrastraba la forma de un año a la del otro. La
clave lleva ahora el año (`2026-01`, que son también los siete primeros caracteres
de una clave de día, de modo que un mes se identifica igual aquí que en el resto
del proyecto), y `data-month` lo lleva con ella.

Eso arrastró a los botones de plegar y desplegar todo. `expansionOf` pasó a ser
`withYear`, que escribe los doce meses de un año y deja el resto como estaban, y
`everyMonth` pregunta por un año, de forma que «Colapsar todos» se ve agotado con
2026 entero plegado aunque 2027 siga abierto. Dejar cualquiera de los dos global
habría devuelto la misma fuga por la puerta de atrás.

El estado anterior **se migra en vez de tirarse**: un nombre de mes sin año se lee
como 2026, que era el único que existía cuando se escribió. La hoja de arranque
hace esa misma traducción por su cuenta, y el porqué está abajo, en las trampas.

### Los ajustes se pliegan y la leyenda se muda — septiembre de 2026

Las cuatro secciones de los ajustes —colores, etiquetas, copia de seguridad y
Telegram— se pintaban a la vez en dos columnas. Cabían, pero el modal pedía toda
la pantalla para enseñar cuatro cosas que casi nunca se tocan en la misma visita,
y encontrar la que se venía a buscar era leerlas todas. Ahora son un **acordeón
exclusivo**: los cuatro rótulos se ven de un vistazo, abrir uno cierra el
anterior, y se entra por «Categorías de color», que es a lo que más se vuelve.

`Fold` no guarda si está abierto. **La regla de exclusividad no la puede cumplir
quien no ve a sus hermanos**, así que el estado —una sección, o ninguna— vive en
`SettingsPanel` y `Fold` solo pinta lo que le digan. El cuerpo plegado sigue en el
DOM, como en `MonthCard` y por lo mismo: una etiqueta a medio escribir no debe
perderse porque se mire otra sección. `inert` lo saca del tabulado mientras no se
vea, que si no la trampa de foco del modal pasearía por campos invisibles.

El plegado en sí **es el de los meses**, no una copia: las reglas de `global.css`
que animan `grid-template-rows` entre `0fr` y `1fr` valen ahora para `.month-body`
y para `.fold-body`, y giran los dos chevrones a partir del mismo `data-open`. Dos
copias de esa animación se habrían separado a la primera corrección.

**La leyenda se fue al fondo de los ajustes.** Explicaba de qué color es un día
marcado, cuál lleva nota y qué hace Shift+clic: se aprende una vez y ocupaba sitio
todos los días al pie de la portada. Va fuera del acordeón, fija, porque no es un
ajuste sino la chuleta de lo que se ve en la rejilla. En su hueco quedó la firma.

---

### Las imágenes se mudan a Cloudinary — tanda 8, septiembre de 2026

La tanda 4 sacó las imágenes del documento del día, pero los bytes seguían en
Atlas y una copia completa seguía en `localStorage`. Eso dejaba tres techos a la
vez: la cuota del navegador, el tope de 4,5 MB del cuerpo de una función y la
miniatura en base64 que bajaba con cada día. Ahora los bytes son de Cloudinary y
Mongo se queda con la referencia y el orden.

**Lo que no ha cambiado:** el día sigue llevando solo la cuenta y una miniatura,
las imágenes se siguen pidiendo bajo demanda, y la cola de `sync.ts` sigue
mandando una imagen por petición. Es un cambio de almacén, no de arquitectura.

#### Dónde vive cada imagen

```
{CLOUDINARY_FOLDER}/{userId}/{key}/{index}
 │                  └── ObjectId de la sesión, nunca lo que venga en el cuerpo
 └── `planificador` salvo que se diga otra cosa
```

Fue `uploads/users/{userId}/…` hasta que la carpeta raíz salió al entorno. El
`userId` estaba ya desde el principio, y es el identificador y no el nombre a
propósito: no cambia si la persona se renombra, y sus treinta y dos caracteres
de `[0-9a-f]` no pueden traer dentro un espacio, un acento ni una barra, que es
justo lo que partiría un `public_id` en dos.

Lo ya subido **no se movió solo**: el `publicId` se guarda entero en `images` y
no se recalcula al leer, así que cada imagen siguió sirviéndose desde donde
estaba hasta que pasó `scripts/migrate-image-folders.mjs`.

El `public_id` se compone en el servidor y es determinista: la posición del
adjunto ya dice su nombre, así que no hay que guardar «qué id me devolvió» para
poder escribir encima. La carpeta **no es la frontera de seguridad** —eso lo
hace la firma— pero se gana lo suyo igualmente: borrar todo lo de una persona es
borrar un prefijo, y el panel de Cloudinary se puede leer.

Todo sube con `type: 'authenticated'`, que es lo que había que usar y no
`private`: con `private` solo el original queda protegido y las derivadas se
sirven públicamente, que es justo el agujero por el que se vería una miniatura
sin haber entrado nunca.

#### Que nadie la vea sin sesión

Las imágenes se sirven **por proxy**, no con una URL de Cloudinary en el
navegador: `GET /api/images/raw?key=…&i=N&size=thumb|view&v=…` valida la sesión,
busca el metadato —y buscarlo por `userId` *es* la comprobación de propiedad—,
firma la URL, trae los bytes y los devuelve. La firma no sale nunca de la
función.

**Dentro de ese endpoint manda el testigo, no la posición.** Quitar un adjunto
que no es el último corre una posición a los de detrás en el navegador al
instante, y aquí no lo hacen hasta que sube la cola; en ese hueco, buscar por
posición devolvería la imagen equivocada y la caché de un año la dejaría
equivocada para siempre. Buscando por `etag` se devuelve siempre el contenido
que la dirección dice llevar, y la posición queda de respaldo para lo que no
traiga testigo reconocible — con un minuto de caché en vez de un año, porque
entonces no hay nada que garantizar.

Por qué proxy y no una URL firmada directa al CDN, que sería más barata:
**una URL firmada de Cloudinary no caduca**. Para que caduque hace falta
autenticación por token (`auth_token` con `duration`), y eso es plan *Advanced*
o superior. Con una firma perpetua, una dirección que se escape por un
historial, un registro o un *Copiar dirección de la imagen* vale para siempre y
para cualquiera. El proxy cumple el requisito sin depender del plan: sin cookie
de sesión no hay bytes, punto.

El precio es que el tráfico pasa dos veces —Cloudinary, función, navegador— y lo
que lo deja en una vez por imagen y dispositivo es
`Cache-Control: private, max-age=31536000, immutable`. Se puede cachear para
siempre porque **la dirección lleva dentro un testigo del contenido**: otra
imagen, otra URL.

El proxy acepta `size=thumb|view` y **nada más**. Admitir una cadena de
transformación del cliente lo convertiría en un proxy de transformaciones
abierto, y las transformaciones son lo que gasta créditos. Las dos medidas
—192 y 1280, las mismas que antes calculaba el navegador— se piden *eager* al
subir, así que la primera petición encuentra la derivada hecha.

Si algún día hay plan con token, el proxy se sustituye por un endpoint que
devuelva URLs firmadas de diez minutos y deje que el CDN sirva los bytes. Por
eso todo lo que se pinta sale de `srcOf(ref, key, index, size)` y no de una
cadena repartida por los componentes: se cambia una función y ya está.

#### El adjunto tiene dos formas, y las dos son válidas

En el mismo array conviven una **data URL**, mientras el adjunto está recién
elegido y sin subir, y una **referencia** `cld:{publicId}@{etag}` en cuanto el
servidor confirma la subida. `sameImages`, el orden, la cola e `imagesReady` no
se tocaron: quien pinta resuelve cuál es cuál y ya.

Eso obligó a partir en dos lo que era una sola comprobación: `isImageDataUrl`
guarda la puerta de **subida** —solo se acepta lo que el navegador podría haber
generado— e `isImageRef` la de **bajada**. Sin la segunda, el saneado del
cliente tiraba todo lo que viene del servidor por no ser una data URL, y el
calendario se quedaba sin adjuntos a la primera recarga.

**El testigo es el `etag` y no la `version`**, que era lo natural. La razón
apareció probando: renombrar en Cloudinary **no cambia la versión**. Quitar la
primera de dos imágenes corre la segunda al sitio de la primera con su versión
intacta, y si las dos se subieron en el mismo segundo la dirección del proxy
saldría idéntica con otro contenido detrás — y cacheada un año. Con el hash del
contenido eso no puede pasar, y dos veces la misma imagen comparten caché, que
es lo correcto.

#### Mover no es resubir

Quitar un adjunto que no es el último corre una posición a todos los de detrás,
y como el nombre lleva el índice dentro, hay que mover los bytes. El navegador
**no puede resubirlos**: los soltó al confirmarse la subida y solo guarda la
referencia. Por eso `PUT /api/images` admite dos cuerpos: el de siempre
—`{ key, index, dataUrl, updatedAt }`, que no ha cambiado— y uno con `ref` en
lugar de `dataUrl`, que el servidor resuelve con un `rename`. No mueve bytes y
cuesta una llamada.

De ahí sale el único caso raro de todo esto. Si la subida se corta a la mitad,
el reintento vuelve a mandar el día entero y se encuentra con que el origen del
renombrado ya no existe, porque el renombrado ya se hizo. El servidor mira
entonces quién ocupa esa posición y devuelve su referencia, con lo que el
navegador se pone al día; y si no la ocupa nadie, contesta `410` y el navegador
**deja caer esa imagen** y reintenta el resto con los índices ya corridos. Es
feo, pero es lo único que impide que un adjunto perdido deje la cola girando
para siempre, y cada vuelta quita uno: termina seguro.

#### Lo que se pierde

Antes las imágenes estaban en `localStorage` y se veían sin conexión. Ahora, un
dispositivo que no las haya abierto nunca no las tiene. La caché del proxy
mantiene visible lo ya visto, pero es una caché, no una garantía: **el
local-first se conserva para las notas y deja de valer para las imágenes.** Es
el precio de quitar los tres techos, y conviene tenerlo escrito antes de
descubrirlo en un avión.

La exportación (v7) tampoco es ya una copia completa: los adjuntos viajan como
referencias, así que el archivo pasa de megas a kilobytes y se puede reimportar
en la misma cuenta sin perder ninguna imagen — pero fuera de ella esas
referencias no apuntan a nada.

#### La migración

`scripts/migrate-images.mjs`, idempotente y reanudable: por cada documento con
`dataUrl` lo sube, escribe la referencia y **solo entonces** suelta los bytes,
en dos escrituras. Cortado a la mitad deja un documento con las dos cosas, que
es recuperable; al revés dejaría uno sin ninguna, que no lo es. Cuenta las
imágenes por usuario antes y después y compara, que es la única comprobación que
importa.

**El orden contra producción es migrar *después* de desplegar**, que no es el
que parece. El código viejo lee los bytes de `images`: migrar primero deja todas
las imágenes sin verse hasta que suba el nuevo. Al revés, el nuevo convive con
lo que quede sin migrar —lo omite en `GET /api/images`, y el proxy contesta 404
en vez de fingir una avería del almacén— y solo falta lo que aún no ha subido.

Las miniaturas de `days` se rehacen en la misma pasada, **sin tocar
`updatedAt`**: es el árbitro de la fusión, y subirlo haría que el día del
servidor le ganara a cualquier edición sin subir que alguien tenga en su
navegador. Perder una nota por una miniatura sería un mal negocio.

Y del lado del navegador la migración no necesita script: `pull` encola los días
cuyos adjuntos siguen siendo data URL, así que el primer arranque tras la
actualización los resube y los convierte en referencias. De ahí sale, sin caso
especial, la limpieza de `localStorage`.

#### Riesgos que quedan

- El plan gratuito va por créditos y el proxy hace que el tráfico pase dos
  veces. La caché `immutable` es lo que lo mantiene en una vez por imagen y
  dispositivo; sin ella, cada visita a la galería lo pagaría entero.
- Un `destroy` que falle deja un huérfano que nadie mira y que sigue ocupando.
  Anotado en la deuda.

---

### El calendario se abre en hoy — septiembre de 2026

Doce meses no caben en una pantalla, así que entrar era aterrizar en enero y
buscarse la vida: bajar a mano o acordarse de «Ir a hoy». Pero lo que se viene a
ver es hoy —esa es la razón de que exista el botón—, y pedirlo cada vez era pedir
lo mismo siempre. Ahora la rejilla **llega ya puesta en el día actual**.

Es el mismo viaje que hace el botón, y por eso ahora lo hacen los dos con la
misma función: `revealDay` en `CalendarDashboard`. Con el mes abierto centra la
casilla; con el mes plegado se para en la cabecera de la tarjeta, porque el
cuerpo cerrado vale `0fr` y **la casilla mide cero**: desplazarse a ella dejaría
la vista en cualquier sitio. El `scroll-mt` de la sección es el que deja hueco
para la barra. El movimiento se anima salvo que el sistema pida lo contrario,
como el resto de la interfaz.

**Espera a tres cosas y no a que monte el componente**, que es lo que lo hace
aterrizar donde debe. A `today`, porque la fecha se resuelve en el cliente y
hasta entonces está vacía. A `hydrated`, porque los días vienen del almacén. Y
sobre todo a `expansionLoaded`: el HTML baja con los doce meses **abiertos** y el
plegado guardado se aplica al hidratar, así que medir antes sería medir un
calendario que está a punto de encoger. El `requestAnimationFrame` final da el
cuadro en el que ese plegado ya está pintado.

#### Lo que le gana

Que se mueva sola la pantalla es una cortesía, y la cortesía cede:

- **`?day=` manda.** El enlace «Ver nota» de la galería trae su propio día; si
  además saltara a hoy, se taparía justo lo que se venía a ver.
- **Una página que nace desplazada ya está donde quería estar**, sea porque el
  navegador restauró la posición al recargar o por un `#ancla`. Basta mirar
  `window.scrollY` antes de tocar nada.
- **El plegado guardado no se toca.** Podría desplegar el mes de hoy para
  centrar el día, pero sería deshacer una decisión del usuario en su nombre —y
  un salto de layout de regalo—. Se queda en la cabecera y quien quiera ver el
  mes lo abre. «Ir a hoy» sí lo despliega: ahí ha habido un clic que lo pide.

Tampoco roba el foco, a diferencia del botón: nadie ha pulsado nada, y mover el
foco al entrar le quitaría el suyo a quien venga tabulando desde la barra. Y va
**una sola vez**, guardado por una referencia: ni al cambiar de año —eso es
mirar otro año a propósito— ni en la medianoche que reescribe `today`.

Si hoy no está en la rejilla que se pinta —se entró con `?year=` al otro año— no
pasa nada: no hay casilla, y no moverse es exactamente lo correcto.

### Varios recordatorios por día — tanda 9, septiembre de 2026

Un día podía tener **un** aviso y ahora puede tener hasta diez, cada uno con su
hora y su texto, y cada uno se edita, se tacha y se borra por separado. El aviso
sigue viviendo dentro de su día —no hay colección de recordatorios, y borrar el
día se los sigue llevando por delante—; lo que cambió es que `reminder?: Reminder`
pasó a ser `reminders?: Reminder[]`.

#### El cambio de verdad fue darle identidad al aviso

Hasta aquí la identidad de un recordatorio **era la clave de su día**: había uno,
así que `2026-03-14` lo nombraba sin ambigüedad. De eso vivían cuatro cosas
repartidas por el proyecto, y las cuatro se rompen a la vez en cuanto hay dos: la
reclamación del cron, la adopción de `sent` en `pull()`, los ayudantes de
escritura de `reminders.ts` y las claves de React. Dos avisos a la misma hora del
mismo día son legítimos, así que la hora tampoco servía de nombre.

Por eso cada `Reminder` lleva ahora un `id` —doce caracteres de `randomUUID`,
único dentro de su día y no más allá—, que pone `makeReminder`, que sigue siendo
el único sitio donde se crea uno. Al editar se conserva; al crear se genera.

La lista se guarda **ordenada por hora, y a igualdad de hora por `id`**. El orden
es al escribir y no al pintar, porque de eso vive `sameReminders`: compara
posición a posición, y si el orden dependiera de quien mira, dos listas iguales
podrían parecer distintas y cada repintado encolaría una subida vacía.

#### Campo nuevo, no el mismo con otro tipo

`reminders` se llama distinto que el `reminder` de antes a propósito. Cuesta lo
mismo y evita que, mientras queden documentos sin migrar, la consulta del cron
tenga que adivinar qué forma está mirando. Y trae el aviso que sigue:

> **El campo viejo no se borraba solo.** `days.ts` hace `$unset` de los opcionales
> que el cliente no manda, y esa lista se deriva de `WireDay` — justamente para
> que el compilador obligue a mantenerla. Pero un campo **retirado** del tipo
> desaparece también de la lista, así que nadie lo quitaría nunca del documento:
> un día ya subido conservaría su `reminder` para siempre, y bastaría con que
> algo volviera a mirarlo para que un aviso borrado hace meses sonara otra vez.
> De ahí `LEGACY_FIELDS`, que lo borra incondicionalmente. Anotado en la deuda
> para poder retirarlo cuando no queden documentos viejos.

#### Las dos trampas del cron, y una tercera que no se veía venir

**Primera: la notación de punto cruza elementos.** Sobre un array, tres
condiciones sueltas se satisfacen con elementos **distintos**. Escrito a pelo, un
día cuyo aviso de las 9:00 ya salió y cuyo aviso de dentro de tres meses sigue
sin enviarse cumpliría las tres a la vez y se daría por debido. Hace falta
`$elemMatch`, que exige que sea el mismo elemento el que cumple todo. No rompe
nada: solo manda avisos que no tocan, que es peor.

**Segunda: reclamar un elemento, no el documento.** La reclamación previa al
envío pasa a nombrar el `id` con `arrayFilters`, y lo mismo la liberación cuando
el envío falla. Sin eso, dos avisos vencidos del mismo día se pisarían: el fallo
de uno desmarcaría al vecino que sí salió.

**Tercera, y esta apareció midiendo: el índice parcial dejó de usarse.** El
índice sobre `reminders.at` es parcial (`$exists: true`), y para usar uno así el
planificador tiene que poder demostrar que la consulta implica ese filtro. Un
predicado metido dentro de `$elemMatch` no le vale para demostrarlo: medido
contra el servidor con 3 000 documentos, la consulta hacía **COLLSCAN completo y
ni siquiera consideraba el índice** — cero planes rechazados. Antes no pasaba
porque la consulta era `'reminder.at': {…}` en notación de punto, que sí lo
implica sola.

El arreglo es pedir la ventana **también** suelta arriba, junto al `$elemMatch`:

```js
{ 'reminders.at': ventana,               // por el índice; redundante para la corrección
  reminders: { $elemMatch: dueFilter },  // lo que de verdad filtra
  deleted: { $ne: true } }
```

De 3 002 documentos examinados a 2. La línea parece sobrar y no sobra, así que
está explicada donde se consulta: quitarla no rompe nada visible, solo hace que
cada pasada del cron recorra los días de todo el mundo.

#### Lo que cambió para quien lo usa

- **El campo del día es ahora una lista de filas** con «+ Añadir recordatorio».
  El interruptor de «Recordarme este día» desapareció: encenderlo era decir
  «quiero uno» —eso lo dice el botón— y apagarlo era quitarlo —eso lo dice la
  papelera de cada fila—.
- **Mover un aviso a un día que ya tiene otros ya no los pisa: se suma.** Es el
  cambio de comportamiento más visible, y el modal lo dice antes de guardar. Lo
  único que puede impedirlo es que el destino esté en el tope.
- **En la rejilla se resume y en la agenda se lista.** La casilla mide 40 px: una
  campana y, con más de uno, cuántos hay; las horas se leen en el popover (hasta
  tres) o en el modal. La fila de la agenda es ancha y enseña hasta tres chips
  con `+N`. En los dos sitios el texto para lector de pantalla las dice **todas**,
  que ahí no hay sitio que ahorrar.
- **En `/recordatorios`, solo la primera tarjeta de cada día enseña la fecha.**
  Cuatro tarjetas seguidas repitiendo «miércoles 14 de marzo» son ruido: lo que
  las distingue es la hora, que ya va en el chip. El `first` se recalcula después
  de partir en próximos y pasados, porque dos avisos del mismo día pueden caer
  uno a cada lado del corte.
- **Diez por día.** No es por peso —son unos cientos de bytes— sino de interfaz
  y de Telegram, que pide espera por encima de unos pocos mensajes por segundo al
  mismo chat, y los avisos de un mismo día pueden vencer todos a la vez.
- **Las pestañas de la agenda siguen contando días, no avisos.** «Recordatorios
  4» son cuatro días con algún aviso. La lista de debajo es de días, así que
  contar avisos no cuadraría con las filas que se ven.

#### La migración

`scripts/migrate-reminders.mjs`, con el de las imágenes como molde: idempotente,
reanudable, en dos escrituras por documento —primero `$set` de `reminders` y
**solo entonces** `$unset` del viejo—, sin tocar `updatedAt`, contando avisos por
usuario antes y después. Cortado a la mitad deja un documento con las dos cosas,
que es recuperable; al revés dejaría uno sin ninguna, que no lo es. De paso
retira el índice `reminder.at_1`, que ya no usa nadie.

**El orden contra producción es migrar *después* de desplegar**, igual que en la
tanda 8 y por lo mismo: el código nuevo lee las dos formas y el viejo no lee la
nueva.

Del lado del navegador no hace falta script. `sanitizeData` acepta el objeto
suelto al leer `localStorage`, así que el primer arranque lo convierte y la
primera edición lo sube; y el importador tampoco cambia, porque pasa por ahí —un
archivo v7, v6 o v4 se importa igual. La exportación sube a **v8**.

#### Lo que se probó

Treinta comprobaciones sobre las funciones puras —compatibilidad con la forma
vieja, orden y desempate, tope, alta/baja/mudanza, que `done` no toca a los
vecinos, ida y vuelta por el cable, `moveDay`, búsqueda y los `VALARM` del ICS—,
el renderizado de `ReminderField` y `DayCell` en servidor con cero, uno, varios y
el día lleno, y nueve comprobaciones **contra el servidor de verdad**, en una
colección desechable: que `$elemMatch` no cruza elementos, que la reclamación por
`arrayFilters` toca un solo aviso, que una segunda pasada no reclama dos veces,
que liberar tras un fallo no arrastra al vecino, que `updatedAt` no se mueve y
que el índice se usa.

#### Riesgos que quedan

- **La fusión sigue siendo por día**, no por aviso: dos dispositivos editando
  avisos distintos del mismo día sin sincronizar, y gana el `updatedAt` más
  reciente. Ya pasaba con la nota y el recordatorio, así que no es una
  regresión — pero con varios avisos es mucho más fácil de encontrar. La salida
  sería fusionar por `id` dentro del día, y eso es otra tanda.
- Un día con tres avisos vencidos a la vez manda **tres mensajes**. Son tres
  cosas distintas y juntarlas obligaría a inventar un formato de resumen; el
  manejo de `retryAfter` que ya había es lo que impide que eso se convierta en un
  problema.
- El `id` de un aviso migrado desde la forma vieja **se genera en cada
  dispositivo por su cuenta** hasta que uno lo suba. No rompe nada —la adopción
  de `sent` exige `id` *y* `at`, así que en el peor caso una marca no se adopta y
  se adopta en la vuelta siguiente— pero conviene saberlo antes de verlo.

### Una carpeta por persona en Cloudinary — septiembre de 2026

Los adjuntos colgaban de `uploads/users/{userId}/…` desde la tanda 8. La parte
que importaba —una subcarpeta por persona, nombrada por el `userId` de Better
Auth— ya estaba; lo que no estaba era poder decidir la raíz sin tocar el código.
Ahora sale del entorno, `CLOUDINARY_FOLDER`, y por defecto es `planificador`.

El cambio en la aplicación es una línea de `publicIdFor`. Lo demás es la
mudanza, y la mudanza tiene una trampa: **renombrar en Cloudinary cambia el
`public_id` y con él la URL**, así que lo que estuviera guardado apuntando al
nombre viejo deja de resolver. Mover los bytes sin reescribir la base sería
perder las imágenes de vista con todas ellas intactas en la nube.

En esta base eso es un campo, `images.publicId`, más la `version` —que también
cambia y entra en la firma—, y conviene saber por qué no es más:

- El `etag` **no** cambia: es el hash del contenido y los bytes son los mismos
  en otro sitio. De ahí que `days.thumb`, que desde la tanda 8 guarda ese hash y
  no una miniatura, no haya que tocarlo.
- Las referencias `cld:{publicId}@{etag}` que los navegadores tienen guardadas
  quedan viejas y no rompen nada: lo que se pinta se pide por `key`, `index` y
  `etag` —el `publicId` no aparece en `rawSrc`—, y el único sitio que lo mira,
  el `PUT` de `api/images.ts`, ya sabía no encontrar el documento de origen y
  responder con la referencia que hay ahora.

Y aquí llegó la parte que no se veía venir. Con los `public_id` ya movidos y las
URLs sirviendo, el panel seguía enseñando las siete imágenes en *Home* y la
carpeta `planificador` vacía. La cuenta está en `folder_mode: dynamic`, y con
carpetas dinámicas la carpeta del panel no la da el `public_id` sino un campo
aparte, `asset_folder`, que ni `upload` ni `rename` rellenan. Los bytes y las
URLs estaban bien desde el principio; lo que estaba vacío era ese campo. Se
arregla con `api.update` —que no toca el `public_id`, ni la `version`, ni los
bytes, así que esa mitad no escribe nada en Mongo— y en la subida mandando
`asset_folder` junto al `public_id`. De paso se pone `display_name`, porque el
panel lo saca del último tramo del `public_id` y sin él todas se llaman «0». El
script hace las dos mitades, en ese orden: primero renombra, después recoloca —
al revés calcularía la carpeta del nombre viejo.

`scripts/migrate-image-folders.mjs` es quien lo hace, con la API Admin y desde
el portátil. Renombra, apunta el documento, y cuenta antes y después. Lo
interesante es el fallo a mitad, que tiene dos formas y no se parecen:

- **Falla Cloudinary**: no se movió nada, el documento se queda como estaba y la
  imagen se sigue viendo desde su sitio de siempre.
- **Falla Mongo después de mover**: el documento nombra un sitio que ya no
  existe, que es la única forma de perder una imagen de vista. Se deshace el
  renombrado en el acto; y si tampoco se puede deshacer, la pasada siguiente lo
  recoge sola —un origen que no está y un destino que sí es exactamente eso— y
  escribe únicamente en Mongo.

Ese mismo camino es el que lo hace reanudable, así que ante la duda se vuelve a
lanzar. Y el orden del despliegue es el **contrario** al de la tanda 8: primero
el código, después la mudanza. Allí el código viejo leía los bytes de Mongo y
migrar antes dejaba todo sin verse; aquí cada imagen se sirve por el `publicId`
que tenga guardado, sea de la carpeta que sea, así que lo que aún no se haya
movido se sigue viendo igual.

---

---

### La paleta y las etiquetas llegan a la cuenta — tanda 11, septiembre de 2026

Cómo se llama y de qué tono es cada categoría, y qué etiquetas existen, vivían
solo en `localStorage`. El resultado era que el mismo calendario se veía
distinto en el móvil y en el portátil: allí «Entrega» en rosa oscuro, aquí
«Rosa». Ahora los dos viven en `settings`, la colección que existe justo para lo
que es de la persona y no del aparato — el chat de Telegram ya estaba ahí.

**Lo que no ha cambiado:** `localStorage` sigue siendo la copia local y sigue
mandando para pintar, así que no hay destello ni espera; la cuenta es de dónde
se traen y a dónde se llevan. Y las etiquetas que un día lleva **puestas** siguen
viajando dentro del día, que es donde tienen que estar: son contenido, no
configuración.

#### Van juntas, con una sola marca de tiempo, y no es `updatedAt`

La paleta y el catálogo comparten documento, petición y reloj. Son un puñado de
bytes, se editan en la misma pantalla y casi nunca; partirlos en dos documentos
y dos relojes habría sido más mecanismo del que el problema pide.

El reloj es `prefsAt`, **no** el `updatedAt` que ya tenía el documento, y la
razón es la misma que separa `sent` de `done` en un recordatorio: son dos cosas
con dos autores. `updatedAt` lo sube también el servidor —al marcar el bot como
bloqueado, por ejemplo—, y si fuera el árbitro, un bloqueo de Telegram haría que
las preferencias del servidor le ganaran a una edición local sin subir,
borrándola. Es exactamente el mismo cuidado que hace que el cron no toque
`updatedAt` al reclamar un aviso.

#### Ausente y vacío no son lo mismo

`tags: []` es un catálogo vacío **a propósito** y `tags` ausente es «aquí nunca
se eligió ninguno». La distinción ya existía en `localStorage` —es lo que impide
que las siete de fábrica resuciten en cuanto alguien las borre todas— y había
que llevarla intacta hasta Mongo, así que el campo se guarda como lista vacía en
vez de omitirse.

De ahí sale la diferencia más llamativa con `/api/days`: **allí un opcional
ausente se borra y aquí se respeta**. No es un descuido. En los días el
navegador manda siempre el día entero, así que una ausencia solo puede querer
decir que se ha quitado; aquí un dispositivo puede tener paleta y no haber
guardado nunca un catálogo, y borrar por eso el catálogo de la cuenta sería
tirar lo que alguien escribió en otro sitio.

#### El catálogo que se quedaba varado

Apareció razonando el orden, antes de escribir el `hook`, y habría perdido
datos de verdad. Un dispositivo sube solo la paleta —nunca tocó las etiquetas—
mientras otro tiene un catálogo propio de antes de esta tanda. El segundo
adopta la paleta del primero, y su catálogo se queda en local sin subir nunca…
hasta que el primero añade una etiqueta y se lo lleva por delante.

Por eso lo que falta se mira **campo a campo** y no en bloque: tras adoptar, si
queda algo aquí que la cuenta no conoce, se le pone marca y sube encima de lo
recién adoptado. Es media docena de líneas —`faltaEnLaCuenta` en `prefs.ts`— y
es la diferencia entre converger y perder el trabajo de un dispositivo.

#### Cómo está montado

`usePrefs` **compone** `usePalette` y `useTags` en lugar de sustituirlos:
aquellos siguen siendo quienes leen, escriben y aplican en este navegador, y
encima se añade el viaje. Así una página que solo pinta no cambia en nada y la
lógica de `localStorage` no se duplica.

Lo que el `hook` añade es una distinción que ya conocía `useCalendarStore`:
**adoptar no es editar**. Lo que baja se guarda sin ponerle marca nueva ni
encolarlo de vuelta; lo que toca la persona sí. Sin esa diferencia, bajar una
paleta la volvería a subir, y así en bucle.

`useSettings` es el único punto de entrada de las cuatro páginas, así que todo
esto cupo debajo de él sin tocar ninguna.

#### Lo que se probó

Diez comprobaciones con dos navegadores y un servidor de mentira, que es la
única forma de ver converger lo que por definición ocurre en dos sitios: la
migración de lo que ya había, un dispositivo nuevo que adopta, la ida y vuelta,
el catálogo vacío que no resucita, el empate que gana lo local, y el caso del
catálogo varado, que falla sin el arreglo de arriba.

#### Riesgos que quedan

- **La fusión es del documento entero**, no campo a campo: dos dispositivos
  editando preferencias distintas a la vez, y gana el más reciente. Se mitiga
  con el completado por campo del `pull`, pero solo en el arranque. Para unas
  preferencias que se tocan una vez cada varios meses parece el trato correcto.
- La exportación sigue llevando la paleta y el catálogo sin que el importador
  los lea. Ya estaba anotado y sigue igual; ahora molesta menos, porque lo que
  el importador no devuelve la cuenta sí lo conserva.

### Fusionar recordatorio a recordatorio — tanda 10, septiembre de 2026

La unidad de fusión era el **día**: entre dos versiones ganaba la del
`updatedAt` más reciente y la otra se perdía entera, con sus avisos dentro.
Bastaba con que dos dispositivos tocaran recordatorios **distintos** de la misma
fecha sin sincronizar en medio para que uno de los dos trabajos desapareciera.
Ya era así antes de la tanda 9 —pasaba entre la nota y el aviso— pero un día
tenía un recordatorio y ahora tiene hasta diez, así que la probabilidad se
multiplicó por diez.

Ahora los avisos se funden **uno a uno**. El resto del día —la nota, el color,
la marca, los adjuntos— se sigue arbitrando en bloque, y eso es a propósito: son
campos sueltos de una misma edición, y mezclarlos daría un día que nadie
escribió. Los avisos no: son una lista de cosas independientes, con identidad
propia desde la tanda 9, y ahí sí tiene sentido combinar.

#### Las dos piezas que faltaban

**Una marca por aviso.** `editedAt` en cada `Reminder`, puesta por
`makeReminder`. Cero significa «de antes de esta tanda»: pierde contra cualquier
edición con fecha, que es lo correcto.

Tiene un detalle que parece menor y no lo es: **si no cambia nada, la marca
tampoco**. `build()` en `ReminderField` llama a `makeReminder` en cada pintado
para saber qué emitiría esa fila; con un `Date.now()` sin condición, cada
repintado habría fabricado un aviso distinto, `sameReminders` habría visto un
cambio inexistente y la cola de sincronía habría girado para siempre.

**Lápidas por aviso.** Sin ellas, borrar un recordatorio en el móvil y abrir el
portátil —que aún lo tiene— lo resucitaría, porque desde el otro lado «ya no
está» y «nunca existió» se ven igual. Es la misma pieza que ya tenían los días.

Viven en un campo aparte del día, `removedReminders`, y no como una marca dentro
de la lista de avisos. Enterrar en la propia lista habría obligado a los quince
sitios que la recorren a acordarse de filtrar, y un fantasma en la rejilla por
un filtro olvidado es peor que el problema que resuelve. Se podan solas: noventa
días, y veinte por día como tope.

#### Dónde ocurre la fusión, y por qué no en el servidor

En el navegador, dentro de `pull()`, y esa fue la decisión de diseño de la
tanda. Lo que parecía natural era que el servidor combinara, pero `days.ts`
escribe el día entero o no escribe nada, y hacerlo combinar exigía un
`update` con canalización de agregación —o leer, mezclar y reintentar— para
resolver algo que el cliente ya tiene delante.

Con la fusión en `pull()` converge igual: cada dispositivo funde al arrancar,
sube el resultado, y el servidor sigue siendo un «gana el más reciente» que no
necesita entender de avisos. El cron tampoco cambia: `reminders` sigue siendo la
lista de los vivos.

Las reglas, por orden: se empareja por `id`; gana el `editedAt` mayor y un
empate lo gana lo local; la lápida gana al aviso si es posterior a su última
edición, y pierde si es anterior —eso es alguien que borró algo y lo volvió a
crear, y lo último que hizo manda—; y `sent` se adopta aparte, sin arbitrar
nada, porque lo escribe solo el servidor y el cron no toca `editedAt` al
marcarlo. Esa última regla vivía suelta en `pull()` desde la tanda 9 y ahora
está dentro de `mergeReminders`, donde le corresponde.

#### La marca que iba hacia atrás

Lo encontró la prueba de dos dispositivos, y es el hallazgo de la tanda.

Cuando la fusión saca algo que el servidor no tiene, hay que subirlo, y para eso
la marca del día tiene que superar la suya — `updatedAt + 1` si hace falta. Esa
marca puede quedar **un pelo por delante del reloj**. Y entonces la edición
siguiente, que escribía `Date.now()` a secas, nacía *por detrás* de lo que ese
mismo navegador acababa de subir: el filtro del servidor la descartaba y el
cambio se perdía sin decir nada.

En la prueba todo ocurría dentro del mismo milisegundo, pero no hace falta ir
tan deprisa: basta un reloj local atrasado respecto al de otro dispositivo. El
arreglo es que la marca de un día **nunca retroceda** —`bump` en `sync.ts`—, que
es lo que un registro de «gana el último» necesita para funcionar de verdad.
Cierra de paso toda una familia de fallos por desajuste de reloj que estaban ahí
desde el principio.

#### Lo que se probó

Cuarenta y una comprobaciones en tres bloques: dieciséis sobre el algoritmo de
fusión —empates, lápidas en los dos sentidos, resurrección por edición
posterior, adopción de `sent`, poda—, dieciséis de regresión sobre lo que la
tanda 9 dejó en pie, y nueve **extremo a extremo con dos navegadores y un
servidor de mentira**, que es la única forma de ver converger algo que por
definición ocurre en dos sitios. Ahí está la escena exacta que describía la
deuda: cada dispositivo edita un aviso distinto sin sincronizar, y los dos
trabajos sobreviven.

De esas nueve salió el fallo de la marca hacia atrás. Sin la prueba extremo a
extremo no se habría visto: cada pieza por separado era correcta.

#### Riesgos que quedan

- **Queda una carrera estrecha.** Si un dispositivo sube entre que el otro hace
  `pull` y hace `flush`, lo suyo se pierde: el segundo sube una fusión que no
  incluye lo que llegó en ese hueco. Es la carrera clásica de leer-modificar-
  escribir, y cerrarla pide que el servidor combine, que es justo lo que esta
  tanda decidió no hacer. La ventana son los milisegundos entre dos peticiones
  seguidas.
- **La poda puede resucitar.** Un dispositivo que lleve más de noventa días sin
  conectarse y traiga un aviso que alguien borró lo devolverá a la vida, porque
  su lápida ya no existe. Es el precio de que las lápidas no crezcan sin fin,
  que es la deuda que arrastran las de los días.
- El resto del día sigue fundiéndose en bloque. Es deliberado, no pendiente.

---

## Lo que falta

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

      **Resuelto el 14 de septiembre de 2026**, al tercer intento y esta vez
      con prueba. Antes estuvo marcada como resuelta sin estarlo, así que cómo
      se comprueba vale más que el resultado — y las dos formas obvias fallan:

      - **`/api/health` no sirve.** Lo que enseña en `auth` no es la variable:
        es `baseURL`, el valor que ya pasó por `publicOrigin()`, que es quien
        añade el esquema cuando falta. Con la variable mal puesta devuelve
        exactamente la misma cadena. La red de seguridad de `943751b` tapa la
        señal que se estaba buscando, y por ahí se coló el primer tick.
      - **Recargar la página tampoco.** El aviso `[auth] BETTER_AUTH_URL no
        traía esquema` sale de un `console.warn` en el cuerpo del módulo
        (`auth.ts`), así que se imprime **una vez por arranque en frío**, no
        por petición. Con la instancia caliente no aparece esté la variable
        como esté, y leer esa ausencia como «arreglado» sería el siguiente
        tick falso.

      Lo que sí vale: **redesplegar y cargar una página**, que garantiza
      instancia nueva — si el esquema faltara, la línea tendría que salir y no
      sale. O más simple, revelar el valor en *Settings → Environment
      Variables*, recordando que Production, Preview y Development son tres
      casillas distintas. Tras corregirla hay que **redesplegar**: editarla no
      la mete en la función que ya corre.

      El arranque en frío se reconoce por el `latencyMs` de `/api/health`:
      unos 60 ms en caliente, cientos o más de mil recién levantada.
- [x] *Network Access* de Atlas en `0.0.0.0/0`. Con la IP propia en lista
      blanca las funciones de Vercel no entran, y el síntoma despista: Atlas
      corta el saludo TLS y el driver lo reporta como `tlsv1 alert internal
      error`, que no se parece en nada a un problema de permisos.

Pendiente:

- [ ] `trustedOrigins` en `auth.ts` si se usan despliegues de vista previa: su
      URL no coincide con `BETTER_AUTH_URL` y el login devuelve `403`.
- [ ] Campo `engines` en `package.json`: local es Node 26, Vercel usa la 24.
- [x] Las variables de Telegram y el `CRON_SECRET` en el panel. Hay que
      reiniciar `astro dev` tras declararlas en `astro.config.mjs`, o llegarán
      vacías — y **en Vercel hay que volver a desplegar**: editar una variable
      en el panel no la mete en la función que ya está corriendo.
- [x] El programador externo, con `CRON_SECRET` y la URL del endpoint. Está en
      cron-job.org; ver *Quién llama al cron* en el historial.
- [ ] **Las tres variables de Cloudinary en el panel**, y **redesplegar**:
      editar una variable no la mete en la función que ya está corriendo. Sin
      ellas el sitio arranca y se cae en cuanto alguien abra una nota con
      imágenes. `CLOUDINARY_URL` no hace falta — ver *Variables de entorno*.
- [x] Correr `scripts/migrate-images.mjs` **justo después** de desplegar, no
      antes. El orden importa y no es el que parece: el código viejo lee los
      bytes de `images`, así que migrar primero deja todas las imágenes sin
      verse hasta que suba el código nuevo; al revés, el nuevo convive con lo
      que quede sin migrar —lo omite en `GET /api/images` y el proxy contesta
      404— y solo falta lo que aún no ha subido.

### Deuda conocida

- [ ] Cambiar un adjunto reenvía los seis del día. Con seis como tope y
      ediciones contadas, comparar cuáles cambiaron costaría más de lo que
      ahorra — y desde la tanda 8 cuesta mucho menos, porque los que ya estaban
      arriba viajan como referencia y no como bytes. Pero está ahí.
- [ ] Las lápidas no se purgan nunca. Sobra sitio, pero crecen sin fin.
- [ ] **El tema claro no llega a AA en varios pares, y es anterior al oscuro.**
      Medido: `ink-muted` sobre `canvas` da 2,46:1, `text-highlight` sobre
      `canvas` 3,05:1 y sobre `highlight-soft` 2,86:1, con 4,5:1 de mínimo para
      texto normal. El oscuro sí pasa entero —de 5,3:1 para arriba— porque se
      eligió con la medida delante. Arreglar el claro es oscurecer esos tres
      tonos, pero cambia el aspecto de la aplicación y por eso no se hizo de
      paso: es una decisión de diseño, no una corrección.
- [x] **La paleta no llegaba a la cuenta**, así que el mismo calendario se veía
      con categorías distintas en el móvil y en el portátil. Resuelto en la
      tanda 11: vive en `settings`, que existe justo para lo que no es de este
      dispositivo.
- [ ] La exportación lleva la paleta y el catálogo de etiquetas (`palette` y
      `tags`, v6) pero el importador solo lee `days`: reimportar un archivo no
      devuelve ni los nombres, ni los tonos, ni las etiquetas que existían. Las
      que lleven los días sí vuelven, porque van dentro del día.
- [x] El catálogo de etiquetas tampoco llegaba, con el mismo arreglo. Resuelto
      en la misma tanda y por la misma vía: comparten documento y marca de
      tiempo, porque se editan en la misma pantalla.
- [ ] **La marca sigue diciendo «Planificador 2026»**: en la barra, en el título
      de las cinco páginas, en la descripción del `<head>` y en el nombre de los
      archivos que exporta `transfer.ts`. El calendario ya cubre dos años, así
      que el rótulo se quedó corto. Es un renombrado y no una corrección, y por
      eso no se hizo de paso.
- [ ] El plegado de los meses vive en `localStorage` y no llega a la cuenta, con
      el mismo arreglo que la paleta y el catálogo. Duele poco —es la forma de
      una vista, no contenido—, pero desde que hay dos años son veinticuatro
      casillas en vez de doce.
- [ ] No hay recuperación de contraseña: haría falta un servidor de correo.
- [ ] `IMAGE_ACTION` en `DayModal.tsx` no se usa. Anterior a esta sesión.
- [ ] Dar por hecho un aviso que el servidor acaba de marcar como enviado —sin
      que este navegador se haya enterado todavía— sube el día sin ese `sent` y
      borra la marca en Mongo. No se reenvía, porque `done` también excluye del
      cron, pero el día pierde el rastro de que salió. Es el mismo agujero que
      cualquier otra edición local hecha entre el envío y la siguiente lectura.
- [ ] El borrador del modal se reinicia si el día cambia de identidad mientras
      está abierto —que es lo que pasa cuando llegan sus imágenes—. Afecta por
      igual a la nota, al color y a los recordatorios; es anterior a la tanda 9
      y se arregla comparando valores en vez de reaccionar al objeto.
- [ ] La galería descarga en serie todas las imágenes que falten, sin límite ni
      desalojo. Con muchas notas conviene paginar. La tanda 8 lo alivió —lo que
      baja son referencias, y los bytes los cachea el navegador— pero no lo
      arregla: sigue faltando paginar, y ahora cada miniatura es además una
      invocación de la función la primera vez.
- [ ] Un `destroy` que falle deja la imagen huérfana en Cloudinary: se traga el
      error a propósito, porque tumbar el borrado del día por eso sería peor.
      Haría falta un repaso que liste el prefijo de cada persona y borre lo
      que no tenga documento en Mongo. `migrate-image-folders.mjs` ya hace la
      mitad: al terminar lista lo que queda fuera de la carpeta nueva. Falta
      que mire también dentro y que sepa borrar.
- [ ] La exportación (v7) ha dejado de ser una copia completa: lleva
      referencias, no imágenes. Para que lo siga siendo hay que bajar los bytes
      por el proxy al exportar.
- [ ] Una lápida borra los adjuntos del día **desde el navegador que lo borró**:
      es él quien encola el recorte. Si ese navegador no vuelve a conectarse,
      las imágenes se quedan en Cloudinary sin día que las reclame.
- [ ] **La vinculación de Telegram no escala más allá de unas pocas personas.**
      Para reconocer el `/start` se leen los mensajes recientes del bot con
      `getUpdates` y se busca el código, pero **no se confirman**: confirmarlos
      los borra de la cola de Telegram y dos personas vinculando a la vez se
      pisarían. El precio es que solo se miran los **100 más recientes** de las
      últimas 24 horas, así que con mucha gente vinculando el mismo día, a
      alguien no se le encontraría su `/start`. Con dos o cinco usuarios da
      igual. El arreglo es un webhook, y entonces hay que cambiar las dos cosas
      a la vez, porque con webhook puesto `getUpdates` contesta 409.
- [ ] Quitar a alguien de la `allowlist` **no** le cierra la cuenta ni las
      sesiones: solo impide que ese correo vuelva a registrarse. Para echar a
      alguien de verdad haría falta borrar su usuario y sus sesiones, y hoy eso
      es un trabajo a mano contra Mongo.
- [x] **`LEGACY_FIELDS` en `days.ts`**, que borraba el `reminder` viejo en cada
      escritura. Retirado el 14 de septiembre de 2026, el mismo día que entró:
      la base ya no tenía ni un documento con el campo singular —0 de 63— y no
      puede volver a tenerlo, porque `sanitizeWireDay` construye el día desde
      cero en el servidor y nunca emite ese nombre. Ni un navegador con el
      paquete viejo en caché lo reintroduciría. El porqué de que existiera queda
      en el historial de la tanda 9, que es donde toca.
- [x] **La fusión era por día, no por aviso**, así que dos dispositivos
      editando avisos distintos del mismo día perdían uno de los dos trabajos.
      Resuelto en la tanda 10: los avisos se funden uno a uno por su `id`. El
      resto del día se sigue arbitrando en bloque, y eso es deliberado.

---

## Invitar a alguien

El registro está cerrado con lista de invitados (ver *Más de una persona*). Dar
acceso son dos cosas: meter su correo en la lista, y que esa persona se cree la
cuenta ella misma.

### 1 · Añadir el correo

Desde la carpeta del proyecto, en tu máquina:

```bash
node --env-file=.env scripts/allowlist.mjs add ana@ejemplo.com "Ana, del trabajo"
node --env-file=.env scripts/allowlist.mjs            # comprobar que quedó
```

La nota es opcional y solo sirve para que dentro de un año se sepa quién es.

Apunta a la **misma base que usa el sitio desplegado**, así que surte efecto de
inmediato: invitar a alguien no necesita volver a desplegar.

### 2 · Que se registre

Se le manda <https://planificador.danielvasquez.lat> y tres indicaciones:
pulsar **Crear cuenta**, poner **ese mismo correo**, y una contraseña de **ocho
caracteres o más**. Las mayúsculas dan igual: el correo se normaliza en los dos
lados antes de compararlo.

Si se equivoca de correo verá «Este correo no tiene invitación para crear una
cuenta» y no ocurrirá nada más.

**La contraseña la elige quien se registra.** Nadie más la pone ni la ve.

### 3 · Sus recordatorios, si los quiere

Ajustes → *Recordatorios por Telegram* → abrir el chat del bot → **Start** →
volver y *Comprobar conexión*.

No tiene que crear ningún bot ni conseguir ningún token: el bot es de la
aplicación. Lo único suyo es el chat.

### Lo que verá

Un calendario vacío y **completamente aparte**. No ve los días, las notas ni las
imágenes de nadie más, y sus avisos van solo a su Telegram. `userId` sale
siempre de la sesión, así que el aislamiento no depende de acordarse de filtrar
en cada consulta.

### Dos cosas que hay que decirle, y una que no hace lo que parece

- **No hay recuperación de contraseña.** No hay servidor de correo a donde
  mandarla. Si la olvida, arreglarlo es trabajo a mano contra Mongo. Conviene
  avisar al invitar, no después.
- **Quitar a alguien de la lista no le cierra la cuenta** ni sus sesiones: solo
  impide que ese correo vuelva a registrarse. Echar a alguien de verdad es
  borrar su usuario y sus sesiones a mano. Está en *Deuda conocida*.
- Quien **ya tiene cuenta** entra aunque no esté en la lista. El script lo
  enseña aparte justamente por eso: una lista que parece completa sin serlo
  engaña más que no tenerla.

---

## Que siga funcionando

Nada de esto necesita vigilancia diaria, pero **tres cosas se apagan solas** y
ninguna avisa por su cuenta si no se lo pides. Este apartado es para no
descubrirlo el día que hagas falta un recordatorio.

### Lo que se apaga solo

| Qué | Cuándo | Cómo te enteras |
|---|---|---|
| El job de cron-job.org | Tras **25 fallos seguidos** — con intervalo de 5 min, unas **2 horas** de caída | Solo si activas el aviso por correo |
| El clúster de Atlas | Tras **30 días sin ninguna conexión** | No avisa: el sitio deja de responder |
| El workflow de GitHub | Tras **60 días sin commits** en el repositorio | Correo de GitHub |

**Y encadenan.** Es lo que más conviene entender: si el job de cron-job.org se
desactiva y además nadie abre el calendario durante un mes, Atlas se pausa por
inactividad —porque el cron era justo lo que lo mantenía despierto, con una
conexión cada cinco minutos— y entonces no funciona ya nada. Cada eslabón es
silencioso por separado.

Las 2 horas del primero son el número peligroso: **un despliegue que rompa el
endpoint y no se arregle esa misma tarde deja el cron desactivado para
siempre**, y los recordatorios dejan de salir sin que nada lo diga. El caso más
fácil de provocar es rotar `CRON_SECRET` en Vercel y olvidarse de cambiarlo en
cron-job.org: a partir de ahí todo son 401 y en dos horas el job está muerto.

### Enciende los avisos y olvídate

Es la diferencia entre monitorizar y no tener que hacerlo.

- [ ] **cron-job.org → el job → notificaciones.** Activa *notify on failure* y
      *notify on disable*. Con el umbral en 2 o 3 fallos te enteras de una
      caída de verdad sin que un fallo suelto te despierte.
- [ ] **Vercel → Settings → Notifications.** Que avise de despliegues fallidos.
- [ ] **Atlas → Alerts.** Trae alertas de fábrica; comprueba que el correo de
      destino es uno que leas.

Con eso, el único caso que no te llega por correo es que cron-job.org se caiga
entero. De ahí lo de abajo.

### Comprobación rápida cuando sospeches

```bash
# ¿responde el endpoint? (401 es correcto: significa vivo y protegido)
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H 'content-type: application/json' \
  https://planificador.danielvasquez.lat/api/cron/reminders

# ¿alcanza Atlas la función desplegada?
curl -s https://planificador.danielvasquez.lat/api/health
```

Y en cron-job.org, el historial del job: si la última ejecución correcta es de
hace horas, ahí está el problema. Un recordatorio de prueba a dos minutos vista
confirma la cadena entera.

La forma más rápida de saber por qué un aviso no salió es mirar la respuesta del
cron: `due` dice cuántos tocaban, `sent` cuántos salieron y `sinDestino` cuántos
no tenían chat vinculado.

### La copia de seguridad

**El plan gratuito de Atlas no hace copias.** Ninguna. Si se borra la base, se
borró.

Contra eso está el propio diseño —cada navegador guarda su copia completa en
`localStorage`, así que el calendario sobrevive a perder el servidor— pero desde
la tanda 8 **eso ya no vale para las imágenes**: sus bytes están en Cloudinary y
en el navegador solo queda la referencia. Tampoco cubre tener dos dispositivos
desincronizados.

- [ ] Exportar el JSON desde Ajustes de vez en cuando, y guardarlo fuera del
      portátil. Es un archivo pequeño y es la única copia de verdad que hay.
- [ ] Para algo más completo: `mongodump` contra la URI de producción. Ojo con
      lo que **no** entra ahí: los adjuntos ya no están en Mongo, y recuperar un
      volcado sin la nube dejaría días que dicen tener imágenes que no existen.

### Los techos del plan gratuito

Medido hoy, con 52 días guardados, 3 imágenes y 2 usuarios:

| Límite de Atlas | Tope | Ahora |
|---|---|---|
| Almacenamiento | 512 MB | **0,5 MB** (0,1 %) |
| Transferencia | 10 GB por cada 7 días | lejísimos |
| Operaciones | 100 por segundo | el cron hace una consulta cada 5 min |
| Conexiones | 500 | una por función caliente |

Sobra sitio por varios órdenes de magnitud, y desde la tanda 8 sobra más: los
adjuntos ya no ocupan en Atlas. Lo que crece sin freno son las **lápidas** —13
de 52 días ya lo son—, que están en *Deuda conocida*. Con este ritmo tardarían
años en molestar.

El plan gratuito de Cloudinary va por **créditos** (25 al mes, y un crédito son
1 GB de almacenamiento, 1 GB de tráfico o 1.000 transformaciones). Lo que se
gasta aquí es casi todo tráfico, y el proxy lo paga dos veces por imagen y
dispositivo — una sola vez gracias a la caché `immutable`. Con adjuntos de menos
de 700 KB y uso personal, ni se roza.

En cron-job.org: 30 segundos de tope por ejecución y lee como mucho 64 KB de
respuesta. El endpoint contesta en menos de un segundo y devuelve cuatro
números, así que no hay nada que vigilar ahí.

### Un repaso cada tres meses

- [ ] ¿Sigue activo el job en cron-job.org, y sus últimas ejecuciones en verde?
- [ ] Exportar el JSON y guardarlo fuera.
- [ ] Mirar el almacenamiento en Atlas por si algo creció de forma rara, y los
      créditos de Cloudinary en su panel.
- [ ] Si el secreto va en la URL —hoy sí—, rotarlo: nuevo valor en Vercel,
      **redesplegar**, y actualizar la URL del job. En ese orden, o el job
      empieza a fallar y en dos horas se desactiva.

---

## Trampas que ya nos han mordido

**En Cloudinary, la carpeta no es el `public_id`.** Esta cuenta está en
`folder_mode: dynamic`, y con carpetas dinámicas el `public_id` es solo el
identificador con el que se pide el archivo: las barras que lleva dentro son
caracteres, no carpetas. En qué carpeta sale en el panel lo dice un campo
aparte, `asset_folder`, que **ni `upload` ni `rename` rellenan solos**. El
síntoma es desconcertante porque todo lo que importa está bien: la mudanza dejó
las siete imágenes con su `public_id` en `planificador/…`, las URLs firmaban y
se veían — y las siete seguían apareciendo en *Home*, con la carpeta
`planificador` creada y vacía al lado. Se arregla mandando `asset_folder` en la
subida y, para lo ya subido, con `api.update`, que no toca el `public_id` ni la
`version` ni los bytes: por eso recolocar no escribe nada en Mongo. Dos avisos
más: el parámetro se llama `asset_folder` y no `folder`, porque `folder`
significa cosas distintas en cada modo —en el fijo se antepone al `public_id` y
dejaría `planificador/planificador/…`—; y el `display_name`, que es el nombre
que saca el panel, sale del último tramo del `public_id`, así que sin ponerlo a
mano todas las imágenes de una persona se llaman «0». Para saber en qué modo
está una cuenta: `cloudinary.api.config({ settings: true })`.

**Una marca de «gana el último» tiene que ser monótona, o retrocede.** La marca
de un día se escribía con `Date.now()`, y eso basta hasta que algo la sella por
delante del reloj — la fusión de avisos la sube a `updatedAt + 1` para poder
ganarle al servidor. A partir de ahí, la edición siguiente nace *por detrás* de
lo que ese mismo navegador acaba de subir, el filtro del servidor la descarta y
el cambio se pierde **sin error, sin aviso y sin rastro**. Lo mismo ocurre, sin
ningún sellado raro, en cuanto dos relojes van desacompasados. La marca no puede
bajar nunca: `bump` en `sync.ts`.

**Un índice parcial no se usa si la consulta no *demuestra* su filtro.** El
índice sobre `reminders.at` es parcial (`$exists: true`), y el planificador solo
lo considera si puede probar que la consulta implica eso. Un predicado metido
dentro de `$elemMatch` **no le vale como prueba**: la consulta del cron, escrita
solo con `$elemMatch`, hacía COLLSCAN de la colección entera y ni siquiera
consideraba el índice — cero planes rechazados, 3 002 documentos examinados donde
debían ser 2. Se arregla repitiendo el rango suelto en notación de punto junto al
`$elemMatch`; es redundante para la corrección y es lo único que hace elegible el
índice. No se ve en las pruebas ni en el navegador: solo en `explain`, y solo si
se mira.

**Sobre un array, las condiciones sueltas se satisfacen con elementos
distintos.** `{'reminders.at': {…}, 'reminders.sent': {$exists: false}}` encuentra
el día cuyo aviso A cae en la ventana y cuyo aviso B, de dentro de tres meses,
sigue sin enviarse: son dos elementos y cada uno cumple una condición. Para exigir
que sea el mismo hace falta `$elemMatch`, y para escribir en ese mismo,
`arrayFilters`. El fallo no rompe nada visible; solo manda avisos que no tocan, a
la hora a la que la gente los lee.

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

La misma trampa estaba esperando en Cloudinary, y esta vez se esquivó antes de
morder: el SDK se configura solo con `CLOUDINARY_URL` **leyéndola de
`process.env`**, así que habría funcionado en producción y no en `astro dev`.
Por eso esa variable no se usa —puede estar en el `.env` o no, da igual— y las
tres piezas se declaran por separado en `astro:env` y se pasan a
`cloudinary.config()` a mano.

**Renombrar en Cloudinary no cambia la `version`.** Parece un detalle y decide
si una caché de un año sirve la imagen correcta: si el testigo de la URL fuera
la versión, correr una imagen de la posición 1 a la 0 dejaría la misma
dirección apuntando a otro contenido cuando las dos se hubieran subido en el
mismo segundo. Por eso la referencia lleva el `etag`, que es el hash de los
bytes. Se descubrió probando contra la nube de verdad, no leyendo la
documentación.

**Un campo que desaparece no es lo mismo que un campo que no viaja.** `$set` no
borra lo que no le mandas, y los opcionales de `WireDay` se omiten cuando están
vacíos: apagar un recordatorio, quitar todas las imágenes de un día o —la que
más caro salió— **borrar un día y volver a crearlo** dejaban el valor anterior
pegado en Mongo. El día resucitado se quedaba con `deleted: true` en el
servidor mientras el navegador lo daba por vivo: el cron no le mandaba el aviso,
y abrir el calendario en otro dispositivo lo habría borrado sin decir nada.

Ha pasado dos veces, así que ya no depende de acordarse: `OptionalWireKey` sale
del propio tipo y los campos a limpiar son las claves de un
`Record<OptionalWireKey, true>` en `days.ts`. Añadir un opcional al cable y no
cubrirlo ahí **no compila**. Para comprobar que la red sigue puesta, añade un
campo opcional de mentira a `WireDay` y mira que `npx astro check` lo nombre.

**Astro rechaza el POST del cron si no lleva `content-type: application/json`.**
La protección contra CSRF viene encendida de fábrica y bloquea cualquier POST
cuyo tipo de contenido sea de los que un navegador puede mandar entre sitios sin
preflight: formulario, texto plano y —esto es lo que muerde— **ninguno**. Un
`curl -X POST` pelado, que es justo lo que configura cualquiera en un cron,
recibe `403 Cross-site POST form submissions are forbidden`, que no menciona ni
el cron ni la cabecera ni el tipo de contenido. Con el `content-type` puesto
pasa, incluso con un `Origin` ajeno: quien guarda la ruta es el secreto, no esa
comprobación.

**Una comilla sin cerrar en el `.env` acusa a la variable equivocada.** El
token del bot estaba escrito como `TELEGRAM_BOT_TOKEN="123:AAF…` sin la comilla
final, así que el parser siguió leyendo hasta encontrar la siguiente comilla
—dos líneas más abajo— y se tragó dentro del token el comentario y la línea de
`TELEGRAM_BOT_USERNAME`. El síntoma era «falta TELEGRAM_BOT_USERNAME», que
manda a mirar la línea que **sí** estaba bien. Para comprobarlo sin enseñar el
valor:

```bash
node --env-file=.env -e 'const t=process.env.TELEGRAM_BOT_TOKEN;
  console.log(t?.length, /^\d+:[\w-]+$/.test(t ?? ""))'
```

Un token del bot son 46 caracteres. Si salen 145, hay una comilla suelta.

**La hoja de arranque de los meses tiene que entender el formato viejo.** Ese
script existe para que un mes plegado no se vea abrirse y cerrarse mientras React
hidrata, y corre **antes que cualquier módulo**: no puede importar nada, así que
lo que necesite saber hay que pasárselo por `define:vars`. Al meter el año en la
clave del plegado, lo guardado seguía en el formato anterior hasta que React
volviera a escribirlo, y un script que solo entendiera el nuevo habría pintado
abierto —durante un fotograma— justo lo que estaba plegado: habría provocado el
destello que es su único motivo de existir. Cualquier cambio en el formato de
`EXPANSION_KEY` hay que reflejarlo **en los dos sitios**, y la comprobación de la
clave no es cosmética: acaba dentro de un selector CSS.

**Astro no enruta los archivos que empiezan por `_`.** `src/pages/_algo.astro` es
privado por convención y devuelve 404 sin decir por qué. Muerde al dejar una
página de sondeo con un nombre que parezca interno.

**Tocar `astro.config.mjs` obliga a reiniciar el servidor.** El esquema de
`astro:env` se lee al arrancar; sin reinicio las variables llegan vacías.

**El aviso de npm sobre `esbuild` al desplegar no rompe nada.** npm 11.6+ pide
autorizar los `postinstall`; está concedido en `allowScripts` de
`package.json`, sin anclar a versión para que no vuelva a preguntar en cada
actualización. Si aparece de nuevo con otro paquete:
`npm approve-scripts <pkg> --no-allow-scripts-pin`.

## Trabajar en el proyecto

Quién puede crearse una cuenta:

```bash
node --env-file=.env scripts/allowlist.mjs                  # ver la lista
node --env-file=.env scripts/allowlist.mjs add ana@ejemplo.com "nota"
node --env-file=.env scripts/allowlist.mjs remove ana@ejemplo.com
```

Enseña también quién tiene cuenta sin estar en la lista, que es el caso que
despista: esas personas siguen entrando, porque el candado es del registro y no
de la puerta.

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

claude --resume fc11cb31-643a-473d-a8ab-6088e0fe5180