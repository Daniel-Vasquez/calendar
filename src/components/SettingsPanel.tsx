import { useState, useRef } from 'react';
import {
  DAY_COLORS,
  hexFor,
  isDefaultPalette,
  MAX_LABEL_LENGTH,
  type ColorId,
  type ColorPalette,
} from '../lib/palette';
import TelegramSettings from './TelegramSettings';

type Props = {
  palette: ColorPalette;
  /** ¿Hay algo que exportar? Sin días guardados los botones no tienen sentido. */
  hasData: boolean;
  onRenameColor: (id: ColorId, label: string) => void;
  /** Cambia el tono de una categoría. Llega `#rrggbb`, que es lo que emite el campo. */
  onRecolor: (id: ColorId, hex: string) => void;
  /** Devuelve los ocho colores a los nombres y tonos de fábrica. */
  onResetPalette: () => void;
  onExportJson: () => void;
  onExportIcs: () => void;
  onImport: (file: File) => void;
};

/** El cuadrito de color. Sin el relleno nativo, que le deja un marco gris. */
const SWATCH =
  'h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-edge bg-raised p-1 ' +
  'transition-colors hover:border-accent ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none ' +
  '[&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-md ' +
  '[&::-webkit-color-swatch]:border-none [&::-moz-color-swatch]:rounded-md ' +
  '[&::-moz-color-swatch]:border-none';

const ACTION =
  'rounded-xl border border-edge bg-raised px-3.5 py-2 text-sm font-medium text-ink-soft ' +
  'transition-colors hover:bg-edge focus-visible:ring-2 focus-visible:ring-accent ' +
  'focus-visible:ring-offset-2 focus-visible:outline-none ' +
  'disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-raised';

/**
 * Ajustes secundarios: nombrar y teñir los colores, y sacar o meter los datos.
 * Es solo el contenido; el marco (cabecera, cierre, animación) lo pone
 * SettingsModal, que lo abre desde el engrane de la cabecera.
 */
export default function SettingsPanel({
  palette,
  hasData,
  onRenameColor,
  onRecolor,
  onResetPalette,
  onExportJson,
  onExportIcs,
  onImport,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  /**
   * Restablecer pregunta antes. No borra ningún día, pero sí los ocho nombres
   * de una vez, y eso no se recupera solo: aquí no hay deshacer como en el pie
   * del calendario, porque la paleta no viaja con los datos.
   */
  const [confirmingReset, setConfirmingReset] = useState(false);

  function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onImport(file);
    // Sin limpiarlo, volver a elegir el mismo archivo no dispara `change`.
    event.target.value = '';
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section>
        <h3 className="text-sm font-semibold text-ink-soft">Categorías de color</h3>
        <p className="mt-1 text-xs text-ink-muted">
          Ponle nombre a cada color y la leyenda dejará de decir «Rosa» para decir «Entrega». El
          cuadrito abre el tono: lo que elijas repinta al momento todos los días de esa categoría,
          sus notas y sus recordatorios.
        </p>

        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {DAY_COLORS.map((color) => {
            const tone = hexFor(palette, color.id);
            return (
              <li key={color.id} className="flex items-center gap-2">
                {/* El día guarda el id de la categoría, nunca este valor, así
                    que cambiarlo no toca ni un solo día: solo el tono con el
                    que se dibujan. Ver `palette.ts`. */}
                <input
                  type="color"
                  value={tone}
                  aria-label={`Color de ${color.name}`}
                  title={`${color.name} · ${tone}`}
                  onChange={(event) => onRecolor(color.id, event.target.value)}
                  className={SWATCH}
                />
                <input
                  type="text"
                  value={palette[color.id]?.name ?? ''}
                  // Vacío es un estado válido: el marcador enseña el nombre
                  // de fábrica que se usará mientras no haya otro.
                  placeholder={color.name}
                  maxLength={MAX_LABEL_LENGTH}
                  aria-label={`Nombre para el color ${color.name}`}
                  onChange={(event) => onRenameColor(color.id, event.target.value)}
                  className="w-full min-w-0 rounded-lg border border-edge bg-raised px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none"
                />
              </li>
            );
          })}
        </ul>

        {/* Deshabilitado cuando no hay nada que deshacer: así el botón también
            responde a «¿le he cambiado algo a esto?». */}
        <div className="mt-3">
          {confirmingReset ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-ink-soft">
                Se perderán los nombres y los tonos que hayas puesto.
              </span>
              <button
                type="button"
                onClick={() => {
                  onResetPalette();
                  setConfirmingReset(false);
                }}
                className={
                  ACTION + ' border-highlight/40 bg-highlight-soft text-highlight hover:bg-highlight hover:text-white'
                }
              >
                Restablecer
              </button>
              <button type="button" onClick={() => setConfirmingReset(false)} className={ACTION}>
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              disabled={isDefaultPalette(palette)}
              onClick={() => setConfirmingReset(true)}
              className={ACTION}
            >
              Restablecer paleta predeterminada
            </button>
          )}
        </div>
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

      <TelegramSettings />
    </div>
  );
}
