import { useId, useRef, useState } from 'react';
import {
  DAY_COLORS,
  hexFor,
  isDefaultPalette,
  MAX_LABEL_LENGTH,
  type ColorId,
  type ColorPalette,
} from '../lib/palette';
import {
  cleanLabel,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  slugify,
  type Tag,
} from '../lib/tags';
import Fold from './Fold';
import Legend from './Legend';
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
  /** Las etiquetas que existen. Ver `tags.ts`. */
  catalogue: Tag[];
  /** En cuántos días está puesta cada una, por `slug`. Se dice antes de borrar. */
  tagUsage: Record<string, number>;
  onAddTag: (label: string) => void;
  onDeleteTag: (slug: string) => void;
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

/** Las cuatro secciones plegables, en el orden en que se pintan. */
type Section = 'colores' | 'etiquetas' | 'copia' | 'telegram';

/**
 * Ajustes secundarios: nombrar y teñir los colores, administrar las etiquetas y
 * sacar o meter los datos.
 * Es solo el contenido; el marco (cabecera, cierre, animación) lo pone
 * SettingsModal, que lo abre desde el engrane de la cabecera.
 *
 * Las cuatro secciones son un acordeón **exclusivo**: cabían en dos columnas,
 * pero entonces el modal pedía toda la pantalla para enseñar cuatro cosas que
 * casi nunca se tocan a la vez. Plegadas, los cuatro rótulos se leen de un
 * vistazo y solo se despliega aquella a la que se viene; de ahí que abrir una
 * cierre la anterior. La leyenda va aparte, fija al fondo: no es un ajuste
 * sino la chuleta de lo que se ve en la rejilla.
 */
export default function SettingsPanel({
  palette,
  hasData,
  onRenameColor,
  onRecolor,
  onResetPalette,
  catalogue,
  tagUsage,
  onAddTag,
  onDeleteTag,
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
  /** La única sección desplegada. Se entra por los colores, que es lo más pedido. */
  const [openSection, setOpenSection] = useState<Section | null>('colores');

  /** Abrir una cierra las demás; volver a pulsarla la pliega y no queda ninguna. */
  const fold = (section: Section) => ({
    open: openSection === section,
    onToggle: () => setOpenSection((current) => (current === section ? null : section)),
  });

  function pickFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onImport(file);
    // Sin limpiarlo, volver a elegir el mismo archivo no dispara `change`.
    event.target.value = '';
  }

  return (
    <>
      {/* Un acordeón exclusivo: solo `openSection` está desplegada. */}
      <div className="grid gap-2">
        <Fold title="Categorías de color" {...fold('colores')}>
          <p className="text-xs text-ink-muted">
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
        </Fold>

        <Fold title="Etiquetas" {...fold('etiquetas')}>
          <TagSettings
            catalogue={catalogue}
            usage={tagUsage}
            onAdd={onAddTag}
            onDelete={onDeleteTag}
          />
        </Fold>

        <Fold title="Copia de seguridad" {...fold('copia')}>
          <p className="text-xs text-ink-muted">
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
        </Fold>

        <Fold title="Recordatorios por Telegram" {...fold('telegram')}>
          <TelegramSettings />
        </Fold>
      </div>

      <Legend palette={palette} />
    </>
  );
}

/**
 * Alta y baja de etiquetas. El rótulo y el plegado los pone el Fold que lo
 * envuelve; aquí empieza ya el contenido.
 *
 * Solo eso: no se renombran. Cambiar el rótulo de una etiqueta cambiaría su
 * identidad —el `slug` sale del texto— y dejaría a los días apuntando a algo
 * que ya no existe, así que sería borrar y crear con otro nombre disfrazado de
 * edición. Quien quiera eso puede hacerlo en dos pasos, viendo lo que pierde.
 */
function TagSettings({
  catalogue,
  usage,
  onAdd,
  onDelete,
}: {
  catalogue: Tag[];
  usage: Record<string, number>;
  onAdd: (label: string) => void;
  onDelete: (slug: string) => void;
}) {
  const [draft, setDraft] = useState('');
  /** Qué etiqueta está preguntando si de verdad. Una cada vez. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const inputId = useId();

  const clean = cleanLabel(draft);
  const slug = slugify(clean);
  const repeated = Boolean(slug) && catalogue.some((tag) => tag.slug === slug);
  const full = catalogue.length >= MAX_TAGS;
  const canAdd = Boolean(slug) && !repeated && !full;

  function add() {
    if (!canAdd) return;
    onAdd(clean);
    setDraft('');
  }

  return (
    <div>
      <p className="text-xs text-ink-muted">
        Clasifican un día por lo que es —«Trabajo», «Descanso»— al margen de su color, y se ponen
        desde la nota o el recordatorio. Las etiquetas viajan con el día; esta lista es de este
        navegador.
      </p>

      {catalogue.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {catalogue.map((tag) => {
            const count = usage[tag.slug] ?? 0;
            const asking = confirming === tag.slug;

            return (
              <li key={tag.slug}>
                {asking ? (
                  <span className="flex items-center gap-1 rounded-full border border-highlight/40 bg-highlight-soft py-1 pr-1 pl-3 text-xs font-medium text-highlight">
                    {count > 0
                      ? `¿Quitar «${tag.label}» de ${count} ${count === 1 ? 'día' : 'días'}?`
                      : `¿Borrar «${tag.label}»?`}
                    <button
                      type="button"
                      onClick={() => {
                        onDelete(tag.slug);
                        setConfirming(null);
                      }}
                      className="rounded-full bg-highlight px-2 py-0.5 font-semibold text-white transition-colors hover:brightness-90 focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:outline-none"
                    >
                      Sí
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(null)}
                      className="rounded-full px-2 py-0.5 text-ink-soft transition-colors hover:bg-edge focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                    >
                      No
                    </button>
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full border border-edge bg-raised py-1 pr-1 pl-3 text-xs font-medium text-ink-soft">
                    {tag.label}
                    {count > 0 && <span className="text-ink-muted tabular-nums">{count}</span>}
                    <button
                      type="button"
                      onClick={() => setConfirming(tag.slug)}
                      aria-label={`Borrar la etiqueta ${tag.label}`}
                      title={
                        count > 0
                          ? `Borrar «${tag.label}» y quitarla de ${count} ${count === 1 ? 'día' : 'días'}`
                          : `Borrar «${tag.label}»`
                      }
                      className="rounded-full p-1 text-ink-muted transition-colors hover:bg-highlight-soft hover:text-highlight focus-visible:ring-2 focus-visible:ring-highlight focus-visible:outline-none"
                    >
                      <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                        <path
                          d="M4 4l8 8M12 4l-8 8"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mt-3 rounded-xl border border-dashed border-edge bg-surface px-3 py-4 text-center text-xs text-ink-muted">
          No queda ninguna. Crea la primera aquí abajo.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Nueva etiqueta
        </label>
        <input
          id={inputId}
          type="text"
          value={draft}
          maxLength={MAX_TAG_LENGTH}
          placeholder={full ? `Máximo ${MAX_TAGS} etiquetas` : 'Nueva etiqueta…'}
          disabled={full}
          onChange={(event) => setDraft(event.target.value)}
          // Enter añade, que es lo que se espera de un campo con un botón al
          // lado. No hay `<form>`: este panel vive dentro de un modal y un
          // envío de verdad recargaría la página.
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
          className="w-full min-w-0 rounded-lg border border-edge bg-raised px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button type="button" onClick={add} disabled={!canAdd} className={ACTION}>
          Añadir
        </button>
      </div>

      {repeated && (
        <p className="mt-1.5 text-xs font-medium text-highlight">
          «{clean}» ya está en la lista.
        </p>
      )}
    </div>
  );
}
