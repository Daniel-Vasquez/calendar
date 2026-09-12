import { TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME } from 'astro:env/server';

/**
 * El bot de Telegram. Solo lo importa el servidor: el token es la llave entera
 * del bot —con él se lee todo lo que le llega y se escribe a cualquiera que lo
 * haya arrancado—, así que no aparece en el navegador ni se guarda en Mongo.
 *
 * El canal se eligió por lo que se puede comprobar: la respuesta trae `ok` y,
 * cuando falla, `description`. Así «enviado» es un hecho y no un acto de fe,
 * que es justo lo que no daba un `GET` a ciegas contra un tercero.
 */

const API = 'https://api.telegram.org';

/** Las llamadas al bot no deben colgar más de lo que dura la función. */
const TIMEOUT_MS = 8000;

export type TelegramConfig = { token: string; username: string };

/**
 * La configuración, o qué falta para tenerla.
 *
 * Las variables son opcionales a propósito (ver `astro.config.mjs`), así que
 * cada ruta que las necesita tiene que preguntar antes en vez de dar por hecho
 * que están. Nombrar la que falta ahorra el rato de mirar por qué «no pasa
 * nada» al pulsar un botón.
 */
export function telegramConfig(): { ok: true; config: TelegramConfig } | { ok: false; missing: string } {
  if (!TELEGRAM_BOT_TOKEN) return { ok: false, missing: 'TELEGRAM_BOT_TOKEN' };
  if (!TELEGRAM_BOT_USERNAME) return { ok: false, missing: 'TELEGRAM_BOT_USERNAME' };
  return { ok: true, config: { token: TELEGRAM_BOT_TOKEN, username: TELEGRAM_BOT_USERNAME.replace(/^@/, '') } };
}

/** Enlace que abre el chat con el bot y le manda `/start <code>` al pulsar. */
export function startLink(username: string, code: string): string {
  return `https://t.me/${username}?start=${code}`;
}

type ApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
};

export type TelegramFailure = {
  reason: string;
  /** El bot está bloqueado o el chat ya no existe: reintentar no arregla nada. */
  blocked: boolean;
  /** Segundos que pide esperar un 429. */
  retryAfter?: number;
};

/**
 * Una llamada al bot. Devuelve el resultado o el porqué, nunca lanza: quien
 * llama está a mitad de un recorrido de varios usuarios y un fallo con uno no
 * puede llevarse por delante a los demás.
 */
async function call<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; result: T } | { ok: false } & TelegramFailure> {
  let response: Response;
  try {
    response = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: 'No se pudo hablar con Telegram.', blocked: false };
  }

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    return { ok: false, reason: `Telegram respondió ${response.status} sin JSON.`, blocked: false };
  }

  if (payload.ok && payload.result !== undefined) return { ok: true, result: payload.result };

  // 403 es «me bloqueó» o «el chat ya no existe». 400 con este texto es un
  // chat que nunca arrancó el bot. En los dos casos insistir no arregla nada,
  // y quien llama necesita distinguirlos de un fallo de red para poder dejar
  // de intentarlo y decírselo a la persona.
  const code = payload.error_code ?? response.status;
  const description = payload.description ?? `error ${code}`;
  const blocked = code === 403 || /chat not found/i.test(description);

  return {
    ok: false,
    reason: description,
    blocked,
    ...(payload.parameters?.retry_after ? { retryAfter: payload.parameters.retry_after } : {}),
  };
}

export type SentMessage = { message_id: number };

/**
 * Manda un mensaje. Sin `parse_mode`: el texto sale de una nota escrita por
 * una persona y un guion bajo suelto lo rechazaría con un 400. Ver
 * `reminderMessage` en `reminder.ts`.
 */
export function sendMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<{ ok: true; result: SentMessage } | ({ ok: false } & TelegramFailure)> {
  return call<SentMessage>(token, 'sendMessage', {
    chat_id: chatId,
    text,
    disable_notification: false,
  });
}

export type Update = {
  update_id: number;
  message?: {
    text?: string;
    chat: { id: number; type: string; first_name?: string; username?: string; title?: string };
  };
};

/**
 * Lo que le ha llegado al bot últimamente. Es la mitad de la vinculación: la
 * persona pulsa Start y el `/start <código>` aparece aquí.
 *
 * **No se avanza el `offset` a propósito.** Confirmar los updates los borra de
 * la cola de Telegram, y dos personas vinculando a la vez se pisarían: la
 * primera en comprobar se llevaría por delante el `/start` de la segunda.
 * Telegram los descarta solo a las 24 horas, que para esta escala sobra.
 *
 * Esto exige que el bot **no** tenga webhook puesto: con uno, `getUpdates`
 * contesta 409 y la vinculación deja de funcionar.
 */
export function getUpdates(
  token: string,
): Promise<{ ok: true; result: Update[] } | ({ ok: false } & TelegramFailure)> {
  return call<Update[]>(token, 'getUpdates', {
    limit: 100,
    timeout: 0,
    allowed_updates: ['message'],
  });
}

/** El nombre con el que enseñar un chat vinculado. Nunca vacío. */
export function chatName(chat: NonNullable<Update['message']>['chat']): string {
  return chat.title ?? chat.first_name ?? (chat.username ? `@${chat.username}` : `Chat ${chat.id}`);
}
