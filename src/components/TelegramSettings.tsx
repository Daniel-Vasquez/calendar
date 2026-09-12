import { useCallback, useEffect, useState } from 'react';

/**
 * Vincular Telegram para recibir los recordatorios.
 *
 * A nadie se le pide su «chat ID»: averiguarlo pasa por el token del bot, que
 * es lo último que se le puede enseñar a un usuario. En su lugar el servidor
 * entrega un enlace con un código dentro, la persona pulsa Start y vuelve a
 * pulsar Comprobar. Ver `pages/api/telegram.ts`.
 */

const ACTION =
  'rounded-xl border border-edge bg-white px-3.5 py-2 text-sm font-medium text-ink-soft ' +
  'transition-colors hover:bg-edge focus-visible:ring-2 focus-visible:ring-accent ' +
  'focus-visible:ring-offset-2 focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-white';

const PRIMARY =
  'rounded-xl bg-accent px-3.5 py-2 text-sm font-semibold text-white transition-colors ' +
  'hover:bg-accent-strong focus-visible:ring-2 focus-visible:ring-accent ' +
  'focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60';

type Status = {
  configured: boolean;
  connected: boolean;
  name?: string;
  blocked?: boolean;
  missing?: string;
};

type Note = { kind: 'ok' | 'bad'; text: string } | null;

/** Lee el `error` que devuelven las rutas, o se inventa uno con el código. */
async function failureOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string; reason?: string };
    return body.error ?? body.reason ?? `El servidor respondió ${response.status}.`;
  } catch {
    return `El servidor respondió ${response.status}.`;
  }
}

export default function TelegramSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [linkUrl, setLinkUrl] = useState('');
  const [busy, setBusy] = useState<'' | 'check' | 'test' | 'unlink'>('');
  const [note, setNote] = useState<Note>(null);

  /** Pide un enlace nuevo. Solo se llama sin vincular: `link` suelta el chat anterior. */
  const mintLink = useCallback(async () => {
    try {
      const response = await fetch('/api/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'link' }),
      });
      if (!response.ok) return;
      const body = (await response.json()) as { url?: string };
      if (body.url) setLinkUrl(body.url);
    } catch {
      /* Sin enlace se queda el paso 1 sin botón, y el aviso lo da Comprobar. */
    }
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch('/api/telegram', { headers: { accept: 'application/json' } });
        if (!response.ok) return;
        const body = (await response.json()) as Status;
        if (!alive) return;
        setStatus(body);
        // El enlace se prepara ya, para que el botón del paso 1 sea un enlace
        // de verdad: abrirlo tras un `await` lo pararía el bloqueador.
        if (body.configured && !body.connected) await mintLink();
      } catch {
        if (alive) setStatus({ configured: false, connected: false, missing: 'la conexión' });
      }
    })();
    return () => {
      alive = false;
    };
  }, [mintLink]);

  async function post(action: 'check' | 'test') {
    setBusy(action);
    setNote(null);
    try {
      const response = await fetch('/api/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        setNote({ kind: 'bad', text: await failureOf(response) });
        return;
      }

      const body = (await response.json()) as { connected?: boolean; name?: string; reason?: string };

      if (action === 'test') {
        setNote({ kind: 'ok', text: 'Mensaje enviado. Míralo en Telegram.' });
        return;
      }

      if (body.connected) {
        setStatus({ configured: true, connected: true, ...(body.name ? { name: body.name } : {}) });
        setNote({ kind: 'ok', text: 'Conectado. Te he mandado un mensaje para confirmarlo.' });
      } else {
        setNote({ kind: 'bad', text: body.reason ?? 'Todavía no me ha llegado nada.' });
      }
    } catch {
      setNote({ kind: 'bad', text: 'Sin conexión con el servidor.' });
    } finally {
      setBusy('');
    }
  }

  async function unlink() {
    setBusy('unlink');
    setNote(null);
    try {
      const response = await fetch('/api/telegram', { method: 'DELETE' });
      if (!response.ok) {
        setNote({ kind: 'bad', text: await failureOf(response) });
        return;
      }
      setStatus({ configured: true, connected: false });
      setLinkUrl('');
      await mintLink();
    } catch {
      setNote({ kind: 'bad', text: 'Sin conexión con el servidor.' });
    } finally {
      setBusy('');
    }
  }

  return (
    <section>
      <h3 className="text-sm font-semibold text-ink-soft">Recordatorios por Telegram</h3>

      {status === null ? (
        <p className="mt-1 text-xs text-ink-muted">Comprobando…</p>
      ) : !status.configured ? (
        <p className="mt-1 text-xs text-ink-muted">
          El servidor todavía no tiene el bot configurado{' '}
          {status.missing ? (
            <>
              (falta <code>{status.missing}</code>)
            </>
          ) : null}
          . Los recordatorios se guardan igual; cuando el bot esté puesto, empezarán a llegar.
        </p>
      ) : status.connected ? (
        <>
          <p className="mt-1 text-xs text-ink-muted">
            Conectado{status.name ? <> como <strong className="text-ink-soft">{status.name}</strong></> : null}.
            Los avisos de cada día llegarán a ese chat.
          </p>
          {status.blocked && (
            <p className="mt-2 text-xs font-medium text-highlight">
              La última vez Telegram dijo que el bot está bloqueado. Desbloquéalo en la
              aplicación y prueba otra vez.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => post('test')} disabled={busy !== ''} className={ACTION}>
              {busy === 'test' ? 'Enviando…' : 'Enviar prueba'}
            </button>
            <button type="button" onClick={unlink} disabled={busy !== ''} className={ACTION}>
              {busy === 'unlink' ? 'Desconectando…' : 'Desconectar'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-1 text-xs text-ink-muted">
            Tres pasos y no hay nada que copiar. Un bot no puede escribirte primero: hasta que no
            abras el chat y pulses Start, Telegram no le deja mandarte nada.
          </p>

          <ol className="mt-3 space-y-2.5 text-xs text-ink-soft">
            <li className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink-muted">1.</span>
              {linkUrl ? (
                <a href={linkUrl} target="_blank" rel="noopener noreferrer" className={PRIMARY}>
                  Abrir el chat del bot
                </a>
              ) : (
                <span className="text-ink-muted">Preparando el enlace…</span>
              )}
            </li>
            <li className="flex items-center gap-2">
              <span className="font-semibold text-ink-muted">2.</span>
              Pulsa <strong>Start</strong> allí.
            </li>
            <li className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink-muted">3.</span>
              Vuelve aquí y
              <button
                type="button"
                onClick={() => post('check')}
                disabled={busy !== '' || !linkUrl}
                className={ACTION}
              >
                {busy === 'check' ? 'Comprobando…' : 'Comprobar conexión'}
              </button>
            </li>
          </ol>
        </>
      )}

      {note && (
        <p
          role="status"
          className={
            'mt-3 text-xs font-medium ' + (note.kind === 'ok' ? 'text-accent-strong' : 'text-highlight')
          }
        >
          {note.text}
        </p>
      )}
    </section>
  );
}
