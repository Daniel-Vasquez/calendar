import { colorVar, DAY_COLORS, labelFor, type ColorPalette } from '../lib/palette';

type Props = {
  /** Los tonos de esta persona: las muestras enseñan lo que verá en la rejilla. */
  palette: ColorPalette;
};

/**
 * Qué significa cada marca del calendario, y cómo se ponen.
 *
 * Vivía al pie de la portada, donde ocupaba sitio todos los días para
 * explicar algo que se aprende una vez. Ahora está al fondo de los ajustes:
 * quien la necesite sabe dónde mirar, y el calendario respira.
 */
export default function Legend({ palette }: Props) {
  return (
    <section className="mt-6 border-t border-edge pt-5">
      <h3 className="text-sm font-semibold text-ink-soft">Indicaciones adicionales</h3>

      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-ink-muted">
        <li className="flex items-center gap-2">
          <span className="flex gap-1" aria-hidden="true">
            {DAY_COLORS.map((color) => (
              <span
                key={color.id}
                title={labelFor(palette, color.id)}
                className="h-3 w-3 rounded"
                style={{ backgroundColor: colorVar(color.id) }}
              />
            ))}
          </span>
          Día marcado ({DAY_COLORS.length} colores)
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-highlight" aria-hidden="true" />
          Contiene una nota
        </li>
        <li className="flex items-center gap-2">
          <span className="h-3 w-3 rounded bg-today" aria-hidden="true" />
          Día actual (violeta reservado)
        </li>
      </ul>

      <p className="mt-3 text-xs text-ink-muted">
        Haz clic en un día para editarlo, Shift+clic para marcar el tramo desde el anterior, o
        recorre el año con las flechas.
      </p>
    </section>
  );
}
