import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { CRON_SECRET } from 'astro:env/server';
import { getDays, getSettings } from '../../../lib/mongo';
import { GRACE_MS, reminderMessage } from '../../../lib/reminder';
import { sendMessage, telegramConfig } from '../../../lib/telegram';

export const prerender = false;

/**
 * Manda los recordatorios que tocan. Lo llama un programador externo.
 *
 * **Esta ruta no lleva sesión**, y por eso está en la lista de públicas del
 * middleware: el que llama es un cron, no una persona con cookie. El candado
 * es la cabecera secreta, que se comprueba antes que ninguna otra cosa.
 *
 * Vercel Hobby no sirve de programador: admite un cron al día y lo dispara en
 * cualquier momento dentro de la hora indicada, lo que para un aviso a las
 * 9:00 no es precisión suficiente. Sirve cron-job.org, una GitHub Action o un
 * Worker de Cloudflare que solo haga ping.
 *
 * **Quien llame tiene que mandar `content-type: application/json`.** Astro trae
 * protección contra CSRF encendida de fábrica y rechaza cualquier POST cuyo
 * tipo de contenido sea de los que un navegador puede mandar entre sitios sin
 * preflight —formulario o texto plano, y también *ninguno*—. La respuesta es un
 * 403 «Cross-site POST form submissions are forbidden» que no menciona ni la
 * cabecera ni el cron, así que sin esta nota se pierde la tarde.
 */

/**
 * Cabeceras que valen para autorizar, las dos con el mismo secreto.
 *
 * `Authorization: Bearer …` es la estándar y casi todos los programadores
 * traen una casilla propia para ella; `x-cron-secret` se queda porque es la
 * que ya está configurada y porque un nombre explícito se lee mejor en un
 * formulario ajeno. Aceptar ambas cuesta cinco líneas y ahorra la tarde de
 * pelearse con el formulario de turno.
 */
const SECRET_HEADER = 'x-cron-secret';

/**
 * Último recurso: el secreto en la propia URL, `?secret=…`.
 *
 * Se admite porque hay programadores que sencillamente no mandan las cabeceras
 * que les configuras, y descubrirlo cuesta una tarde: la petición llega sin
 * nada y el 401 no distingue «secreto equivocado» de «cabecera perdida».
 *
 * **Es la forma menos buena y la única que deja rastro.** Lo que va en una URL
 * acaba en los registros de acceso del servidor, en el historial del
 * programador y en cualquier intermediario del camino, mientras que una
 * cabecera no. Úsese solo cuando las otras no sean posibles, y con la idea de
 * que ese secreto es más rotable que los demás.
 *
 * El riesgo real es acotado: quien lo consiga solo puede pedir que se manden
 * los avisos que ya tocaban, a los chats de siempre. No lee ni borra nada.
 */
const SECRET_PARAM = 'secret';

/**
 * Cuánto se permite tardar antes de dejar el resto para la pasada siguiente.
 *
 * Lo que quede sigue dentro de su ventana de gracia, así que no se pierde: se
 * manda en el siguiente ping. Es preferible a que la función muera a la mitad
 * con la mitad de los avisos reclamados y sin enviar.
 */
const BUDGET_MS = 8000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Comparación de duración constante. Con longitudes distintas ni se intenta. */
function secretMatches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * El candado de esta ruta, que no tiene sesión de la que tirar. Devuelve la
 * respuesta con la que cortar, o `null` si la llamada puede seguir.
 */
function reject(request: Request, url: URL): Response | null {
  // Sin secreto configurado no entra nadie, y se contesta lo mismo que a quien
  // trae uno malo: decir «falta CRON_SECRET» a un desconocido es avisarle de
  // que la puerta está sin cerradura. El operador lo ve en el registro.
  if (!CRON_SECRET) {
    console.error('[cron] llamada rechazada: falta CRON_SECRET en el entorno');
    return json(401, { error: 'No autorizado' });
  }
  for (const given of offeredSecrets(request, url)) {
    if (secretMatches(given, CRON_SECRET)) return null;
  }
  return json(401, { error: 'No autorizado' });
}

/**
 * Todos los sitios de los que se acepta el secreto.
 *
 * Son varios porque cada programador manda lo suyo a su manera, y pelearse con
 * un formulario ajeno a ciegas —sin poder ver qué envía— es lo que más tiempo
 * ha costado de toda la tanda.
 */
function offeredSecrets(request: Request, url: URL): string[] {
  const found: string[] = [];

  const propia = request.headers.get(SECRET_HEADER);
  if (propia) found.push(propia.trim());

  const auth = request.headers.get('authorization');
  if (auth) {
    // `Basic dXN1YXJpbzpjbGF2ZQ==`: lo mandan las casillas de usuario y
    // contraseña que traen casi todos los programadores. Valen las dos
    // mitades, porque no hay forma de saber en cuál lo habrá puesto.
    const basic = /^\s*basic\s+(\S+)/i.exec(auth);
    if (basic) {
      try {
        const par = atob(basic[1]);
        const corte = par.indexOf(':');
        found.push(corte === -1 ? par.trim() : par.slice(0, corte).trim(), par.slice(corte + 1).trim());
      } catch {
        /* No era base64: se ignora y se prueba con lo de abajo. */
      }
    }

    // `Bearer` no distingue mayúsculas por especificación, y hay formularios
    // que lo escriben `bearer`. Se admite también el valor pelado: alguien que
    // pega solo el secreto en una casilla llamada «Authorization» tiene razón
    // en esperar que funcione.
    found.push(auth.replace(/^\s*bearer\s+/i, '').trim());
  }

  const enLaUrl = url.searchParams.get(SECRET_PARAM);
  if (enLaUrl) found.push(enLaUrl.trim());

  return found.filter(Boolean);
}

export const POST: APIRoute = async ({ request, url }) => {
  const denied = reject(request, url);
  if (denied) return denied;

  const config = telegramConfig();
  if (!config.ok) return json(503, { error: `Falta ${config.missing} en el servidor.` });
  const { token } = config.config;

  const started = Date.now();
  const summary = { due: 0, sent: 0, sinDestino: 0, fallidos: 0, aplazados: 0 };

  try {
    const days = await getDays();

    // La ventana de gracia es la mitad del filtro. Sin ella, levantar el
    // programador tras tres días caídos dispararía de golpe todos los avisos
    // atrasados; lo que pase de aquí ya se enseña como perdido en la agenda.
    const pendientes = await days
      .find({
        'reminder.at': { $lte: started, $gt: started - GRACE_MS },
        'reminder.sent': { $exists: false },
        deleted: { $ne: true },
      })
      .sort({ 'reminder.at': 1 })
      .limit(200)
      .toArray();

    summary.due = pendientes.length;
    if (pendientes.length === 0) return json(200, summary);

    // Los destinos, de una vez: una consulta por aviso sería una por día.
    const settings = await getSettings();
    const destinos = new Map<string, { chatId?: number; blocked: boolean }>();
    for (const doc of await settings
      .find({ userId: { $in: [...new Set(pendientes.map((day) => day.userId))] } })
      .toArray()) {
      destinos.set(doc.userId.toHexString(), {
        chatId: doc.telegram?.chatId,
        blocked: Boolean(doc.telegram?.blockedAt),
      });
    }

    for (const day of pendientes) {
      if (Date.now() - started > BUDGET_MS) {
        summary.aplazados = summary.due - summary.sent - summary.sinDestino - summary.fallidos;
        break;
      }

      const destino = destinos.get(day.userId.toHexString());
      if (!destino?.chatId || destino.blocked) {
        summary.sinDestino++;
        continue;
      }
      if (!day.reminder) continue;

      /*
       * Se reclama *antes* de enviar, no después.
       *
       * El filtro exige que `sent` siga sin existir, así que dos pasadas que se
       * solapen no pueden reclamar el mismo aviso: la segunda no encuentra nada
       * que actualizar y lo salta. Mandar primero y marcar después dejaría la
       * puerta abierta a que la misma persona reciba el aviso dos veces.
       *
       * `updatedAt` **no se toca**. Es el árbitro de la fusión, y subirlo aquí
       * haría que el servidor ganara a una edición local que aún no hubiera
       * subido — perdiéndola. El navegador se entera de `sent` por otra vía;
       * ver `pull()` en `sync.ts`.
       */
      const claimed = await days.updateOne(
        { userId: day.userId, key: day.key, 'reminder.sent': { $exists: false } },
        { $set: { 'reminder.sent': started } },
      );
      if (claimed.modifiedCount === 0) continue;

      const text = reminderMessage(day.key, day.note, day.reminder);
      const result = await sendMessage(token, destino.chatId, text);

      if (result.ok) {
        summary.sent++;
        continue;
      }

      // No salió: se suelta la reclamación para que la próxima pasada lo
      // vuelva a intentar mientras siga dentro de la ventana. Sin esto, un
      // fallo de red dejaría el aviso marcado como enviado sin haberlo estado.
      await days.updateOne(
        { userId: day.userId, key: day.key },
        { $unset: { 'reminder.sent': '' } },
      );
      summary.fallidos++;

      if (result.blocked) {
        // Dijo que no: no se insiste ni con este ni con el resto de los suyos.
        destino.blocked = true;
        await settings.updateOne(
          { userId: day.userId },
          { $set: { userId: day.userId, updatedAt: Date.now(), 'telegram.blockedAt': Date.now() } },
          { upsert: true },
        );
      } else if (result.retryAfter) {
        // Telegram pide esperar: se deja el resto para la pasada siguiente en
        // vez de quemar el presupuesto durmiendo.
        summary.aplazados = summary.due - summary.sent - summary.sinDestino - summary.fallidos;
        break;
      }
    }

    return json(200, summary);
  } catch (error) {
    console.error('[cron] no se pudieron mandar los recordatorios:', error);
    return json(503, { error: 'La base de datos no responde', ...summary });
  }
};

/**
 * Un GET no manda nada: dice si el extremo está montado y con qué le falta.
 * Pide el mismo secreto que el POST — sin él, contestar «CRON_SECRET no está
 * configurado» le diría a cualquiera que la puerta está abierta.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const denied = reject(request, url);
  if (denied) return denied;

  const config = telegramConfig();
  return json(200, { ok: true, telegram: config.ok ? 'configurado' : `falta ${config.missing}` });
};
