/**
 * Dos flechas en ciclo: la marca de que un día pertenece a una serie.
 *
 * Vive en su propio archivo y no dentro de `RepeatField` porque lo pintan tres
 * sitios que no tienen nada que ver con aquel formulario —la casilla de la
 * rejilla, la fila de la agenda y el popover—, y arrastrar el formulario entero
 * hasta una casilla de cuarenta píxeles para usar un `svg` sería absurdo.
 *
 * Mismo trazo que el resto de iconos del proyecto, y `strokeWidth` por `prop`
 * porque a nueve píxeles el 1.4 de los formularios se desvanece.
 */
export default function RepeatIcon({
  size = 10,
  strokeWidth = 1.6,
}: {
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 8a5.5 5.5 0 019.4-3.9M13.5 8a5.5 5.5 0 01-9.4 3.9"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <path
        d="M11.5 1.8v2.7h-2.7M4.5 14.2v-2.7h2.7"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
