import { useId, useState, type SyntheticEvent } from 'react';
import { signIn, signUp } from '../auth-client';

type Mode = 'signIn' | 'signUp';

type Props = {
  /** Ruta a la que volver tras entrar. La pone el middleware al desviar aquí. */
  next: string;
};

const FIELD =
  'w-full rounded-xl border border-edge bg-white px-4 py-2.5 text-sm text-ink ' +
  'placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/30 ' +
  'focus:outline-none disabled:opacity-60';

const LABEL = 'mb-1.5 block text-sm font-medium text-ink-soft';

/**
 * Entrar o crear la cuenta, en el mismo formulario. El registro pide el nombre
 * —es el que Better Auth guarda en la colección `user`— y el acceso no.
 */
export default function LoginForm({ next }: Props) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const emailId = useId();
  const passwordId = useId();

  const creating = mode === 'signUp';

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);

    const result = creating
      ? await signUp.email({ name: name.trim(), email: email.trim(), password })
      : await signIn.email({ email: email.trim(), password });

    if (result.error) {
      setBusy(false);
      setError(translate(result.error.code, result.error.message));
      return;
    }

    // Navegación completa y no `history.pushState`: la cookie de sesión acaba
    // de nacer y la página de destino se pinta en el servidor, que tiene que
    // verla para no rebotar de vuelta aquí.
    window.location.href = next;
  }

  function switchMode() {
    setMode(creating ? 'signIn' : 'signUp');
    setError('');
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {creating && (
        <div>
          <label htmlFor={nameId} className={LABEL}>
            Nombre
          </label>
          <input
            id={nameId}
            type="text"
            required
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            placeholder="Cómo quieres que te llame"
            className={FIELD}
          />
        </div>
      )}

      <div>
        <label htmlFor={emailId} className={LABEL}>
          Correo
        </label>
        <input
          id={emailId}
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
          placeholder="tu@correo.com"
          className={FIELD}
        />
      </div>

      <div>
        <label htmlFor={passwordId} className={LABEL}>
          Contraseña
        </label>
        <input
          id={passwordId}
          type="password"
          required
          minLength={8}
          autoComplete={creating ? 'new-password' : 'current-password'}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={busy}
          placeholder={creating ? 'Al menos 8 caracteres' : '••••••••'}
          className={FIELD}
        />
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-highlight/40 bg-highlight-soft px-4 py-2.5 text-sm font-medium text-highlight"
        >
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="mt-1 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-accent-strong disabled:cursor-wait disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
      >
        {busy ? 'Un momento…' : creating ? 'Crear cuenta' : 'Entrar'}
      </button>

      <p className="text-center text-sm text-ink-muted">
        {creating ? '¿Ya tienes cuenta?' : '¿Primera vez?'}{' '}
        <button
          type="button"
          onClick={switchMode}
          className="rounded font-semibold text-accent-strong underline underline-offset-2 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          {creating ? 'Entrar' : 'Crear una cuenta'}
        </button>
      </p>
    </form>
  );
}

/**
 * Los códigos de Better Auth vienen en inglés y algunos son crípticos. Se
 * traducen los que alguien va a ver de verdad; el resto cae en su mensaje
 * original, que es más útil que un "algo ha fallado".
 */
function translate(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case 'INVALID_EMAIL_OR_PASSWORD':
      return 'Correo o contraseña incorrectos.';
    case 'USER_ALREADY_EXISTS':
      return 'Ya hay una cuenta con ese correo. Prueba a entrar.';
    case 'PASSWORD_TOO_SHORT':
      return 'La contraseña necesita al menos 8 caracteres.';
    case 'INVALID_EMAIL':
      return 'Ese correo no tiene buena pinta.';
    default:
      return fallback || 'No se pudo completar la operación.';
  }
}
