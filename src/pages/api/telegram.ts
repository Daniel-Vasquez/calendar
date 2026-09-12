import type { APIRoute } from 'astro';
import { ObjectId } from 'mongodb';
import { getSettings } from '../../lib/mongo';
import { chatName, getUpdates, sendMessage, startLink, telegramConfig } from '../../lib/telegram';

export const prerender = false;

/**
 * Vincular el Telegram de quien ha entrado, y nada más.
 *
 * La vinculación no le pide a nadie que copie su «chat ID»: averiguarlo obliga
 * a llamar a `getUpdates`, y eso exige el token del bot, que es lo último que
 * se le puede enseñar a un usuario. En vez de eso se le da un enlace con un
 * código dentro; al pulsar Start, Telegram le manda `/start <código>` al bot y
 * este extremo lo reconoce. La persona no copia nada y el chat queda atado a
 * quien abrió *ese* enlace, no a quien diga ser.
 */

/** Cuánto vale un código de vinculación. Lo bastante para ir al móvil y volver. */
const CODE_TTL_MS = 15 * 60 * 1000;

function ownerOf(locals: App.Locals): ObjectId | null {
  const id = locals.user?.id;
  return id && ObjectId.isValid(id) ? new ObjectId(id) : null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Código del enlace. Hexadecimal: Telegram solo admite `A-Za-z0-9_-` tras `?start=`. */
function newCode(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

/** Lo que el navegador necesita saber. Nunca incluye el token, evidentemente. */
type Status = {
  configured: boolean;
  connected: boolean;
  name?: string;
  blocked?: boolean;
  missing?: string;
};

/** ¿Está vinculado? Lo pide el panel de ajustes al abrirse. */
export const GET: APIRoute = async ({ locals }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  const config = telegramConfig();
  if (!config.ok) {
    return json(200, { configured: false, connected: false, missing: config.missing } satisfies Status);
  }

  try {
    const settings = await getSettings();
    const doc = await settings.findOne({ userId });
    const telegram = doc?.telegram;

    return json(200, {
      configured: true,
      connected: Boolean(telegram?.chatId),
      ...(telegram?.name ? { name: telegram.name } : {}),
      ...(telegram?.blockedAt ? { blocked: true } : {}),
    } satisfies Status);
  } catch (error) {
    console.error('[telegram] no se pudo leer el ajuste:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  const config = telegramConfig();
  if (!config.ok) {
    return json(503, { error: `Falta ${config.missing} en el servidor.` });
  }
  const { token, username } = config.config;

  let action: unknown;
  try {
    ({ action } = (await request.json()) as { action?: unknown });
  } catch {
    return json(400, { error: 'El cuerpo no es JSON válido' });
  }

  let settings;
  try {
    settings = await getSettings();
  } catch (error) {
    console.error('[telegram] la base no responde:', error);
    return json(503, { error: 'La base de datos no responde' });
  }

  const now = Date.now();

  // Paso 1: un enlace con un código dentro. Se guarda para reconocerlo cuando
  // vuelva rebotado desde Telegram.
  if (action === 'link') {
    const code = newCode();
    await settings.updateOne(
      { userId },
      {
        $set: { userId, updatedAt: now, 'telegram.pending': { code, createdAt: now } },
        // Empezar de cero: si había una vinculación antes, este enlace la
        // sustituye, y dejar el chat viejo mientras se ata el nuevo haría que
        // un aviso saliera al sitio equivocado durante el rato intermedio.
        $unset: { 'telegram.chatId': '', 'telegram.name': '', 'telegram.blockedAt': '' },
      },
      { upsert: true },
    );
    return json(200, { url: startLink(username, code) });
  }

  // Paso 2: ¿ha llegado ya ese `/start`?
  if (action === 'check') {
    const doc = await settings.findOne({ userId });
    const pending = doc?.telegram?.pending;

    if (!pending) return json(409, { error: 'Pide el enlace antes de comprobar.' });
    if (now - pending.createdAt > CODE_TTL_MS) {
      return json(410, { error: 'El enlace ha caducado. Pide uno nuevo.' });
    }

    const updates = await getUpdates(token);
    if (!updates.ok) return json(502, { error: `Telegram: ${updates.reason}` });

    // El código es lo que ata el chat a esta cuenta: solo puede traerlo quien
    // abrió este enlace concreto.
    const wanted = `/start ${pending.code}`;
    const match = updates.result.find((update) => update.message?.text?.trim() === wanted);
    if (!match?.message) {
      return json(200, { connected: false, reason: 'Todavía no me ha llegado nada. ¿Pulsaste Start?' });
    }

    const chat = match.message.chat;
    const name = chatName(chat);

    await settings.updateOne(
      { userId },
      {
        $set: {
          userId,
          updatedAt: now,
          'telegram.chatId': chat.id,
          'telegram.name': name,
          'telegram.linkedAt': now,
        },
        $unset: { 'telegram.pending': '', 'telegram.blockedAt': '' },
      },
      { upsert: true },
    );

    // Un acuse inmediato en el propio chat: la confirmación llega donde van a
    // llegar los avisos, que es la única prueba que vale de que esto funciona.
    await sendMessage(token, chat.id, '✅ Listo. Aquí te llegarán los recordatorios del planificador.');

    return json(200, { connected: true, name });
  }

  // Un mensaje ahora mismo. Descubrir que el chat ya no vale a las nueve de la
  // mañana de un martes es tarde.
  if (action === 'test') {
    const doc = await settings.findOne({ userId });
    const chatId = doc?.telegram?.chatId;
    if (!chatId) return json(409, { error: 'No hay ningún Telegram vinculado.' });

    const sent = await sendMessage(token, chatId, '🔔 Prueba del planificador. Si lees esto, los avisos llegan.');
    if (sent.ok) {
      if (doc?.telegram?.blockedAt) {
        await settings.updateOne({ userId }, { $unset: { 'telegram.blockedAt': '' } });
      }
      return json(200, { ok: true });
    }

    if (sent.blocked) {
      await settings.updateOne({ userId }, { $set: { 'telegram.blockedAt': now } });
    }
    return json(502, { error: `Telegram: ${sent.reason}` });
  }

  return json(400, { error: 'Acción desconocida' });
};

/** Desvincular. El chat deja de recibir nada; los recordatorios se quedan. */
export const DELETE: APIRoute = async ({ locals }) => {
  const userId = ownerOf(locals);
  if (!userId) return json(401, { error: 'No autenticado' });

  try {
    const settings = await getSettings();
    await settings.updateOne(
      { userId },
      { $set: { userId, updatedAt: Date.now() }, $unset: { telegram: '' } },
      { upsert: true },
    );
    return json(200, { connected: false });
  } catch (error) {
    console.error('[telegram] no se pudo desvincular:', error);
    return json(503, { error: 'La base de datos no responde' });
  }
};
