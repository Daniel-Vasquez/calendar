import { useId, useMemo } from 'react';
import { WEEKDAYS, WEEKDAY_LABELS, YEARS_LABEL } from '../lib/calendar';
import RepeatIcon from './RepeatIcon';
import {
  describeRule,
  repeatKeys,
  repeatOptions,
  repeats,
  type RepeatMode,
  type RepeatRule,
} from '../lib/repeat';

type Props = {
  dateKey: string;
  value: RepeatRule;
  onChange: (next: RepeatRule) => void;
  /** ¿Lleva el día imágenes? No viajan a las copias y hay que decirlo. */
  hasImages: boolean;
};

const FIELD =
  'w-full rounded-xl border border-edge bg-raised px-4 py-2.5 text-sm text-ink ' +
  'focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none';

/** Los 31 días del mes. El 29, el 30 y el 31 saltan los meses que no los tienen. */
const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

/**
 * Repetir el día: el desplegable y, si se pide, el panel de lo personalizado.
 *
 * Va aparte de `DayModal` por lo mismo que `ReminderField`: el modal ya pasaba
 * de cuatrocientas líneas y esto es un formulario entero.
 *
 * **Enseña cuántos días va a crear antes de crearlos.** No es un adorno: «cada
 * día» durante dos años son más de setecientos, y un número en pantalla es la
 * diferencia entre elegir eso a sabiendas y descubrirlo después.
 */
export default function RepeatField({ dateKey, value, onChange, hasImages }: Props) {
  const selectId = useId();
  const options = useMemo(() => repeatOptions(dateKey), [dateKey]);
  const keys = useMemo(() => repeatKeys(dateKey, value), [dateKey, value]);
  const activo = repeats(value);

  function toggleWeekday(index: number) {
    const weekdays = value.weekdays.includes(index)
      ? value.weekdays.filter((day) => day !== index)
      : [...value.weekdays, index];
    onChange({ ...value, weekdays });
  }

  function toggleMonthday(day: number) {
    const monthdays = value.monthdays.includes(day)
      ? value.monthdays.filter((item) => item !== day)
      : [...value.monthdays, day];
    onChange({ ...value, monthdays });
  }

  return (
    <fieldset className="mt-4 rounded-xl border border-edge bg-surface px-4 py-3">
      <legend className="sr-only">Repetición</legend>

      <label
        htmlFor={selectId}
        className="flex items-center gap-2 text-sm font-medium text-ink-soft"
      >
        <RepeatIcon size={15} strokeWidth={1.4} />
        Repetir este día
      </label>

      <select
        id={selectId}
        value={value.mode}
        onChange={(event) =>
          onChange({ ...value, mode: event.target.value as RepeatMode })
        }
        className={FIELD + ' mt-2'}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>

      {value.mode === 'custom' && (
        <div className="mt-3 space-y-4 rounded-lg border border-edge bg-raised/50 px-3 py-3">
          <div>
            <p className="text-xs font-medium text-ink-muted">Repetir por semana</p>
            {/* `WEEKDAYS` del proyecto, con X para el miércoles: es lo que
                encabeza la rejilla, y dos «M» no se distinguirían. */}
            <div role="group" aria-label="Días de la semana" className="mt-2 flex flex-wrap gap-1.5">
              {WEEKDAYS.map((letter, index) => {
                const on = value.weekdays.includes(index);
                return (
                  <label key={index} className="cursor-pointer">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleWeekday(index)}
                      aria-label={WEEKDAY_LABELS[index]}
                      className="peer sr-only"
                    />
                    <span
                      className={
                        'flex h-9 w-9 items-center justify-center rounded-lg border text-sm font-semibold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent peer-focus-visible:ring-offset-2 ' +
                        (on
                          ? 'border-accent bg-accent text-white'
                          : 'border-edge bg-raised text-ink-soft hover:bg-edge')
                      }
                    >
                      {letter}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-ink-muted">Repetir por mes</p>
            <div
              role="group"
              aria-label="Días del mes"
              className="mt-2 grid grid-cols-7 gap-1 sm:grid-cols-10"
            >
              {MONTH_DAYS.map((day) => {
                const on = value.monthdays.includes(day);
                return (
                  <label key={day} className="cursor-pointer">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggleMonthday(day)}
                      aria-label={`Día ${day}`}
                      className="peer sr-only"
                    />
                    <span
                      className={
                        'flex h-8 w-full items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ' +
                        (on
                          ? 'border-accent bg-accent text-white'
                          : 'border-edge bg-raised text-ink-soft hover:bg-edge')
                      }
                    >
                      {day}
                    </span>
                  </label>
                );
              })}
            </div>
            {/* El 29, el 30 y el 31 no existen todos los meses, y lo que se
                hace entonces es saltarlos. Decirlo aquí evita la pregunta. */}
            {value.monthdays.some((day) => day > 28) && (
              <p className="mt-2 text-xs text-ink-muted">
                Los meses que no lleguen a ese día se saltan, en vez de mover la fecha.
              </p>
            )}
          </div>
        </div>
      )}

      {activo && (
        <div className="mt-3 space-y-1.5">
          <p className="text-xs font-medium text-ink-soft">
            {keys.length === 0
              ? `No queda ninguna fecha en ${YEARS_LABEL} que encaje.`
              : `${keys.length === 1 ? 'Se creará 1 día' : `Se crearán ${keys.length} días`} dentro de ${YEARS_LABEL}` +
                (value.mode === 'custom' && describeRule(value)
                  ? `: ${describeRule(value)}.`
                  : '.')}
          </p>
          {keys.length > 0 && (
            <>
              <p className="text-xs text-ink-muted">
                Se copian el color, las etiquetas, la nota y los recordatorios. Los días que ya
                tengan algo se quedan como están.
              </p>
              {/* El único caso en que lo que se copia no es todo lo que hay. */}
              {hasImages && (
                <p className="text-xs font-medium text-highlight">
                  Las imágenes no se copian: cada adjunto está guardado bajo la fecha de su
                  propio día.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </fieldset>
  );
}
