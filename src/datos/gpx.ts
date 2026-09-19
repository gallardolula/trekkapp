/** Lectura de archivos GPX.
 *
 *  GPX es XML, pero la porción que interesa es muy acotada: el nombre del
 *  recorrido y la secuencia de `<trkpt>` con su latitud, longitud, altitud y
 *  marca de tiempo. Se resuelve con expresiones regulares en lugar de sumar un
 *  analizador de XML completo, que en React Native implicaría una dependencia
 *  nativa adicional para un beneficio nulo en este caso.
 */
import { Punto } from '../dominio/tipos';

export interface GpxLeido {
  nombre?: string;
  descripcion?: string;
  puntos: Punto[];
}

export class GpxInvalidoError extends Error {}

// Se captura el bloque de atributos completo y el cuerpo por separado, porque
// el orden de `lat` y `lon` varía entre los programas que exportan GPX.
const RE_TRKPT = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/gi;
const RE_LAT = /\blat\s*=\s*"([^"]+)"/i;
const RE_LON = /\blon\s*=\s*"([^"]+)"/i;
const RE_ELE = /<ele>\s*([-\d.eE+]+)\s*<\/ele>/i;
const RE_TIME = /<time>\s*([^<]+?)\s*<\/time>/i;
const RE_NOMBRE = /<trk>[\s\S]*?<name>\s*([\s\S]*?)\s*<\/name>/i;
const RE_DESC = /<trk>[\s\S]*?<desc>\s*([\s\S]*?)\s*<\/desc>/i;

function desescapar(texto: string): string {
  return texto
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

const esLatValida = (v: number) => Number.isFinite(v) && v >= -90 && v <= 90;
const esLonValida = (v: number) => Number.isFinite(v) && v >= -180 && v <= 180;

/**
 * Analiza el contenido de un archivo GPX.
 *
 * Los puntos con coordenadas ausentes o fuera de rango se descartan en lugar de
 * abortar la lectura: un GPX exportado por un dispositivo puede traer lecturas
 * sueltas corruptas y perder el recorrido entero por eso sería peor. Si no
 * queda ningún punto válido, se considera que el archivo no es utilizable.
 */
export function parsearGpx(xml: string): GpxLeido {
  if (!/<gpx\b/i.test(xml)) {
    throw new GpxInvalidoError('El archivo no parece ser un GPX.');
  }

  const puntos: Punto[] = [];
  RE_TRKPT.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = RE_TRKPT.exec(xml)) !== null) {
    const atributos = m[1] ?? '';
    const mLat = atributos.match(RE_LAT);
    const mLon = atributos.match(RE_LON);
    if (!mLat || !mLon) continue;

    const lat = Number.parseFloat(mLat[1]);
    const lon = Number.parseFloat(mLon[1]);
    if (!esLatValida(lat) || !esLonValida(lon)) continue;

    const punto: Punto = { lat, lon };
    const cuerpo = m[2] ?? '';

    const ele = cuerpo.match(RE_ELE);
    if (ele) {
      const valor = Number.parseFloat(ele[1]);
      if (Number.isFinite(valor)) punto.ele = valor;
    }

    const tiempo = cuerpo.match(RE_TIME);
    if (tiempo) punto.tiempo = tiempo[1];

    puntos.push(punto);
  }

  if (puntos.length === 0) {
    throw new GpxInvalidoError('El archivo GPX no contiene puntos de recorrido.');
  }

  const nombre = xml.match(RE_NOMBRE);
  const descripcion = xml.match(RE_DESC);

  return {
    nombre: nombre ? desescapar(nombre[1]) || undefined : undefined,
    descripcion: descripcion ? desescapar(descripcion[1]) || undefined : undefined,
    puntos,
  };
}
