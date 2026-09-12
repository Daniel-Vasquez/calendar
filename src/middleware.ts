import { defineMiddleware } from 'astro:middleware';

/**
 * Rutas que se sirven sin sesión. Todo lo demás la exige, de forma que una
 * página nueva nace protegida en lugar de nacer abierta y esperar a que
 * alguien se acuerde de ponerle el candado.
 *
 * `/api/cron/reminders` está aquí porque quien la llama es un programador
 * externo y no una persona con cookie. No queda abierta: lleva su propio
 * candado, una cabecera secreta que comprueba antes de mirar nada más.
 */
const PUBLIC_PATHS = ['/login', '/api/health', '/api/cron/reminders'];

function isPublic(pathname: string): boolean {
  // Las rutas de Better Auth no pueden pedir sesión: son las que la crean.
  if (pathname.startsWith('/api/auth/')) return true;
  return PUBLIC_PATHS.includes(pathname);
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Durante `astro build` el middleware también corre para las páginas
  // prerenderizadas. Ahí no hay petición real de la que sacar una sesión, y
  // consultarla abriría una conexión a Atlas desde el build.
  if (context.isPrerendered) return next();

  // El diagnóstico se resuelve antes de tocar la sesión, y de ahí que el
  // import de abajo sea dinámico: `/api/health` es la ruta a la que se acude
  // cuando el despliegue no responde, y si dependiera de que la configuración
  // de la sesión sea válida caería con ella, justo cuando hace falta.
  if (context.url.pathname === '/api/health') return next();

  const { auth } = await import('./auth');
  const result = await auth.api.getSession({ headers: context.request.headers });
  context.locals.user = result?.user ?? null;
  context.locals.session = result?.session ?? null;

  const { pathname, search } = context.url;

  if (result) {
    // Con la sesión abierta, la puerta ya no lleva a ninguna parte.
    if (pathname === '/login') return context.redirect('/');
    return next();
  }

  if (isPublic(pathname)) return next();

  // Una API contesta con un código; una página, llevando a la puerta.
  if (pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ error: 'No autenticado' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }

  // Se recuerda a dónde iba para devolverle ahí tras entrar: un enlace a la
  // galería o a un día concreto no debe perderse por el camino.
  const wanted = pathname + search;
  return context.redirect(
    wanted === '/' ? '/login' : `/login?next=${encodeURIComponent(wanted)}`,
  );
});
