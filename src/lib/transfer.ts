import { labelFor, type ColorLabels } from './labels';
import { sanitizeData, type CalendarData } from './storage';

/** Nombre base de los archivos que se descargan. */
const FILE_STEM = 'planificador-2026';

export type ImportResult =
  | { ok: true; data: CalendarData; days: number }
  | { ok: false; reason: string };

/**
 * Lee un archivo exportado. El JSON ajeno pasa por el mismo saneado que
 * localStorage, así que un archivo a medias importa lo que sea válido en vez
 * de tumbar el calendario.
 */
export function parseImport(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'El archivo no es un JSON válido.' };
  }

  // Acepta tanto el envoltorio con metadatos como el mapa de días pelado.
  const payload =
    raw && typeof raw === 'object' && 'days' in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).days
      : raw;

  const data = sanitizeData(payload);
  const days = Object.keys(data).length;
  if (days === 0) return { ok: false, reason: 'El archivo no contiene días reconocibles.' };

  return { ok: true, data, days };
}

/** Envoltorio con metadatos: el importador también acepta el mapa a secas. */
export function toJson(data: CalendarData, labels: ColorLabels): string {
  return JSON.stringify(
    // v2: cada día lleva `images` (lista) en vez de `image`; el importador lee ambos.
    { app: FILE_STEM, version: 2, exportedAt: new Date().toISOString(), labels, days: data },
    null,
    2,
  );
}

/** Escapa según RFC 5545: la coma, el punto y coma y la barra son de control. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Parte las líneas largas como pide el RFC. El límite real son 75 octetos y
 * aquí se cuentan caracteres: con acentos el corte queda algo antes de la
 * cuenta exacta, que es el lado seguro.
 */
function fold(line: string): string {
  if (line.length <= 73) return line;
  const parts = [line.slice(0, 73)];
  for (let i = 73; i < line.length; i += 72) parts.push(' ' + line.slice(i, i + 72));
  return parts.join('\r\n');
}

function icsStamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Calendario iCalendar con un evento de día completo por cada día registrado,
 * para llevarse el año a Google Calendar, Outlook o Apple Calendario.
 */
export function toIcs(data: CalendarData, labels: ColorLabels, now: Date = new Date()): string {
  const stamp = icsStamp(now);

  const events = Object.keys(data)
    .sort()
    .flatMap((key) => {
      const entry = data[key];
      const compact = key.replace(/-/g, '');
      // DTEND es exclusivo en los eventos de día completo: apunta al siguiente.
      const [year, month, day] = key.split('-').map(Number);
      const end = new Date(year, month - 1, day + 1);
      const endCompact =
        `${end.getFullYear()}` +
        String(end.getMonth() + 1).padStart(2, '0') +
        String(end.getDate()).padStart(2, '0');

      // El resumen es lo único que se ve en la rejilla del calendario ajeno:
      // manda la primera línea de la nota y, sin nota, la categoría del color.
      const firstLine = entry.note.split('\n')[0].trim();
      const summary = firstLine || labelFor(labels, entry.color);

      return [
        'BEGIN:VEVENT',
        fold(`UID:${compact}-${FILE_STEM}@local`),
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${compact}`,
        `DTEND;VALUE=DATE:${endCompact}`,
        fold(`SUMMARY:${escapeText(summary)}`),
        ...(entry.note ? [fold(`DESCRIPTION:${escapeText(entry.note)}`)] : []),
        ...(entry.marked ? [fold(`CATEGORIES:${escapeText(labelFor(labels, entry.color))}`)] : []),
        'END:VEVENT',
      ];
    });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${FILE_STEM}//ES`,
    'CALSCALE:GREGORIAN',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

/**
 * Entrega un archivo al navegador. La URL temporal se revoca en el siguiente
 * tick: antes de eso la descarga aún no ha leído el blob.
 */
export function downloadFile(contents: string, filename: string, type: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `planificador-2026-2026-09-10.json` — la fecha evita pisar exportaciones. */
export function exportFilename(extension: string, today: string): string {
  return `${FILE_STEM}-${today || 'export'}.${extension}`;
}
