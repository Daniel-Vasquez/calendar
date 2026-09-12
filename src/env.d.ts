/// <reference types="astro/client" />

/**
 * Lo que el middleware deja en cada petición. Los tipos se derivan de la
 * respuesta real de `auth.api.getSession` en vez de escribirlos a mano: si
 * algún día se añade un campo al usuario, aparece aquí solo.
 */
type AuthSession = Awaited<ReturnType<typeof import('./auth').auth.api.getSession>>;

declare namespace App {
  interface Locals {
    user: NonNullable<AuthSession>['user'] | null;
    session: NonNullable<AuthSession>['session'] | null;
  }
}
