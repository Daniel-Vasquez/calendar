import { betterAuth } from 'better-auth';
import { APIError } from 'better-auth/api';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from 'astro:env/server';
import { getAllowlist, getClient, getDb, normalizeEmail } from './lib/mongo';

/**
 * Origen público, con esquema, y sin barra final.
 *
 * Better Auth lanza al construirse si la URL no trae esquema —«Invalid base
 * URL»—, y como el middleware importa este archivo, eso tumba el sitio entero:
 * hasta las rutas públicas devuelven un 500 vacío que no dice de qué se queja.
 * Escribir el dominio a pelo en la variable de entorno es un error fácil y con
 * una única lectura razonable, así que se completa en vez de caerse.
 */
function publicOrigin(value: string): string {
  const clean = value.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(clean)) return clean;

  // En local nunca hay certificado; fuera, nunca se sirve sin él.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(clean);
  const guessed = `${local ? 'http' : 'https'}://${clean}`;
  console.warn(`[auth] BETTER_AUTH_URL no traía esquema; se asume ${guessed}`);
  return guessed;
}

/** Se exporta para que `/api/health` pueda enseñar con qué origen se quedó. */
export const baseURL = publicOrigin(BETTER_AUTH_URL);

/**
 * Configuración de la sesión. Es el único lugar del proyecto que sabe cómo se
 * autentica a alguien; todo lo demás lee `Astro.locals.user`.
 *
 * Better Auth crea sus colecciones (`user`, `session`, `account`,
 * `verification`) por su cuenta: con Mongo no hay esquema que declarar ni
 * migración que correr. El nombre que se pide al registrarse vive en `user`.
 */
export const auth = betterAuth({
  database: mongodbAdapter(getDb(), {
    // Con un cliente delante, el adaptador agrupa las escrituras en
    // transacciones. Atlas es un conjunto de réplicas y las admite; contra un
    // Mongo suelto habría que añadir `transaction: false`.
    client: getClient(),
  }),

  secret: BETTER_AUTH_SECRET,
  baseURL,

  emailAndPassword: {
    enabled: true,
    // No hay servidor de correo, así que no hay a dónde mandar la
    // verificación. Es un calendario personal: la cuenta vale desde que nace.
    requireEmailVerification: false,
    minPasswordLength: 8,
  },

  /*
   * El registro está abierto a cualquiera que dé con la URL, así que la lista
   * de invitados es lo que decide quién puede crearse una cuenta. Vive en
   * Mongo; ver `getAllowlist`.
   *
   * Va aquí, en el gancho de la base, y no en el formulario: así cubre
   * cualquier vía de alta que se añada después —un proveedor externo, una
   * invitación por enlace— sin que nadie tenga que acordarse de repetir la
   * comprobación. El formulario es una puerta; esto es la cerradura.
   *
   * **Solo mira a quien se da de alta.** A quien ya tiene cuenta no le afecta:
   * el gancho es de creación, no de entrada.
   */
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          const email = normalizeEmail(user.email ?? '');

          // Se lanza `APIError` en vez de devolver `false`. Las dos cosas
          // abortan el alta, pero `false` deja al formulario con un error
          // genérico y la persona no sabe si falló el servidor o es que no
          // está invitada.
          const rechazar = () => {
            throw new APIError('FORBIDDEN', {
              message: 'Este correo no tiene invitación para crear una cuenta.',
            });
          };

          if (!email) rechazar();

          let invitado: unknown;
          try {
            invitado = await (await getAllowlist()).findOne({ email });
          } catch (error) {
            // Si la base no contesta no se puede saber si está invitado, y ante
            // la duda no se abre: es preferible un registro que falla y se
            // reintenta a uno que deja entrar a quien no debía.
            console.error('[auth] no se pudo consultar la lista de invitados:', error);
            throw new APIError('SERVICE_UNAVAILABLE', {
              message: 'No se pudo comprobar la invitación. Inténtalo en un momento.',
            });
          }

          if (!invitado) rechazar();
        },
      },
    },
  },

  session: {
    // Un planificador se abre a ratos a lo largo de meses. Pedir la contraseña
    // cada semana sería un impuesto sin contrapartida.
    expiresIn: 60 * 60 * 24 * 30,
    // La sesión se renueva como mucho una vez al día: sin esto, cada petición
    // escribiría en la colección `session`.
    updateAge: 60 * 60 * 24,

    // Sin esto, *cada* carga de página consulta la colección `session` en
    // Atlas antes de pintar nada. La copia firmada en la cookie evita ese
    // viaje durante cinco minutos; cerrar sesión la invalida igualmente,
    // porque la cookie se borra.
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
});
