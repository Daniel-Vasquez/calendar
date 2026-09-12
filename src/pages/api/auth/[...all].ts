import type { APIRoute } from 'astro';
import { auth } from '../../../auth';

export const prerender = false;

/**
 * Todas las rutas de Better Auth —acceso, registro, cierre de sesión— cuelgan
 * de aquí. `ALL` porque el manejador reparte por sí mismo según método y ruta.
 */
export const ALL: APIRoute = (context) => auth.handler(context.request);
