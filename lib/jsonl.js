// Lector incremental de .jsonl: cada llamada a read() entrega solo los registros nuevos desde la anterior.
// Pensado para las sesiones de Claude Code, que solo crecen agregando líneas al final (pueden pesar decenas de MB).
//
// Cómo detecta que el archivo ya no es el mismo que se venía leyendo (antes de seguir desde el offset):
//   1. tamaño menor que lo ya leído (truncado);
//   2. identidad del archivo: dev + ino en bigint (cambia al reemplazar con rename o al borrar y recrear en NTFS).
//      No se usa birthtime: Windows lo hereda al recrear un archivo con el mismo nombre ("tunneling");
//   3. huellas de contenido: los primeros bytes del archivo y los últimos bytes antes del offset
//      (que terminan en el último salto de línea procesado).
// Limitación: las huellas son parciales. Una reescritura que cambie solo bytes fuera de esas dos ventanas,
// en el mismo archivo (mismo ino) y sin achicarlo, NO se detecta. Claude Code solo agrega al final, así que
// en la práctica no pasa; si algún día pasara, reabrir la app relee todo desde cero.
// Si el sistema de archivos no da identidad (ino = 0, p. ej. FAT/exFAT o algunas unidades de red), solo
// quedan el tamaño y las huellas.
import fs from 'node:fs';
import { setImmediate as yieldToLoop } from 'node:timers/promises';

const CHUNK = 1 << 20; // 1 MB por lectura; entre una y otra se cede el event loop
const PRINT = 64;      // tamaño de cada huella de contenido
const EMPTY = Buffer.alloc(0);

/** Por qué se descartó una línea completa (para diagnosticar sin mostrar su contenido). */
function kindOf(r) {
  if (r === null) return 'null';
  if (Array.isArray(r)) return 'array';
  if (typeof r !== 'object') return typeof r;
  return typeof r.type === 'string' ? null : 'sin type'; // todo registro de Claude Code es un objeto con "type"
}

async function bytesAt(fh, pos, len) {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fh.read(b, 0, len, pos);
  return b.subarray(0, bytesRead);
}

export class JsonlTail {
  constructor(file) {
    this.file = file;
    this.offset = 0;   // bytes ya consumidos: siempre justo después de un registro (o de una línea descartada)
    this.ident = null; // "dev:ino" (bigint) del archivo que se venía leyendo
    this.head = null;  // huella del principio del archivo
    this.mark = null;  // huella de los bytes justo antes del offset
    this.queue = Promise.resolve();
  }

  /**
   * Entrega a onRecord(obj) cada registro nuevo, en orden. Devuelve { reset, records, skipped, bytes }.
   * - skipped: { motivo: cantidad } de líneas completas descartadas (JSON roto, null, número, texto, array,
   *   objeto sin "type"). Se cuentan, nunca se entregan.
   * - Si el archivo cambió de forma incompatible (ver arriba), primero llama a onReset() y relee desde el
   *   principio: quien acumula datos debe empezar de cero en onReset.
   * - Contrato de onRecord (como máximo una vez): el progreso se confirma ANTES de entregar cada registro.
   *   Si onRecord lanza, ese registro se da por consumido (no se reintenta), la lectura se detiene y la
   *   promesa se rechaza con el error. Los registros anteriores no se vuelven a entregar. Por eso onRecord
   *   debe ser atómico o capturar sus propios errores: un efecto a medias antes de lanzar no se deshace.
   * - Las llamadas se encolan y respetan el orden; una lectura fallida no bloquea las siguientes.
   * - Si el archivo no existe, la promesa se rechaza con ENOENT.
   */
  read(onRecord, onReset = () => {}) {
    const run = this.queue.then(() => this.#read(onRecord, onReset));
    this.queue = run.catch(() => {});
    return run;
  }

  async #read(onRecord, onReset) {
    const fh = await fs.promises.open(this.file, 'r');
    const start = this.offset;
    try {
      const st = await fh.stat({ bigint: true });
      const size = Number(st.size); // tamaño en bytes: cabe sin pérdida en Number hasta 8 PB
      const ident = st.ino ? `${st.dev}:${st.ino}` : null;
      let reset = false;
      if (this.offset > 0) {
        reset = size < this.offset
          || (ident !== null && this.ident !== null && ident !== this.ident)
          || !this.head || !this.mark // sin huellas no se puede comprobar nada: se relee desde cero
          || !(await bytesAt(fh, 0, this.head.length)).equals(this.head)
          || !(await bytesAt(fh, this.offset - this.mark.length, this.mark.length)).equals(this.mark);
      }
      if (reset) { this.offset = 0; this.head = this.mark = null; onReset(); }
      this.ident = ident;

      // Huellas a partir de los mismos bytes que se procesan (N1): sin volver a leer el archivo al final, así
      // que reflejan lo procesado aunque el archivo cambie durante la lectura, y no hay lecturas extra que
      // puedan fallar y dejar un offset sin huellas (N3). `seen`: hasta qué posición ya se incorporó.
      let head = this.head ?? EMPTY, mark = this.mark ?? EMPTY, seen = this.offset;
      const fold = (data, at, upto) => { // incorpora data[seen-at .. upto-at), con data[0] en la posición `at`
        if (upto <= seen) return;
        const part = data.subarray(seen - at, upto - at);
        if (head.length < PRINT) head = Buffer.concat([head, part.subarray(0, PRINT - head.length)]);
        mark = Buffer.concat([mark, part.subarray(-PRINT)]).subarray(-PRINT);
        seen = upto;
      };
      let cur = null, curAt = 0; // bloque en proceso, para incorporar el progreso parcial si algo falla

      const result = { reset, records: 0, skipped: {}, bytes: 0 };
      const deliver = (text, end) => {
        this.offset = end; // se confirma antes de entregar: un error de onRecord no provoca reentregas
        if (!text.trim()) return;
        let r;
        try { r = JSON.parse(text); } catch { result.skipped.json = (result.skipped.json || 0) + 1; return; }
        const bad = kindOf(r);
        if (bad) { result.skipped[bad] = (result.skipped[bad] || 0) + 1; return; }
        result.records++;
        onRecord(r);
      };

      try {
        let pos = this.offset, carry = null, carryAt = pos; // carry: línea sin \n todavía; carryAt: dónde empieza
        while (pos < size) {
          const buf = await bytesAt(fh, pos, Math.min(CHUNK, size - pos));
          if (!buf.length) break;
          const data = carry ? Buffer.concat([carry, buf]) : buf;
          const at = carry ? carryAt : pos; // posición en el archivo de data[0]
          cur = data; curAt = at;
          pos += buf.length;
          let from = 0, nl;
          // Se corta por el byte \n: nunca cae dentro de un carácter UTF-8 de varios bytes.
          while ((nl = data.indexOf(10, from)) !== -1) {
            deliver(data.toString('utf8', from, nl), at + nl + 1);
            from = nl + 1;
          }
          fold(data, at, this.offset);
          carry = from < data.length ? Buffer.from(data.subarray(from)) : null;
          carryAt = at + from;
          if (pos < size) await yieldToLoop(); // no acaparar el hilo con archivos grandes
        }
        // Última línea sin \n: si ya es un registro completo se toma (así lo hacía el lector completo); si no,
        // está a medio escribir y se deja sin consumir hasta que llegue el resto.
        if (carry) {
          const text = carry.toString('utf8');
          let r = null;
          try { r = JSON.parse(text); } catch {}
          cur = carry; curAt = carryAt;
          if (r !== null && !kindOf(r)) deliver(text, carryAt + carry.length);
        }
      } finally {
        // Huellas del estado confirmado, también si onRecord o una lectura fallaron a mitad de camino.
        if (cur) fold(cur, curAt, this.offset);
        this.head = Buffer.from(head); // copias: no retener el bloque de 1 MB del que salieron
        this.mark = Buffer.from(mark);
      }
      result.bytes = this.offset - (reset ? 0 : start);
      return result;
    } finally {
      await fh.close();
    }
  }
}

/** Lee un .jsonl completo de una vez (sin caché). */
export function readAll(file, onRecord) {
  return new JsonlTail(file).read(onRecord);
}
