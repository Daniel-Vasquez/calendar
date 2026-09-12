import { betterAuth } from 'better-auth';
import { mongodbAdapter } from '@better-auth/mongo-adapter';
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from 'astro:env/server';
import { getClient, getDb } from './lib/mongo';

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
  baseURL: BETTER_AUTH_URL,

  emailAndPassword: {
    enabled: true,
    // No hay servidor de correo, así que no hay a dónde mandar la
    // verificación. Es un calendario personal: la cuenta vale desde que nace.
    requireEmailVerification: false,
    minPasswordLength: 8,
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
