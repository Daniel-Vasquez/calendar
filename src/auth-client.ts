import { createAuthClient } from 'better-auth/react';

/**
 * Origen contra el que habla el navegador. La API vive en la misma página, así
 * que es el suyo propio.
 *
 * Se fija a mano en vez de dejar que Better Auth lo deduzca. Su valor por
 * defecto sale de `process.env.BETTER_AUTH_URL`, y `createAuthClient` lanza si
 * esa variable no trae esquema. Como este módulo se construye al importarse y
 * lo importan NavBar y LoginForm, esa excepción tumbaba el renderizado de
 * todas las páginas —y solo en producción, porque en `astro dev` las variables
 * del `.env` llegan a `import.meta.env` pero no a `process.env`, así que el
 * valor por defecto nunca se leía—.
 *
 * En el servidor el valor da igual: el cliente solo se usa desde manejadores
 * de eventos del navegador. Está ahí porque destructurar de él más abajo
 * obliga a construirlo también al renderizar.
 */
const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;

export const authClient = createAuthClient({ baseURL: origin });

export const { signIn, signUp, signOut } = authClient;
