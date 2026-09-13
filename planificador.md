# Planificador 2026

Calendario anual con notas, colores, imágenes adjuntas y recordatorios diarios
por Telegram. Astro + React, MongoDB Atlas, desplegado en Vercel; las imágenes
van camino de Cloudinary (tanda 8).

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
| `src/lib/reminders.ts` | La lista: recoger, ordenar, filtrar y escribir avisos |
| `src/components/useCalendarStore.ts` | El calendario y su sincronía, para toda página que escriba |
| `src/pages/recordatorios.astro` | La lista de recordatorios |
| `src/pages/agenda.astro` | La agenda del año y las cuentas del calendario |
| `src/lib/telegram.ts` | El bot: enviar, leer `getUpdates`, clasificar fallos |
| `src/pages/api/telegram.ts` | Vincular, comprobar, probar y desvincular |
| `src/pages/api/cron/reminders.ts` | Lo dispara el programador externo |
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
| `settings` | Ajustes que no son de este dispositivo: hoy, el chat de Telegram | `{userId}` único |
| `allowlist` | Qué correos pueden **crearse** una cuenta. No afecta a quien ya la tiene | `{email}` único |
| `images` | Una imagen por documento, con su posición. Hoy guarda la imagen entera como data URL; la tanda 8 deja aquí solo la referencia a Cloudinary | `{userId, key, index}` único |

`userId` se guarda como **ObjectId**, no como cadena.

Los meses plegados **no** suben: son preferencia de este dispositivo y se
quedan en `localStorage`.

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

### Variables de entorno

`.env` en local (ignorado por git), panel de Vercel en producción. Ver
`.env.example`.

| Variable | Nota |
|---|---|
| `MONGODB_URI` | Si la ruta trae nombre de base, manda esa |
| `MONGODB_DB` | Opcional. Manda sobre la anterior |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32`. **Distinta en producción** |
| `BETTER_AUTH_URL` | Origen público **con esquema** y sin barra final |

Las de los recordatorios son **opcionales**, al revés que las de arriba: sin
ellas el calendario funciona entero y solo deja de haber avisos. Obligatorias
tumbarían el sitio por una función accesoria.

| Variable | Nota |
|---|---|
| `TELEGRAM_BOT_TOKEN` | El bot es de la aplicación, no de cada persona. **Nunca a Mongo** |
| `TELEGRAM_BOT_USERNAME` | El `@algo_bot`. No es secreto: va dentro del enlace |
| `CRON_SECRET` | Cabecera que autoriza `POST /api/cron/reminders` |

Las que traerá la tanda 8, todas de servidor y todas `secret`:

| Variable | Nota |
|---|---|
| `CLOUDINARY_CLOUD_NAME` | El nombre de la nube, a secas |
| `CLOUDINARY_API_KEY` | Pública en la práctica, pero no hace falta que salga del servidor |
| `CLOUDINARY_API_SECRET` | Firma las URLs y las subidas. **Nunca al navegador** |

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

Va sin número a propósito: la tanda 8 —las imágenes en Cloudinary— sigue sin
hacerse, y numerar esta como la 9 daría a entender que sí.

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
`aria-label`, que es lo único que sigue en pie cuando el texto se va; el rótulo
del indicador de sincronía pasa a `sr-only`, no a `display:none`, porque un
`role="status"` sin texto no tendría nada que anunciar justo en las pantallas
donde menos sitio hay para enterarse de otro modo; y los rótulos de los
contadores ya vivían en su `<dt>`.

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
modal del día porque el modal estaba ahí al lado; desde otra página el camino es
el que ya usaban «Ver nota» en la galería y «Ver en el calendario» en los
recordatorios. Editar un día entero sigue siendo cosa de su modal, y ese vive
donde está la rejilla.

Las dos cuentas —días marcados y notas guardadas— se fueron con ella. Estaban en
la cabecera de la portada, que es donde menos falta hacían: encima de una rejilla
que ya enseña de un vistazo cuántos días llevan color. Junto a la lista de la que
salen sí dicen algo, y la cabecera del calendario se queda con lo que solo sirve
allí: ir a hoy, el estado de la sincronía y el plegado de los meses.

`AgendaPanel` pasó a llamarse `AgendaList`: dejó de ser un panel dentro de otra
página el día que tuvo la suya.

## Lo que falta

### Tanda 8 · Multimedia en Cloudinary

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
- [ ] `BETTER_AUTH_URL` **con `https://` delante**. Sin esquema lanza por dos
      sitios distintos —el servidor y el cliente— y ambos están cubiertos por
      código, pero la variable debe estar bien puesta igualmente.

      **Sigue mal puesta en Vercel.** Estaba marcada como resuelta y no lo
      estaba: los registros del cron traen `[auth] BETTER_AUTH_URL no traía
      esquema; se asume https://…`. No rompe nada —para eso está la red de
      seguridad de `943751b`— pero es depender de ella en vez de tener la
      variable bien.
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
- [ ] Las tres variables de Cloudinary en el panel, cuando llegue la tanda 8.

### Deuda conocida

- [ ] Las miniaturas viajan dentro de `GET /api/days`. La actual pesa 5 KB y el
      tope son 20 KB: un año con imagen todos los días serían ~1,8 MB por carga.
      Irreal para uso personal, pero si se acerca, basta bajar `THUMB_SIDE` de
      192 a 128 o servirlas aparte. **La tanda 8 lo retira**: la miniatura pasa
      a ser una derivada y deja de viajar.
- [ ] Cambiar un adjunto reenvía los seis del día. Con seis como tope y
      ediciones contadas, comparar cuáles cambiaron costaría más de lo que
      ahorra — pero está ahí.
- [ ] Las lápidas no se purgan nunca. Sobra sitio, pero crecen sin fin.
- [ ] `localStorage` sigue guardando la copia completa con imágenes, así que su
      cuota sigue siendo un techo. `MAX_DATA_URL_LENGTH` (700 KB) se dimensionó
      para esa cuota y ahora podría subir. **La tanda 8 lo retira**, a cambio de
      que las imágenes dejen de verse sin conexión.
- [ ] No hay recuperación de contraseña: haría falta un servidor de correo.
- [ ] `IMAGE_ACTION` en `DayModal.tsx` no se usa. Anterior a esta sesión.
- [ ] Dar por hecho un aviso que el servidor acaba de marcar como enviado —sin
      que este navegador se haya enterado todavía— sube el aviso sin `sent` y
      borra esa marca en Mongo. No se reenvía, porque `done` también excluye del
      cron, pero el día pierde el rastro de que salió. Es el mismo agujero que
      cualquier otra edición local hecha entre el envío y la siguiente lectura.
- [ ] El borrador del modal se reinicia si el día cambia de identidad mientras
      está abierto —que es lo que pasa cuando llegan sus imágenes—. Afecta por
      igual a la nota, al color y ahora al recordatorio; es anterior a esta
      tanda y se arregla comparando valores en vez de reaccionar al objeto.
- [ ] La galería descarga en serie todas las imágenes que falten, sin límite ni
      desalojo. Con muchas notas conviene paginar. La tanda 8 lo alivia —el
      navegador cachea lo servido por el proxy y ya no hay que guardarlo— pero
      no lo arregla: sigue faltando paginar.
- [ ] *(tanda 8)* Un `destroy` que falle deja la imagen huérfana en Cloudinary.
      Haría falta un repaso que liste el prefijo `uploads/users/{userId}` y
      borre lo que no tenga documento en Mongo.
- [ ] *(tanda 8)* La exportación de `transfer.ts` deja de ser una copia
      completa: para que lo siga siendo hay que bajar las imágenes al exportar.
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
`localStorage`, así que el calendario sobrevive a perder el servidor— pero eso
deja de ser cierto para las imágenes en cuanto llegue la tanda 8, y no cubre
tener dos dispositivos desincronizados.

- [ ] Exportar el JSON desde Ajustes de vez en cuando, y guardarlo fuera del
      portátil. Es un archivo pequeño y es la única copia de verdad que hay.
- [ ] Para algo más completo: `mongodump` contra la URI de producción.

### Los techos del plan gratuito

Medido hoy, con 52 días guardados, 3 imágenes y 2 usuarios:

| Límite de Atlas | Tope | Ahora |
|---|---|---|
| Almacenamiento | 512 MB | **0,5 MB** (0,1 %) |
| Transferencia | 10 GB por cada 7 días | lejísimos |
| Operaciones | 100 por segundo | el cron hace una consulta cada 5 min |
| Conexiones | 500 | una por función caliente |

Sobra sitio por varios órdenes de magnitud. Lo que crece sin freno son las
**lápidas** —13 de 52 días ya lo son— y las imágenes en `localStorage`; las dos
están en *Deuda conocida*. Con este ritmo tardarían años en molestar.

En cron-job.org: 30 segundos de tope por ejecución y lee como mucho 64 KB de
respuesta. El endpoint contesta en menos de un segundo y devuelve cuatro
números, así que no hay nada que vigilar ahí.

### Un repaso cada tres meses

- [ ] ¿Sigue activo el job en cron-job.org, y sus últimas ejecuciones en verde?
- [ ] Exportar el JSON y guardarlo fuera.
- [ ] Mirar el almacenamiento en Atlas por si algo creció de forma rara.
- [ ] Si el secreto va en la URL —hoy sí—, rotarlo: nuevo valor en Vercel,
      **redesplegar**, y actualizar la URL del job. En ese orden, o el job
      empieza a fallar y en dos horas se desactiva.

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

claude --resume 2133f376-4327-490d-a161-88961ec6eef8