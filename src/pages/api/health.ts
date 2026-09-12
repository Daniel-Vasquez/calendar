import type { APIRoute } from 'astro';
import { connect, currentDatabaseName } from '../../lib/mongo';

/**
 * Única ruta que se resuelve en el servidor por ahora. El resto del sitio
 * se sigue prerenderizando, así que esto no cambia cómo se sirve nada más.
 */
export const prerender = false;

/**
 * Comprueba que la función desplegada alcanza Atlas de verdad. Es el primer
 * eslabón que puede fallar en Vercel —variable ausente, IP no permitida en el
 * clúster, usuario sin permisos— y conviene poder distinguirlos sin desplegar
 * media aplicación por delante.
 *
 * La respuesta es deliberadamente escueta: confirma o desmiente la conexión
 * sin publicar el servidor, el usuario ni el error crudo del driver.
 */
export const GET: APIRoute = async () => {
  const started = Date.now();
  const auth = await authStatus();

  try {
    const db = await connect();
    // `ping` es la comprobación más barata: no lee datos ni crea la base.
    await db.command({ ping: 1 });

    return json(auth.ok ? 200 : 503, {
      ok: auth.ok,
      db: currentDatabaseName(),
      auth: auth.detail,
      latencyMs: Date.now() - started,
    });
  } catch (error) {
    // El detalle va al registro de Vercel, donde solo llegas tú; al cliente
    // solo el nombre del fallo, que ya basta para saber por dónde mirar.
    console.error('[health] no se pudo alcanzar MongoDB:', error);

    return json(503, {
      ok: false,
      db: currentDatabaseName(),
      auth: auth.detail,
      reason: error instanceof Error ? error.name : 'UnknownError',
      latencyMs: Date.now() - started,
    });
  }
};

/**
 * ¿Se deja construir la sesión, y con qué origen?
 *
 * Va dentro de un `try` y con import dinámico porque una configuración mala
 * —una `BETTER_AUTH_URL` sin esquema, por ejemplo— lanza al cargar el módulo.
 * Que eso reviente el diagnóstico sería exactamente lo contrario de lo que
 * este endpoint existe para hacer: aquí se convierte en la respuesta.
 */
async function authStatus(): Promise<{ ok: boolean; detail: string }> {
  try {
    const { baseURL } = await import('../../auth');
    return { ok: true, detail: baseURL };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'no se pudo configurar' };
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Un diagnóstico cacheado no diagnostica nada.
      'cache-control': 'no-store',
    },
  });
}
