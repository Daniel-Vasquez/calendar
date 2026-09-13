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

      /*
       * Los recordatorios por Telegram. Van declarados como opcionales a
       * propósito, al revés que los de arriba: sin ellos el calendario
       * funciona entero y solo deja de haber avisos. Si fueran obligatorios,
       * olvidar uno tumbaría el sitio completo por una función accesoria.
       * Quien los necesita comprueba que estén y responde nombrando el que
       * falte.
       *
       * El token es la llave entera del bot: con él se lee todo lo que le
       * llega y se escribe a cualquiera que lo haya arrancado. Nunca sale del
       * servidor y nunca se guarda en Mongo.
       */
      TELEGRAM_BOT_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
      // El `@algo_bot` de BotFather. No es secreto —va dentro del enlace que
      // se le da a la gente—, pero se sirve desde el servidor para no tener
      // que arrastrarlo por media aplicación como propiedad.
      TELEGRAM_BOT_USERNAME: envField.string({ context: 'server', access: 'secret', optional: true }),
      // Autoriza al programador externo a disparar el envío. Ver
      // `pages/api/cron/reminders.ts`.
      CRON_SECRET: envField.string({ context: 'server', access: 'secret', optional: true }),

      /*
       * Cloudinary, donde viven los bytes de los adjuntos. Obligatorias, al
       * revés que las de Telegram: sin ellas no se puede ni guardar una
       * imagen ni enseñar una ya guardada, así que fallar pronto y nombrando
       * la que falta es mejor que descubrirlo al adjuntar.
       *
       * La *API Environment Variable* (`CLOUDINARY_URL`) **no se declara**: el
       * SDK la buscaría en `process.env`, donde el `.env` no llega en
       * `astro dev`, y funcionaría en producción y no en local. Las tres
       * piezas van por separado y se configuran a mano en `lib/cloudinary.ts`.
       */
      CLOUDINARY_CLOUD_NAME: envField.string({ context: 'server', access: 'secret' }),
      CLOUDINARY_API_KEY: envField.string({ context: 'server', access: 'secret' }),
      // Firma las subidas y las URLs. Nunca `access: 'public'`: con ella se
      // puede subir, borrar y firmar cualquier cosa de la nube.
      CLOUDINARY_API_SECRET: envField.string({ context: 'server', access: 'secret' }),
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
