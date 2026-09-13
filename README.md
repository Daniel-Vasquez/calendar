# 📅 Planificador 2026

Calendario anual con notas, colores, imágenes adjuntas y recordatorios por
Telegram. Construido con **Astro + React**, datos en **MongoDB Atlas** y
desplegado en **Vercel**.

🌐 **En producción:** <https://planificador.danielvasquez.lat>
❤️ **Estado del servicio:** <https://planificador.danielvasquez.lat/api/health>

---

## 1. 🧭 Descripción y contexto

### El problema

Un calendario de escritorio o de pared responde bien a *«¿qué pasa este día?»*,
pero no a *«¿qué tengo por delante?»* ni a *«¿dónde apunté aquello?»*. Las
aplicaciones que sí responden a las tres suelen pedir a cambio una cuenta en un
servicio de terceros, una suscripción, o que tus notas y fotos vivan en un sitio
que no eliges.

Planificador 2026 es un **planificador anual personal y autoalojable**: los doce
meses de un año a la vista, con la posibilidad de marcar días por categorías de
color, escribirles notas, adjuntarles imágenes y programar avisos que llegan al
teléfono por Telegram. Todo vive en tu propio clúster de MongoDB y en tu propio
despliegue.

### Cómo está montado: *local-first*

La decisión de arquitectura que explica casi todo lo demás:

```
navegador                     servidor                   Atlas
─────────                     ────────                   ─────
DayModal → handleSave
        → localStorage  (instantáneo, sin red)
        → sync.ts (cola)  ──POST /api/days──────────────→ days
                          ──PUT  /api/images (1 a 1)────→ images
middleware ──────────────────────────────────────────────→ session, user
```

Guardar escribe en `localStorage` de forma **síncrona** y la subida va detrás, en
una cola. La interfaz nunca espera a la red: el calendario se sigue usando en un
túnel o con el wifi caído, y lo pendiente sube solo cuando vuelve la conexión.
MongoDB es la fuente de verdad, pero **no** el camino crítico.

### 💡 Casos de uso prácticos

| Caso | Cómo se resuelve |
|---|---|
| 🗓️ **Planificar el año de un vistazo** | Los doce meses en una rejilla; marcar días con ocho colores y renombrar cada color como una categoría propia («Entrega», «Guardia», «Viaje») |
| 🔍 **Recuperar algo que apuntaste** | La agenda busca por texto, fecha o categoría —sin tildes y combinando palabras— y deja editar el día sin salir de los resultados |
| 🔔 **No olvidar una cita** | Un recordatorio con hora que llega por Telegram al teléfono, con su lista de pendientes y completados |
| 🖼️ **Guardar el justificante, la receta, el ticket** | Hasta seis imágenes por día, redimensionadas en el navegador, y una galería cronológica de todo el año |
| 🏖️ **Marcar tramos largos** | Shift + clic pinta de golpe todas las vacaciones, la baja o el proyecto entre dos fechas |
| 💾 **No quedar atrapado** | Exportación a JSON (copia completa) y a `.ics` (para llevarlo a cualquier otro calendario), e importación de vuelta |
| 👥 **Compartir la instancia** | Multiusuario con registro cerrado por lista de invitados: cada persona ve sus días y recibe sus avisos |

---

## 2. ✨ Características principales

### 🗓️ Calendario anual

- Los **doce meses de 2026** en una rejilla, con la semana empezando en lunes.
- **Ocho colores** para marcar días (el violeta queda reservado a «hoy», para que
  siga identificándose de un vistazo).
- **Categorías renombrables**: la leyenda deja de decir «Rosa» y dice «Entrega».
- **Shift + clic** marca de una vez todo el tramo entre dos días.
- Navegación **con las flechas del teclado**, meses plegables y botón *Ir a hoy*.
- Cada cambio destructivo deja un aviso con **Deshacer**.

### 📝 Notas del día

- Nota de texto libre por día, con hasta **6 imágenes adjuntas**.
- Formatos `JPEG`, `PNG` y `WebP`; archivos de hasta 12 MB, que el navegador
  **redimensiona a 1280 px** y comprime antes de guardar nada.
- De cada nota se genera una **miniatura de 192 px** que viaja con el día, para
  que la agenda pueda pintar la fila sin esperar a ninguna descarga.
- Las imágenes completas se piden **bajo demanda**, solo al abrir la nota o la
  galería: no lastran la carga del año.

### 🔍 Agenda del año

- Lista **cronológica** de todo lo registrado, con las cuentas del año encima.
- **Buscador** por texto, fecha o categoría. Es ciego a las tildes —«medico»
  encuentra «MÉDICO»— y combina palabras con *Y*: «medico marzo» estrecha en vez
  de ampliar.
- **Pestañas** por tipo (todos / notas / recordatorios) con sus recuentos, filtro
  por color y un interruptor para ocultar los días pasados.
- **Edición in situ**: pulsar una fila abre el modal del día sobre la propia
  agenda, sin perder lo tecleado, los filtros ni el sitio en la lista. Desde ahí
  se puede incluso **mover el día entero a otra fecha**.

### 🔔 Recordatorios por Telegram

- Hora y texto por día; sin texto propio se manda la primera línea de la nota.
- Lista aparte con pestañas **pendientes / completados / todos**, separando lo
  próximo de lo que ya pasó.
- El envío lo dispara un **programador externo** (GitHub Actions, cada 5 minutos)
  contra `POST /api/cron/reminders`, protegido por un secreto en cabecera.
- **Ventana de gracia de 2 horas**: una ejecución que se retrase no pierde el
  aviso, y una caída larga no dispara de golpe todo lo atrasado.
- El bot es **uno, de la aplicación**. Nadie tiene que crearse un bot ni manejar
  tokens: se abre el chat, se pulsa *Start* y se comprueba desde Ajustes.

### 🖼️ Galería

- Todas las imágenes del año en una cuadrícula cronológica.
- Visor a pantalla completa, con `Escape` para cerrar y un enlace *Ver nota* que
  lleva al día del que salió la imagen.

### 🎨 Interfaz

- **Tema claro y oscuro**, recordado entre visitas y aplicado antes del primer
  píxel: sin destello blanco al recargar.
- Diseño **responsive** pensado desde el teléfono.
- Modales accesibles: foco atrapado, `Escape` para cerrar y el foco devuelto a
  donde estaba.

### 🔄 Sincronización y cuentas

- **Cuentas con correo y contraseña** (mínimo 8 caracteres) y todas las rutas
  cerradas por defecto: una página nueva nace protegida.
- **Registro por lista de invitados** en la base de datos; quien no está recibe
  un «este correo no tiene invitación».
- **Resolución de conflictos** por marca de tiempo: entre dos versiones del mismo
  día gana la más reciente, y un empate lo gana lo local.
- Un día borrado deja una **lápida**, para que no lo resucite otro dispositivo
  que todavía lo tuviera.
- Indicador de estado permanente: *Al día* / *Guardando…* / *N sin subir*, con
  botón de reintento.

### 💾 Copia de seguridad

- **Exportar a JSON**: el año entero con sus categorías, y las imágenes que este
  navegador tenga descargadas.
- **Exportar a `.ics`**: los días marcados y sus notas, para cualquier calendario.
- **Importar JSON**: fusiona con lo que ya haya, sin machacar el resto del año.

---

## 3. 🧱 Stack tecnológico y servicios

### Núcleo

| Pieza | Versión | Papel |
|---|---|---|
| [Astro](https://astro.build) | `^7.3` | Framework del sitio, rutas y endpoints de API |
| [React](https://react.dev) | `^19.2` | Islas interactivas (`client:load`) |
| [TypeScript](https://www.typescriptlang.org) | `^6.0` | Tipado estricto en todo el proyecto |
| [Tailwind CSS](https://tailwindcss.com) | `^4.3` | Estilos, vía plugin de Vite |
| [MongoDB Node Driver](https://www.mongodb.com/docs/drivers/node/) | `^7.6` | Acceso a datos |
| [Better Auth](https://www.better-auth.com) | `^1.7` | Sesiones, con `@better-auth/mongo-adapter` |
| [@astrojs/vercel](https://docs.astro.build/en/guides/integrations-guide/vercel/) | `^11.0` | Adaptador de despliegue |

### Estado y datos

- **Estado del cliente**: React (`useState`/`useMemo`) más un hook propio,
  `useCalendarStore`, que concentra el calendario, `localStorage` y la cola de
  subida. Sin Redux, Zustand ni similares: hay un único almacén y vive ahí.
- **Persistencia local**: `localStorage` (copia completa del año, saneada al
  leer para que un dato corrupto no tumbe el resto).
- **Base de datos**: MongoDB Atlas.

| Colección | Contenido | Índice |
|---|---|---|
| `user` `session` `account` | Las crea Better Auth | propios |
| `days` | Un día por usuario: marca, nota, color, `imageCount`, `thumb`, `reminder` | `{userId, key}` único |
| `images` | Una imagen por documento, con su posición dentro del día | `{userId, key, index}` único |
| `settings` | Ajustes que no son del dispositivo: hoy, el chat de Telegram | `{userId}` único |
| `allowlist` | Qué correos pueden **crearse** una cuenta | `{email}` único |

### Servicios de terceros

| Servicio | Para qué | ¿Obligatorio? |
|---|---|---|
| ☁️ **MongoDB Atlas** | Base de datos (días, imágenes, sesiones, ajustes) | ✅ Sí |
| ▲ **Vercel** | Alojamiento y funciones serverless | ✅ Para producción |
| 🤖 **Telegram Bot API** | Envío de los recordatorios | ⬜ Opcional |
| ⏱️ **GitHub Actions** | Programador que despierta al cron cada 5 min | ⬜ Opcional |

> [!NOTE]
> **Sobre Cloudinary:** hoy las imágenes **no** pasan por Cloudinary. Se guardan
> como *data URL* en la colección `images` de MongoDB, una por documento, y se
> sirven desde `GET /api/images`. Mover los adjuntos a Cloudinary está en el
> [roadmap](#-roadmap) y todavía no hay ninguna credencial suya en el proyecto.

---

## 4. 🚀 Guía para el desarrollador

### Prerrequisitos

| Requisito | Versión | Nota |
|---|---|---|
| **Node.js** | `>= 22.12` | Lo exige Astro 7. Vercel ejecuta la 24 |
| **npm** | el que trae Node | El repo fija dependencias con `package-lock.json`; es el gestor de referencia |
| **Cuenta de MongoDB Atlas** | — | Sirve el plan gratuito (M0) |
| **Bot de Telegram** | — | Solo si quieres recordatorios. Se crea con [@BotFather](https://t.me/BotFather) |

### 1️⃣ Clonar e instalar

```bash
git clone https://github.com/Daniel-Vasquez/calendar.git
cd calendar
npm install
```

### 2️⃣ Configurar las variables de entorno

Copia la plantilla y rellénala:

```bash
cp .env.example .env
```

#### 🔐 Obligatorias

| Variable | Descripción |
|---|---|
| `MONGODB_URI` | Cadena de conexión de Atlas. Si su ruta trae nombre de base, esa manda |
| `BETTER_AUTH_SECRET` | Firma las cookies de sesión. Genérala con `openssl rand -base64 32`. Cambiarla cierra todas las sesiones abiertas |
| `BETTER_AUTH_URL` | Origen público del sitio, **con esquema** y sin barra final |

#### 🔔 Opcionales — recordatorios por Telegram

Sin estas tres el calendario funciona entero; solo deja de haber avisos.

| Variable | Descripción |
|---|---|
| `TELEGRAM_BOT_TOKEN` | El token que da @BotFather con `/newbot`. Es la llave entera del bot: si acaba en un commit, revócalo con `/revoke` — borrarlo no basta |
| `TELEGRAM_BOT_USERNAME` | El usuario del bot, sin arroba. Va dentro del enlace que abre el chat |
| `CRON_SECRET` | Autoriza al programador externo a disparar el envío. Genéralo con `openssl rand -hex 32` |

#### ⚙️ Opcional — otras

| Variable | Descripción |
|---|---|
| `MONGODB_DB` | Nombre de la base. Manda sobre el que traiga la URI; sin ninguno de los dos se usa `planificador` |

Ejemplo de `.env` mínimo para desarrollo:

```dotenv
MONGODB_URI="mongodb+srv://usuario:contraseña@clúster.mongodb.net/planificador?retryWrites=true&w=majority"
BETTER_AUTH_SECRET="…salida de openssl rand -base64 32…"
BETTER_AUTH_URL="http://localhost:4321"
```

> [!IMPORTANT]
> Las variables se declaran en `astro.config.mjs` con `astro:env`, así que hay
> que **reiniciar `astro dev`** después de añadir una nueva o llegará vacía. En
> Vercel, además, **hay que volver a desplegar**: editar una variable en el panel
> no la mete en la función que ya está corriendo.

### 3️⃣ Darte de alta en la lista de invitados

El registro está cerrado: sin invitación, el alta se rechaza. Antes de crear la
primera cuenta, añade tu correo:

```bash
node --env-file=.env scripts/allowlist.mjs                        # ver la lista
node --env-file=.env scripts/allowlist.mjs add tu@correo.com "nota"
node --env-file=.env scripts/allowlist.mjs remove tu@correo.com
```

### 4️⃣ Levantar el servidor de desarrollo

```bash
npm run dev
```

👉 <http://localhost:4321> — te llevará a `/login` para registrarte.

### 📜 Scripts disponibles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo en el puerto 4321 |
| `npm run build` | Build de producción (adaptador de Vercel) |
| `npm run preview` | Sirve el build en local |
| `npx astro check` | Comprobación de tipos de todo el proyecto |
| `curl localhost:4321/api/health` | ¿Alcanza la aplicación a Atlas? |

### 🤖 Conectar Telegram

1. Crea el bot con [@BotFather](https://t.me/BotFather) (`/newbot`) y guarda el
   token y el usuario en el `.env`.
2. Reinicia `astro dev`.
3. Entra en **Ajustes** (el engrane de la barra) → *Recordatorios por Telegram*.
4. Abre el chat que propone el enlace, pulsa **Start** y vuelve a **Comprobar**.
5. Usa **Enviar prueba** para confirmar que llega.

Para que los avisos salgan solos hace falta un programador externo que llame al
endpoint. El repositorio trae uno listo en
`.github/workflows/recordatorios.yml`; basta con poner `CRON_SECRET` en
*Settings → Secrets and variables → Actions* con el mismo valor que en Vercel.
Disparar el envío a mano:

```bash
curl -X POST https://tu-dominio/api/cron/reminders \
  -H "content-type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  --fail-with-body
```

> [!TIP]
> La cabecera `content-type: application/json` **no es opcional**: Astro trae
> protección CSRF encendida y rechaza cualquier `POST` sin tipo de contenido con
> un 403 que habla de formularios y no menciona el cron.

---

## 5. 🗂️ Estructura del proyecto

```
src/
├── components/          # Islas de React
│   ├── CalendarDashboard.tsx   # La rejilla del año y sus acciones
│   ├── DayModal.tsx            # Editar un día: marca, color, nota, imágenes, aviso
│   ├── AgendaView.tsx          # La agenda, su modal y sus avisos
│   ├── AgendaList.tsx          # Lista, buscador y filtros
│   ├── RemindersView.tsx       # La lista de recordatorios
│   ├── GalleryView.tsx         # La galería y su visor
│   ├── useCalendarStore.ts     # El calendario y su sincronía, para toda página que escriba
│   └── …
├── lib/                 # Lógica sin React: se prueba y se comparte
│   ├── storage.ts              # localStorage, saneado, forma de `DayEntry`
│   ├── sync.ts                 # Cola, fusión, subida y descarga bajo demanda
│   ├── wire.ts                 # Formato en que un día viaja; lo importan los dos lados
│   ├── reminder.ts             # Hora, texto y estado del aviso
│   ├── search.ts               # La lente de la agenda: buscar y filtrar
│   ├── image.ts                # Redimensionado, compresión y miniaturas
│   ├── mongo.ts                # Cliente cacheado, colecciones e índices
│   └── …
├── pages/
│   ├── index.astro             # Calendario
│   ├── agenda.astro            # Agenda del año
│   ├── recordatorios.astro     # Recordatorios
│   ├── galeria.astro           # Galería
│   ├── login.astro             # Entrada y registro
│   └── api/                    # Endpoints
├── auth.ts / auth-client.ts    # Better Auth en servidor y navegador
└── middleware.ts               # Sesión en `Astro.locals`; candado por defecto
```

### 🛣️ Rutas

#### Páginas

| Ruta | Contenido |
|---|---|
| `/` | El calendario del año. Acepta `?day=2026-03-15` para abrir ese día |
| `/agenda` | Lista cronológica con buscador, filtros y edición in situ |
| `/recordatorios` | Todos los avisos, pendientes y completados |
| `/galeria` | Las imágenes de todas las notas |
| `/login` | Entrada y registro (única página pública) |

#### API

| Método y ruta | Qué hace | Auth |
|---|---|---|
| `GET /api/days` | Todos los días del usuario | 🔒 Sesión |
| `POST /api/days` | Sube días por lotes (hasta 500), arbitrando por `updatedAt` | 🔒 Sesión |
| `GET /api/images?key=` | Las imágenes de un día, en orden | 🔒 Sesión |
| `PUT /api/images` | Sube **una** imagen (el cuerpo de Vercel topa en 4,5 MB) | 🔒 Sesión |
| `DELETE /api/images?key=&from=` | Recorta la cola de imágenes de un día | 🔒 Sesión |
| `GET/POST/DELETE /api/telegram` | Comprobar, vincular, probar y desvincular el chat | 🔒 Sesión |
| `POST /api/cron/reminders` | Manda los avisos que toquen | 🔑 `x-cron-secret` |
| `GET /api/health` | ¿Alcanza la función desplegada a Atlas? | 🌐 Pública |
| `/api/auth/*` | Rutas de Better Auth | 🌐 Pública |

---

## 6. ▲ Despliegue

El proyecto está pensado para **Vercel** y se despliega desde `main`.

1. Importa el repositorio en Vercel; el adaptador ya está configurado.
2. Define **todas** las variables de entorno en el panel del proyecto.
   `BETTER_AUTH_SECRET` conviene que sea **distinta** de la local, y
   `BETTER_AUTH_URL` debe llevar `https://` delante.
3. En Atlas, pon *Network Access* en `0.0.0.0/0`. Con solo tu IP en lista
   blanca, las funciones de Vercel no entran, y el síntoma despista: Atlas corta
   el saludo TLS y el driver lo reporta como `tlsv1 alert internal error`, que no
   se parece a un problema de permisos.
4. Comprueba el despliegue con `GET /api/health`, que responde sin depender del
   middleware ni de que haya sesión válida:

```bash
curl https://tu-dominio/api/health
```

---

## 7. 🗺️ Roadmap

- ☁️ **Multimedia en Cloudinary** *(tanda 8)*: mover los adjuntos de MongoDB a
  Cloudinary con almacenamiento privado y URLs firmadas. Traerá tres variables
  nuevas —`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` y
  `CLOUDINARY_API_SECRET`— y retirará dos límites actuales: las miniaturas
  dejarán de viajar dentro de `GET /api/days` y `localStorage` dejará de guardar
  la copia completa de las imágenes.
- ♿ **Contraste del tema claro**: varios pares no llegan a AA (el oscuro sí).
- 🧹 **Purga de lápidas**: hoy no se borran nunca y crecen sin fin.
- ⚙️ **Campo `engines` en `package.json`**, para fijar la versión de Node.

El detalle de cada punto, con su razonamiento, está en
[`planificador.md`](./planificador.md) — el mapa vivo del proyecto.

---

## 8. 📚 Documentación del proyecto

| Archivo | Contenido |
|---|---|
| [`planificador.md`](./planificador.md) | El mapa del proyecto: arquitectura, historial de cada tanda, deuda conocida, cómo invitar a alguien, mantenimiento y las trampas que ya mordieron |
| Comentarios del código | El **porqué** de cada decisión. Es donde vive la mayor parte de la documentación |

---

## 📄 Licencia

Proyecto personal, sin licencia declarada. Todos los derechos reservados.
