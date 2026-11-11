// Búfer de salida de una terminal: guarda lo último que mostró para repetirlo al reconectar.
// Equivale exactamente a `buffer = (buffer + d).slice(-max)` por cada trozo, pero sin copiar los 400 000
// caracteres en cada uno: guarda los trozos tal cual y solo los une al leerlo (al reconectar) o al compactar.
// Los límites se cuentan en unidades UTF-16 (String.length), igual que el slice anterior: un emoji partido
// en el borde queda partido igual que antes.

const MAX_CHUNKS = 512; // por encima se unen en un solo trozo: el arreglo nunca crece sin límite

export class TermBuffer {
  constructor(max) {
    this.max = max;
    this.chunks = [];
    this.len = 0;  // suma de chunks[i].length
    this.keep = 0; // largo del contenido lógico: los últimos `keep` caracteres de los trozos
  }

  /** Agrega salida y recorta a `max`, como `(buffer + d).slice(-max)`. */
  push(d) {
    if (!d) return;
    if (d.length >= this.max) { // el trozo solo ya llena el búfer: lo anterior no sobrevive
      d = d.slice(-this.max);
      this.chunks = [d]; this.len = this.keep = d.length;
      return;
    }
    this.add(d, Math.min(this.keep + d.length, this.max));
  }

  /** Agrega sin recortar, como `buffer += d` (el aviso de proceso terminado). */
  append(d) {
    if (d) this.add(d, this.keep + d.length);
  }

  add(d, keep) {
    this.chunks.push(d);
    this.len += d.length;
    this.keep = keep;
    // Fuera los trozos viejos que quedaron enteros antes del inicio del contenido.
    let drop = 0;
    while (this.len - this.chunks[drop].length >= this.keep) this.len -= this.chunks[drop++].length;
    if (drop) this.chunks.splice(0, drop);
    if (this.chunks.length > MAX_CHUNKS) { const s = this.toString(); this.chunks = [s]; this.len = s.length; }
  }

  get length() { return this.keep; }

  toString() {
    const s = this.chunks.length === 1 ? this.chunks[0] : this.chunks.join('');
    return this.len === this.keep ? s : s.slice(this.len - this.keep);
  }
}
