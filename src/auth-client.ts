import { createAuthClient } from 'better-auth/react';

/**
 * Contraparte de `auth.ts` en el navegador. No lleva `baseURL`: la API vive en
 * el mismo origen que la página, y fijarlo a mano solo sirve para que deje de
 * funcionar el día que cambie el dominio.
 */
export const authClient = createAuthClient();

export const { signIn, signUp, signOut } = authClient;
