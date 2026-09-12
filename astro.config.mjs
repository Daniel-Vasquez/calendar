// @ts-check
import { defineConfig, envField } from 'astro/config';
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [react()],

  /**
   * El sitio sigue siendo estático: `output` se queda en su valor de fábrica
   * y las páginas se prerenderizan igual que antes. Solo lo que lo pida a
   * mano —`export const prerender = false`— se resuelve en el servidor, que
   * de momento es únicamente `/api/health`.
   */
  adapter: vercel(),

  /**
   * Las variables del servidor se declaran aquí para que su ausencia se note
   * pronto y en claro. Sin esto, un `MONGODB_URI` que falte en Vercel se
   * manifiesta como un error de conexión a mitad de una petición; con esto,
   * el fallo nombra la variable que falta.
   */
  env: {
    schema: {
      MONGODB_URI: envField.string({ context: 'server', access: 'secret' }),
      // El nombre de la base manda sobre el que traiga la URI. Ver lib/mongo.ts.
      MONGODB_DB: envField.string({ context: 'server', access: 'secret', optional: true }),

      // Firma las cookies de sesión. Cambiarlo cierra la sesión de todo el mundo.
      BETTER_AUTH_SECRET: envField.string({ context: 'server', access: 'secret' }),
      // Origen público del sitio. Better Auth lo usa para construir las URLs
      // de sus rutas y para decidir qué orígenes son de fiar.
      BETTER_AUTH_URL: envField.string({ context: 'server', access: 'secret' }),
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
