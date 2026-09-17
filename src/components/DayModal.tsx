import { useEffect, useId, useRef, useState } from 'react';
import {
  dayHref,
  formatLongDate,
  formatWeekday,
  isCovered,
  MAX_DATE,
  MIN_DATE,
  YEARS_LABEL,
} from '../lib/calendar';
import {
  colorVar,
  DAY_COLORS,
  DEFAULT_COLOR,
  labelFor,
  type ColorId,
  type ColorPalette,
} from '../lib/palette';
import { dataUrlBytes, IMAGE_ACCEPT, MAX_IMAGES_PER_DAY, prepareImage, srcOf } from '../lib/image';
import { hasContent, imageCount, imagesReady, type DayEntry } from '../lib/storage';
import { isDateKey } from '../lib/wire';
import { sanitizeTags, type Tag } from '../lib/tags';
import { TagPicker } from './TagChips';
import { tombsFor, type Reminder } from '../lib/reminder';
import ReminderField from './ReminderField';
import { useDialog } from './useDialog';

type Props = {
  dateKey: string;
  entry?: DayEntry;
  /** Los nombres y tonos que el usuario les haya puesto (ver SettingsPanel). */
  palette: ColorPalette;
  /** Las etiquetas que existen. Se administran en Ajustes; ver `tags.ts`. */
  catalogue: Tag[];
  onSave: (key: string, entry: DayEntry) => void;
  onClear: (key: string) => void;
  onClose: () => void;
  /**
   * Pide al servidor los adjuntos de este día. Hace falta porque las imágenes
   * ya no viajan con el calendario: en un dispositivo recién estrenado, el día
   * llega sabiendo cuántas tiene pero sin ninguna.
   */
  onNeedImages: (key: string) => Promise<void>;
  /**
   * Mueve el día entero a otra fecha, con lo tecleado dentro. Opcional: solo
   * lo pasa la agenda, donde la fecha es un campo más del día. En la rejilla no
   * tiene sentido —el sitio de la casilla *es* la fecha— y sin este `onMove` el
   * modal no enseña el campo, así que allí todo sigue igual.
   */
  onMove?: (from: string, to: string, entry: DayEntry) => void;
  /**
   * ¿Hay algo guardado ese día? Se pregunta por el **destino** de la mudanza,
   * para avisar antes de pisarlo. Solo hace falta con `onMove`.
   */
  hasDay?: (key: string) => boolean;
  /**
   * Enseña el enlace al día en el calendario. Lo enciende quien abre el modal
   * fuera de la rejilla: desde la propia rejilla no lleva a ninguna parte.
   */
  showCalendarLink?: boolean;
  /** Botón desde el que se abrió, si lo hay: a él vuelve el foco al cerrarse. */
  triggerRef?: React.RefObject<HTMLElement | null>;
};

const FIELD =
  'w-full rounded-xl border border-edge bg-raised px-4 py-2.5 text-sm text-ink ' +
  'focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

const IMAGE_ACTION =
  'rounded-lg border border-edge bg-raised px-3 py-1.5 text-xs font-medium text-ink-soft ' +
  'transition-colors hover:bg-edge disabled:cursor-wait disabled:opacity-60 ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none';

/** "120 KB" o "1.4 MB" a partir de bytes. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** ¿Mismas imágenes en el mismo orden? Decide si el pie avisa de cambios sin guardar. */
function sameImages(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((image, i) => image === b[i]);
}

export default function DayModal({
  dateKey,
  entry,
  palette,
  catalogue,
  onSave,
  onClear,
  onClose,
  onNeedImages,
  onMove,
  hasDay,
  showCalendarLink = false,
  triggerRef,
}: Props) {
  const [marked, setMarked] = useState(entry?.marked ?? false);
  const [note, setNote] = useState(entry?.note ?? '');
  const [color, setColor] = useState<ColorId>(entry?.color ?? DEFAULT_COLOR);
  /** Data URL de cada imagen adjunta, en el orden en que se añadieron. */
  const [images, setImages] = useState<string[]>(entry?.images ?? []);
  const [reminders, setReminders] = useState<Reminder[]>(entry?.reminders ?? []);
  const [tags, setTags] = useState<string[]>(entry?.tags ?? []);
  /** Fecha elegida. Mientras nadie la toque es la del día que se abrió. */
  const [day, setDay] = useState(dateKey);
  const [imageError, setImageError] = useState('');
  const [processing, setProcessing] = useState(false);
  /** La descarga de adjuntos falló: se avisa y se protege lo que hay arriba. */
  const [imagesLost, setImagesLost] = useState(false);
  const noteId = useId();
  const titleId = useId();
  const dayId = useId();
  const imageHelpId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachRef = useRef<HTMLButtonElement>(null);

  const hasStoredData = Boolean(entry && hasContent(entry));
  const total = imageCount(entry);
  /** ¿Están aquí todas las que el día dice tener? */
  const ready = imagesReady(entry);

  // El modal se reutiliza entre días: resincroniza el borrador al cambiar de fecha.
  useEffect(() => {
    setMarked(entry?.marked ?? false);
    setNote(entry?.note ?? '');
    setColor(entry?.color ?? DEFAULT_COLOR);
    setImages(entry?.images ?? []);
    setReminders(entry?.reminders ?? []);
    setTags(entry?.tags ?? []);
    setDay(dateKey);
    setImageError('');
  }, [
    dateKey,
    entry?.marked,
    entry?.note,
    entry?.color,
    entry?.images,
    entry?.reminders,
    entry?.tags,
  ]);

  useEffect(() => {
    closeRef.current?.focus();
  }, [dateKey]);

  // Al cerrarse, el foco vuelve a donde estaba. Solo cuando quien abre el modal
  // dice desde dónde: la rejilla no lo pasa y allí el foco ya lo recupera la
  // casilla. Se captura al montar, porque al desmontar el `ref` puede haberse
  // quedado sin nodo.
  useEffect(() => {
    const trigger = triggerRef?.current;
    return () => trigger?.focus();
  }, [triggerRef]);

  // Los adjuntos se piden al abrir, no al cargar el calendario: son megas, y
  // la inmensa mayoría de los días no se llegan a abrir.
  useEffect(() => {
    if (ready) {
      setImagesLost(false);
      return;
    }
    let alive = true;
    void onNeedImages(dateKey).then(() => {
      // Si tras el intento siguen sin estar, no las hay o la red falló.
      if (alive) setImagesLost(true);
    });
    return () => {
      alive = false;
    };
  }, [dateKey, ready, onNeedImages]);

  // Escape cierra, Tab queda atrapado y el fondo no hace scroll.
  useDialog(panelRef, onClose);

  // Elegir un color implica querer el día marcado.
  function pickColor(next: ColorId) {
    setColor(next);
    setMarked(true);
  }

  const remaining = MAX_IMAGES_PER_DAY - images.length;
  const missing = Math.max(0, total - images.length);
  /**
   * Lo que pesa lo que todavía no ha subido. De una imagen ya guardada no se
   * sabe aquí lo que ocupa —este navegador solo tiene su referencia—, y
   * tampoco hace falta: el tamaño se enseñaba por la cuota de localStorage, y
   * de eso ya no depende nada.
   */
  const totalBytes = images.reduce((sum, image) => sum + dataUrlBytes(image), 0);
  const unsaved = !sameImages(images, entry?.images ?? []);

  /** ¿Se puede mudar el día de fecha? Solo si quien abrió el modal sabe moverlo. */
  const movable = Boolean(onMove);
  const validDay = isDateKey(day) && isCovered(day);
  const moves = movable && validDay && day !== dateKey;
  /** El destino ya tiene día y solo cabe uno: se avisa antes de pisarlo. */
  const overwrites = moves && Boolean(hasDay?.(day));

  /**
   * Procesa los archivos elegidos uno a uno, en orden, hasta llenar el cupo.
   * Los que fallen se anuncian juntos al final sin frenar a los demás.
   */
  async function pickImages(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Sin limpiarlo, volver a elegir el mismo archivo no dispara `change`.
    event.target.value = '';
    if (files.length === 0) return;

    setImageError('');
    setProcessing(true);

    const accepted: string[] = [];
    const problems: string[] = [];
    for (const file of files.slice(0, remaining)) {
      const result = await prepareImage(file);
      if (result.ok) accepted.push(result.dataUrl);
      else problems.push(`${file.name}: ${result.reason}`);
    }
    if (files.length > remaining) {
      problems.push(
        `Solo caben ${MAX_IMAGES_PER_DAY} imágenes por día; se omitieron ${files.length - remaining}.`,
      );
    }

    setProcessing(false);
    // Una misma imagen dos veces no aporta nada y duplicaría su peso.
    setImages((current) => [
      ...current,
      ...accepted.filter((image, i) => !current.includes(image) && accepted.indexOf(image) === i),
    ]);
    setImageError(problems.join(' '));
  }

  /**
   * El día tal y como quedaría al guardar.
   *
   * Si los adjuntos no han llegado a este navegador se conservan intactos los
   * campos que los describen. Sin esta salvedad, abrir un día en el móvil
   * —donde aún no se han descargado— y pulsar Guardar borraría las imágenes
   * de la cuenta, que es la peor forma posible de perder datos.
   */
  function draft(): DayEntry {
    /*
     * Los avisos que había y ya no están dejan su lápida. Se calcula aquí
     * porque este modal construye el día **entero** por su cuenta, sin pasar
     * por `removeReminder`: quitar una fila del campo de recordatorios solo
     * emite una lista más corta, y sin esto ese borrado se desharía solo en
     * cuanto otro dispositivo volviera a subir su versión del día.
     */
    const removed = tombsFor(entry?.reminders, reminders, entry?.removedReminders);

    if (!ready) {
      // `entry` puede traer recordatorios o etiquetas que aquí se acaban de
      // quitar, así que los campos se sueltan primero y se vuelven a poner
      // solo si siguen vivos.
      const {
        reminders: _previous,
        removedReminders: _lapidas,
        tags: _dropped,
        ...rest
      } = entry ?? ({} as DayEntry);
      return {
        ...rest,
        marked,
        note: note.trim(),
        color,
        ...(reminders.length ? { reminders } : {}),
        ...(removed.length ? { removedReminders: removed } : {}),
        ...(tags.length ? { tags: sanitizeTags(tags) } : {}),
      };
    }

    // Si cambian las imágenes, la miniatura que había ya no las representa.
    // Se descarta y la sincronía genera otra al subirlas.
    const keepThumb = sameImages(images, entry?.images ?? []) ? entry?.thumb : undefined;

    return {
      marked,
      note: note.trim(),
      color,
      ...(images.length ? { images, imageCount: images.length } : {}),
      ...(keepThumb ? { thumb: keepThumb } : {}),
      ...(reminders.length ? { reminders } : {}),
      ...(removed.length ? { removedReminders: removed } : {}),
      ...(tags.length ? { tags: sanitizeTags(tags) } : {}),
    };
  }

  /**
   * Guarda el borrador. Con la fecha tocada es una mudanza —el día entero se va
   * a la fecha nueva—; con la fecha intacta, el guardado de siempre. Van por la
   * misma puerta porque para quien edita son lo mismo: pulsar Guardar.
   */
  function save() {
    const next = draft();
    if (moves) onMove?.(dateKey, day, next);
    else onSave(dateKey, next);
  }

  function removeImage(index: number) {
    setImages((current) => current.filter((_, i) => i !== index));
    setImageError('');
    // El botón de quitar desaparece con su imagen: el foco pasa al de añadir
    // en cuanto React lo pinte, para no caer fuera del modal.
    requestAnimationFrame(() => attachRef.current?.focus());
  }

  return (
    <div
      className="animate-overlay-in fixed inset-0 z-50 flex items-end justify-center bg-scrim/40 p-4 backdrop-blur-sm sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="animate-panel-in max-h-full w-11/12 max-w-2xl overflow-y-auto rounded-2xl md:w-[70%] border border-edge bg-canvas p-6 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
              {formatWeekday(dateKey)}
            </p>
            <h2 id={titleId} className="mt-1 text-xl font-semibold text-ink">
              {formatLongDate(dateKey)}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mt-1 -mr-1 rounded-lg p-2 text-ink-muted transition-colors hover:bg-edge hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* La fecha, solo donde se puede cambiar. Va la primera porque es la
            identidad del día: lo demás son sus contenidos. */}
        {movable && (
          <div className="mb-4">
            <label htmlFor={dayId} className="mb-1.5 block text-sm font-medium text-ink-soft">
              Fecha
            </label>
            <input
              id={dayId}
              type="date"
              value={day}
              min={MIN_DATE}
              max={MAX_DATE}
              // Mudar un día cuyos adjuntos aún no han bajado los perdería: el
              // día de origen se borra —y con él sus imágenes en la cuenta—
              // mientras que el nuevo solo heredaría la cuenta, sin contenido.
              disabled={!ready}
              onChange={(event) => setDay(event.target.value)}
              className={FIELD}
            />

            {!ready ? (
              <p className="mt-1.5 text-xs text-ink-muted">
                La fecha no se puede cambiar hasta que lleguen las imágenes de tu cuenta.
              </p>
            ) : !validDay ? (
              <p role="alert" className="mt-1.5 text-xs font-medium text-highlight">
                El calendario solo cubre {YEARS_LABEL}: elige un día de esos años.
              </p>
            ) : overwrites ? (
              <p className="mt-1.5 text-xs font-medium text-highlight">
                El {formatLongDate(day)} ya tiene contenido: si guardas, se sustituye por este.
              </p>
            ) : moves ? (
              <p className="mt-1.5 text-xs text-ink-soft">
                Al guardar, el día entero se mueve al {formatLongDate(day)}.
              </p>
            ) : null}
          </div>
        )}

        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-edge bg-surface px-4 py-3">
          <span className="text-sm font-medium text-ink-soft">Marcar día</span>
          <span className="relative inline-flex">
            <input
              type="checkbox"
              checked={marked}
              onChange={(event) => setMarked(event.target.checked)}
              className="peer sr-only"
            />
            <span className="block h-6 w-11 rounded-full bg-edge transition-colors peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2" />
            <span className="pointer-events-none absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-raised shadow-sm transition-transform peer-checked:translate-x-5" />
          </span>
        </label>

        <fieldset className="mt-4">
          <legend className="mb-2 flex w-full items-baseline justify-between text-sm font-medium text-ink-soft">
            <span>Color del recuadro</span>
            <span className="text-xs font-normal text-ink-muted">{labelFor(palette, color)}</span>
          </legend>
          {/* Columnas de ancho fijo, no ocho partes iguales del modal: repartido,
              cada muestra se iba a los setenta píxeles en un portátil, un mural
              de color encima de la nota. Las ocho van siempre en **una sola
              fila** y lo que cambia es su ancho: 1.6rem en un teléfono, 3.2rem
              a partir de `sm`. Partirlas en dos filas de cuatro dejaba las
              muestras más cómodas de acertar, pero también dejaba la mitad de
              la paleta en un segundo renglón que se lee como otra cosa; verlas
              de un tirón vale ese apretón. El tamaño se declara una vez, aquí. */}
          <div
            role="radiogroup"
            aria-label="Color del recuadro"
            className="grid grid-cols-[repeat(8,1.6rem)] gap-2 sm:grid-cols-[repeat(8,3.2rem)]"
          >
            {DAY_COLORS.map((option) => {
              const selected = option.id === color;
              const name = labelFor(palette, option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={name}
                  title={name}
                  onClick={() => pickColor(option.id)}
                  style={{ backgroundColor: colorVar(option.id) }}
                  className={
                    // El radio baja con la muestra: a estos tamaños `rounded-lg`
                    // pesaba de más y redondeaba el recuadro casi a pastilla.
                    'flex aspect-square w-full items-center justify-center rounded-md transition ' +
                    'focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none ' +
                    (selected
                      ? 'ring-2 ring-ink ring-offset-2 ring-offset-canvas'
                      : 'hover:brightness-90') +
                    (marked ? '' : ' opacity-60')
                  }
                >
                  {selected && (
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                      <path
                        d="M2.5 6.3l2.4 2.4L9.6 4"
                        stroke="#ffffff"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
          {!marked && (
            <p className="mt-2 text-xs text-ink-muted">
              Elegir un color marcará el día automáticamente.
            </p>
          )}
        </fieldset>

        {/* Las etiquetas van pegadas al color porque son lo mismo para quien
            mira: las dos clasifican el día sin escribir nada. La diferencia es
            que el color es uno y estas son varias. */}
        <fieldset className="mt-4">
          <legend className="mb-2 flex w-full items-baseline justify-between text-sm font-medium text-ink-soft">
            <span>Etiquetas</span>
            {tags.length > 0 && (
              <span className="text-xs font-normal text-ink-muted">{tags.length} puestas</span>
            )}
          </legend>
          <TagPicker catalogue={catalogue} value={tags} onChange={setTags} />
        </fieldset>

        <div className="mt-4">
          <label htmlFor={noteId} className="mb-2 block text-sm font-medium text-ink-soft">
            Nota del día
          </label>
          <textarea
            id={noteId}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={4}
            placeholder="Escribe un recordatorio, reunión o pendiente…"
            className="w-full resize-none rounded-xl border border-edge bg-raised px-4 py-3 text-sm text-ink placeholder:text-ink-muted focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none"
          />
        </div>

        <ReminderField dateKey={dateKey} note={note} value={reminders} onChange={setReminders} />

        <div className="mt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-sm font-medium text-ink-soft">Imagen adjunta</span>
            <span id={imageHelpId} className="text-xs text-ink-muted">
              JPG, PNG o WebP
            </span>
          </div>

          {images.length > 0 && (
            <ul className="mb-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((image, index) => (
                <li key={image} className="relative">
                  <img
                    src={srcOf(image, dateKey, index, 'thumb')}
                    alt={`Imagen adjunta ${index + 1} de ${images.length}`}
                    className="aspect-square w-full rounded-lg object-cover ring-1 ring-edge"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(index)}
                    aria-label={`Quitar imagen ${index + 1}`}
                    title="Quitar imagen"
                    className="absolute top-1 right-1 rounded-full bg-scrim/60 p-1 text-white shadow transition-colors hover:bg-scrim focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path
                        d="M4 4l8 8M12 4l-8 8"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {missing > 0 && (
            <p
              className={
                'mb-3 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs ' +
                (imagesLost
                  ? 'border-highlight/40 bg-highlight-soft text-highlight'
                  : 'border-edge bg-surface text-ink-muted')
              }
            >
              {imagesLost
                ? `No se pudieron traer ${missing === 1 ? 'la imagen' : `las ${missing} imágenes`} de tu cuenta. Siguen guardadas; puedes editar el resto del día sin riesgo.`
                : `Trayendo ${missing === 1 ? 'una imagen' : `${missing} imágenes`} de tu cuenta…`}
            </p>
          )}

          <button
            ref={attachRef}
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={processing || remaining === 0 || !ready}
            aria-describedby={imageHelpId}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-edge bg-surface px-4 py-3 text-sm font-medium text-ink-soft transition-colors hover:border-accent hover:text-accent-ink-strong disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-edge disabled:hover:text-ink-soft focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect
                x="2"
                y="3"
                width="12"
                height="10"
                rx="1.5"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M2.5 11l3.2-3.2a1 1 0 011.4 0L10 10.7l1.3-1.3a1 1 0 011.4 0l.8.8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="10.5" cy="6.5" r="1" fill="currentColor" />
            </svg>
            {!ready
              ? 'Esperando a las imágenes de tu cuenta'
              : processing
              ? 'Procesando imágenes…'
              : remaining === 0
                ? `Máximo ${MAX_IMAGES_PER_DAY} imágenes`
                : images.length === 0
                  ? 'Adjuntar imágenes'
                  : 'Añadir más imágenes'}
          </button>

          {images.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              {images.length} de {MAX_IMAGES_PER_DAY}
              {totalBytes > 0 && ` · ${formatBytes(totalBytes)} por subir`}
              {unsaved && ' · sin guardar'}
            </p>
          )}

          {/* El input real queda oculto: el botón lo dispara y el `accept`
              filtra el diálogo, aunque la validación de verdad es prepareImage. */}
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            multiple
            onChange={pickImages}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />

          {imageError && (
            <p role="alert" className="mt-2 text-xs font-medium text-highlight">
              {imageError}
            </p>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            type="button"
            onClick={save}
            disabled={processing || !validDay}
            style={marked ? { backgroundColor: colorVar(color) } : undefined}
            className={
              'flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none ' +
              (marked ? 'hover:brightness-90' : 'bg-accent hover:bg-accent-strong')
            }
          >
            Guardar
          </button>
          <button
            type="button"
            onClick={() => onClear(dateKey)}
            disabled={!hasStoredData}
            className="flex-1 rounded-xl border border-highlight/40 bg-highlight-soft px-4 py-2.5 text-sm font-semibold text-highlight transition-colors hover:bg-highlight hover:text-white disabled:cursor-not-allowed disabled:border-edge disabled:bg-surface disabled:text-ink-muted disabled:hover:bg-surface disabled:hover:text-ink-muted focus-visible:ring-2 focus-visible:ring-highlight focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            Eliminar nota / desmarcar
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-edge bg-raised px-4 py-2.5 text-sm font-medium text-ink-soft transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:outline-none sm:flex-none"
          >
            Cerrar
          </button>
        </div>

        {/* La salida hacia la rejilla, para quien edita desde otra página y
            quiere ver el día en su sitio, con el mes alrededor. Secundaria a
            propósito: aquí ya se puede hacer todo, y el enlace se lleva por
            delante lo que no se haya guardado. */}
        {showCalendarLink && (
          <p className="mt-4 text-center">
            <a
              href={dayHref(dateKey)}
              className="rounded text-xs font-medium text-ink-muted underline underline-offset-2 transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            >
              Ver día completo en el calendario
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
