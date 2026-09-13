import { useCallback, useEffect, useRef, useState } from 'react';
import type { SyncState } from './SyncBadge';
import {
  flush,
  flushImages,
  pendingCount,
  pull,
  recordChanges,
  SYNC_KEY,
} from '../lib/sync';
import { loadData, saveData, STORAGE_KEY, type CalendarData } from '../lib/storage';

/**
 * El calendario y su sincronía, para cualquier página que lo escriba.
 *
 * Vivía dentro de `CalendarDashboard` mientras la única página que editaba era
 * el calendario. Con la lista de recordatorios ya son dos, y duplicar esto sería
 * duplicar lo más delicado que tiene el proyecto: la referencia de lo
 * persistido, el orden entre guardar y encolar, y el único vuelo a la vez. Una
 * copia que se desviara de la otra rompería la sincronía en silencio.
 *
 * Lo que **no** sube aquí es lo que solo le importa al calendario: los meses
 * plegados, las etiquetas de color, el día abierto. Cada página se lo guarda.
 */
export type CalendarStore = {
  data: CalendarData;
  /** Toda edición pasa por aquí: de ella salen el guardado y la subida. */
  setData: React.Dispatch<React.SetStateAction<CalendarData>>;
  /** ¿Se ha leído ya localStorage? Antes de eso `data` está vacío a propósito. */
  hydrated: boolean;
  sync: SyncState;
  pending: number;
  /** Reintenta la subida ahora. Lo llama el botón del indicador. */
  retry: () => void;
  /**
   * Mete en el estado algo que **acaba de llegar del servidor**, sin encolarlo
   * de vuelta. Es lo que distingue una descarga de una edición: sin esto, traer
   * los adjuntos de un día los reenviaría enteros en la siguiente tanda, y
   * confirmarlos los reenviaría para siempre.
   */
  adopt: (next: CalendarData) => void;
};

/**
 * `onMessage` recibe lo que la sincronía tenga que contar —una migración que
 * sube, un servidor que no responde—. Cada página lo enseña a su manera, así
 * que aquí solo se anuncia.
 */
export function useCalendarStore(onMessage?: (message: string) => void): CalendarStore {
  const [data, setData] = useState<CalendarData>({});
  const [hydrated, setHydrated] = useState(false);
  const [sync, setSync] = useState<SyncState>('starting');
  const [pending, setPending] = useState(0);
  /**
   * Última versión que ya está en localStorage. Comparar contra ella es lo que
   * dice qué días han cambiado, sin tener que releer y reparsear el año entero
   * —imágenes incluidas— en cada guardado.
   */
  const persistedRef = useRef<CalendarData>({});
  /** Subida en curso: evita que dos disparos se pisen. */
  const flushingRef = useRef(false);
  const flushTimerRef = useRef(0);
  /**
   * El aviso, en una referencia. Si fuera dependencia del efecto, una página
   * que pasara una función nueva en cada render repetiría el `pull` inicial en
   * cada repintado.
   */
  const messageRef = useRef(onMessage);
  messageRef.current = onMessage;

  // El primer render debe coincidir con el HTML del servidor, así que
  // localStorage se lee después de montar.
  useEffect(() => {
    const initial = loadData();
    persistedRef.current = initial;
    setData(initial);
    setHydrated(true);
  }, []);

  /**
   * Mete en el estado algo que acaba de llegar del servidor sin encolarlo de
   * vuelta. Va antes que `runFlush` porque esta lo usa: lo que confirma la
   * subida de imágenes entra por aquí.
   */
  const adopt = useCallback((next: CalendarData) => {
    persistedRef.current = next;
    setData(next);
  }, []);

  /**
   * Vacía la cola de subida. Un solo envío a la vez: dos a la vez mandarían el
   * mismo día dos veces, y el segundo llegaría con una marca de tiempo que el
   * servidor ya tiene y descartaría.
   */
  const runFlush = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    setSync('saving');

    try {
      // Se repite mientras quede cola: el lote tiene tope, y una edición
      // hecha en pleno vuelo la vuelve a llenar.
      for (let round = 0; round < 20; round++) {
        // Primero los días, que son baratos: así la cuenta de imágenes y la
        // miniatura llegan aunque los adjuntos tarden.
        const result = await flush();
        if (!result.ok) {
          setSync('offline');
          setPending(pendingCount());
          return;
        }

        const images = await flushImages();
        if (!images.ok) {
          setSync('offline');
          setPending(pendingCount());
          return;
        }

        /*
         * Al confirmarse la subida, los adjuntos de ese día dejan de ser data
         * URL y pasan a ser referencias, y el día estrena miniatura. Eso ya
         * está guardado y encolado por `flushImages`, así que **se adopta**:
         * tratarlo como una edición local volvería a encolar las imágenes que
         * se acaban de subir, en bucle.
         */
        if (images.data) adopt(images.data);

        const left = pendingCount();
        setPending(left);
        if (left === 0) {
          setSync('synced');
          return;
        }
      }
      // Veinte vueltas sin vaciarla: algo no va bien y es mejor decirlo que
      // seguir girando en silencio.
      setSync('offline');
    } finally {
      flushingRef.current = false;
    }
  }, [adopt]);

  const scheduleFlush = useCallback(() => {
    window.clearTimeout(flushTimerRef.current);
    // Escribir una nota dispara varios guardados seguidos. Esperar un momento
    // los agrupa en una sola subida en vez de una por tecla.
    flushTimerRef.current = window.setTimeout(() => void runFlush(), 1200);
  }, [runFlush]);

  useEffect(() => () => window.clearTimeout(flushTimerRef.current), []);

  /**
   * Primera parada tras hidratar: traer lo del servidor y fundirlo con lo de
   * aquí. De esa fusión sale, sin caso especial, la migración de lo que ya
   * hubiera en este navegador antes de existir la cuenta.
   */
  useEffect(() => {
    if (!hydrated) return;
    let alive = true;

    void (async () => {
      const result = await pull();
      if (!alive) return;

      if (!result.ok) {
        setSync('offline');
        setPending(pendingCount());
        messageRef.current?.(`${result.reason} Tus cambios siguen guardados en este navegador.`);
        return;
      }

      // La referencia se actualiza antes que el estado: así el efecto de
      // guardado no confunde lo que acaba de bajar con una edición local y no
      // lo devuelve al servidor.
      persistedRef.current = result.data;
      setData(result.data);
      setPending(pendingCount());

      await runFlush();
      if (!alive) return;

      const count = result.queued;
      const withImages = result.queuedImages;
      if (count === 0 && withImages === 0) return;

      const parts: string[] = [];
      if (count > 0) parts.push(`${count} ${count === 1 ? 'día' : 'días'}`);
      if (withImages > 0) {
        parts.push(`${withImages} ${withImages === 1 ? 'nota con imágenes' : 'notas con imágenes'}`);
      }

      const left = pendingCount();
      messageRef.current?.(
        left === 0
          ? `Se subió ${parts.join(' y ')} de este navegador a tu cuenta.`
          : `Subiendo ${parts.join(' y ')} a tu cuenta; queda${left === 1 ? '' : 'n'} ${left}.`,
      );
    })();

    return () => {
      alive = false;
    };
  }, [hydrated, runFlush]);

  // Al recuperar la conexión se reintenta sin esperar a la siguiente edición.
  useEffect(() => {
    if (!hydrated) return;
    function retry() {
      void runFlush();
    }
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [hydrated, runFlush]);

  // Si el navegador rechaza el guardado (cuota llena, casi siempre por las
  // imágenes adjuntas) el estado sigue en memoria, pero hay que decirlo: al
  // recargar se perdería lo último.
  useEffect(() => {
    if (!hydrated) return;
    if (!saveData(data)) {
      messageRef.current?.(
        'Este navegador no deja guardar nada más. Tus cambios siguen en pantalla, pero al recargar se perderían.',
      );
      return;
    }

    // Todas las vías de edición —el modal, el borrado, un rango con Shift, la
    // importación, la lista de recordatorios— desembocan aquí, así que ninguna
    // puede olvidarse de avisar.
    recordChanges(persistedRef.current, data);
    persistedRef.current = data;
    setPending(pendingCount());
    scheduleFlush();
  }, [data, hydrated, scheduleFlush]);

  // Mantiene la página en sincronía con las otras pestañas abiertas.
  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === STORAGE_KEY) setData(loadData());
      // Otra pestaña pudo subir lo que había en cola, o encolar algo nuevo.
      if (event.key === null || event.key === SYNC_KEY) setPending(pendingCount());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const retry = useCallback(() => {
    void runFlush();
  }, [runFlush]);

  return { data, setData, hydrated, sync, pending, retry, adopt };
}
