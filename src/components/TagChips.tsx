import { labelOf, MAX_TAGS_PER_DAY, toggleTag, type Tag } from '../lib/tags';

/**
 * Las etiquetas de un día: el selector para ponerlas y los distintivos para
 * verlas. Van juntos en un archivo porque son la misma pieza mirada desde los
 * dos lados —lo que se elige aquí es lo que se lee allí— y separarlos dejaría
 * dos sitios donde acordarse de que un `slug` no es un rótulo.
 */

const CHIP =
  'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ' +
  'focus-visible:outline-none';

type PickerProps = {
  /** Las que existen. Vacío mientras no se ha leído, y también si se borraron todas. */
  catalogue: Tag[];
  /** Las puestas en este día, por `slug`. */
  value: string[];
  onChange: (next: string[]) => void;
};

/**
 * Selector de etiquetas: un distintivo por etiqueta, que se enciende y se apaga.
 *
 * Son `aria-pressed` y no casillas a propósito: es el mismo gesto y el mismo
 * aspecto que los filtros de la agenda y las pestañas de los recordatorios, y
 * esto es exactamente eso —una lista corta de cosas que se activan—, no un
 * formulario con campos.
 *
 * Al llegar al tope, las apagadas se deshabilitan en vez de desaparecer: que se
 * vean explica por qué no se pueden pulsar, y quitar una vuelve a abrirlas.
 */
export function TagPicker({ catalogue, value, onChange }: PickerProps) {
  const full = value.length >= MAX_TAGS_PER_DAY;

  /**
   * Lo puesto en el día que el catálogo ya no conoce: se borró la etiqueta, o
   * el día viene de otro dispositivo. Se enseña igual —y se puede quitar—
   * porque esconderla dejaría al día con una etiqueta invisible que no hay
   * forma de soltar.
   */
  const unknown = value.filter((slug) => !catalogue.some((tag) => tag.slug === slug));

  if (catalogue.length === 0 && unknown.length === 0) {
    return (
      <p className="text-xs text-ink-muted">
        No te queda ninguna etiqueta. Se crean en Ajustes, en «Etiquetas».
      </p>
    );
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {[...catalogue.map((tag) => tag.slug), ...unknown].map((slug) => {
          const active = value.includes(slug);
          return (
            <button
              key={slug}
              type="button"
              aria-pressed={active}
              disabled={!active && full}
              onClick={() => onChange(toggleTag(value, slug))}
              className={
                CHIP +
                (active
                  ? ' border-accent bg-accent/10 text-accent-ink-strong'
                  : ' border-edge bg-raised text-ink-soft hover:bg-edge disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-raised')
              }
            >
              {labelOf(catalogue, slug)}
            </button>
          );
        })}
      </div>

      {full && (
        <p className="mt-2 text-xs text-ink-muted">
          Máximo {MAX_TAGS_PER_DAY} etiquetas por día. Quita una para poner otra.
        </p>
      )}
    </>
  );
}

/**
 * Las etiquetas de un día, en pequeño, para las filas de la agenda y las
 * tarjetas de recordatorio. Solo se leen: para cambiarlas se abre el día.
 */
export function TagBadges({
  catalogue,
  tags,
  className = '',
}: {
  catalogue: Tag[];
  tags?: string[];
  className?: string;
}) {
  if (!tags?.length) return null;

  return (
    <span className={'flex flex-wrap items-center gap-1 ' + className}>
      {tags.map((slug) => (
        <span
          key={slug}
          className="rounded-full border border-edge bg-raised px-1.5 py-0.5 text-[10px] font-medium text-ink-soft"
        >
          {labelOf(catalogue, slug)}
        </span>
      ))}
    </span>
  );
}
