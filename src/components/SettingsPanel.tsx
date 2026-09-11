import { useRef } from 'react';
import { DAY_COLORS, type ColorId } from '../lib/palette';
import { MAX_LABEL_LENGTH, type ColorLabels } from '../lib/labels';

type Props = {
  labels: ColorLabels;
  /** ¿Hay algo que exportar? Sin días guardados los botones no tienen sentido. */
  hasData: boolean;
  onRenameColor: (id: ColorId, label: string) => void;
  onExportJson: () => void;
  onExportIcs: () => void;
  onImport: (file: File) => void;
};

const ACTION =
  'rounded-xl border border-edge bg-white px-3.5 py-2 text-sm font-medium text-ink-soft ' +
  'transition-colors hover:bg-edge focus-visible:ring-2 focus-visible:ring-accent ' +
  'focus-visible:ring-offset-2 focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-white';

/**
 * Ajustes secundarios, plegados para no competir con el calendario: nombrar
 * los colores y sacar o meter los datos.
 */
export default function SettingsPanel({
  labels,
  hasData,
  onRenameColor,
  onExportJson,
  onExportIcs,
  onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onImport(file);
    // Sin limpiarlo, volver a elegir el mismo archivo no dispara `change`.
    event.target.value = '';
  }

  return (
    <details className="print-hidden mt-5 rounded-2xl border border-edge bg-surface px-4 py-3 sm:px-5">
      <summary className="cursor-pointer list-item text-sm font-semibold text-ink marker:text-ink-muted">
        Categorías y datos
      </summary>

      <div className="mt-4 grid gap-6 pb-2 md:grid-cols-2">
        <section>
          <h3 className="text-sm font-semibold text-ink-soft">Categorías de color</h3>
          <p className="mt-1 text-xs text-ink-muted">
            Ponle nombre a cada color y la leyenda dejará de decir «Rosa» para decir «Entrega».
          </p>

          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {DAY_COLORS.map((color) => (
              <li key={color.id} className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded"
                  style={{ backgroundColor: color.hex }}
                />
                <input
                  type="text"
                  value={labels[color.id] ?? ''}
                  // Vacío es un estado válido: el marcador enseña el nombre
                  // de fábrica que se usará mientras no haya otro.
                  placeholder={color.name}
                  maxLength={MAX_LABEL_LENGTH}
                  aria-label={`Nombre para el color ${color.name}`}
                  onChange={(event) => onRenameColor(color.id, event.target.value)}
                  className="w-full min-w-0 rounded-lg border border-edge bg-white px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none"
                />
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="text-sm font-semibold text-ink-soft">Copia de seguridad</h3>
          <p className="mt-1 text-xs text-ink-muted">
            El calendario vive solo en este navegador: vaciar los datos del sitio lo borra. Guarda
            una copia de vez en cuando.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onExportJson} disabled={!hasData} className={ACTION}>
              Exportar JSON
            </button>
            <button type="button" onClick={onExportIcs} disabled={!hasData} className={ACTION}>
              Exportar .ics
            </button>
            <button type="button" onClick={() => fileRef.current?.click()} className={ACTION}>
              Importar JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              onChange={pickFile}
              className="sr-only"
            />
          </div>

          <p className="mt-2 text-xs text-ink-muted">
            El <code>.json</code> vuelve a entrar aquí; el <code>.ics</code> lleva los días a
            Google Calendar, Outlook o Apple Calendario. Importar añade lo del archivo a lo que ya
            hay —y el aviso deja deshacerlo.
          </p>
        </section>
      </div>
    </details>
  );
}
