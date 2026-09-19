/** Cálculos geoespaciales sobre la traza de un sendero.
 *
 *  Todo lo de este módulo se ejecuta en el dispositivo y sin conexión: es la
 *  base sobre la que se apoyan la clasificación de exigencia y la alerta de
 *  desvío.
 */
import { Punto } from './tipos';

const RADIO_TIERRA_M = 6_371_008.8; // radio medio de la Tierra (IUGG)

const aRadianes = (grados: number) => (grados * Math.PI) / 180;

/**
 * Distancia sobre la superficie terrestre entre dos puntos, en metros.
 *
 * Usa la fórmula del semiverseno (haversine), que asume la Tierra esférica.
 * Para las distancias de un sendero (decenas de kilómetros como máximo) el
 * error frente a un modelo elipsoidal es despreciable.
 */
export function distanciaHaversine(a: Punto, b: Punto): number {
  const dLat = aRadianes(b.lat - a.lat);
  const dLon = aRadianes(b.lon - a.lon);
  const latA = aRadianes(a.lat);
  const latB = aRadianes(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;

  return 2 * RADIO_TIERRA_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Proyección equirectangular local: convierte un punto a coordenadas planas en
 * metros, tomando `origen` como referencia.
 *
 * Sobre distancias cortas la deformación es mínima, y trabajar en un plano
 * permite resolver la distancia punto-segmento con álgebra elemental en lugar
 * de trigonometría esférica.
 */
function aPlano(p: Punto, origen: Punto): { x: number; y: number } {
  const latRef = aRadianes(origen.lat);
  return {
    x: aRadianes(p.lon - origen.lon) * Math.cos(latRef) * RADIO_TIERRA_M,
    y: aRadianes(p.lat - origen.lat) * RADIO_TIERRA_M,
  };
}

/**
 * Distancia en metros de `p` al segmento que va de `a` a `b`.
 *
 * Es la distancia al punto más cercano del segmento, que puede ser un extremo
 * (cuando la proyección cae fuera) o un punto interior. Esto importa: medir
 * solo contra los vértices de la traza sobreestimaría el desvío en los tramos
 * largos y rectos, que en un sendero de montaña son frecuentes.
 */
export function distanciaPuntoASegmento(p: Punto, a: Punto, b: Punto): number {
  const pp = aPlano(p, a);
  const pb = aPlano(b, a);

  const largoCuadrado = pb.x ** 2 + pb.y ** 2;
  if (largoCuadrado === 0) return distanciaHaversine(p, a); // segmento degenerado

  // t es la posición de la proyección sobre el segmento, acotada a [0, 1].
  let t = (pp.x * pb.x + pp.y * pb.y) / largoCuadrado;
  t = Math.max(0, Math.min(1, t));

  const dx = pp.x - t * pb.x;
  const dy = pp.y - t * pb.y;
  return Math.sqrt(dx ** 2 + dy ** 2);
}

export interface ResultadoDistanciaATraza {
  /** Distancia al punto más cercano de la traza, en metros. */
  metros: number;
  /** Índice del segmento más cercano; sirve para saber en qué tramo va la persona. */
  indiceSegmento: number;
}

/**
 * Distancia del caminante a la traza del sendero.
 *
 * Recorre todos los segmentos y devuelve el mínimo. Es el cálculo que se
 * ejecuta de manera continua durante el recorrido y del que depende la alerta
 * de desvío.
 */
export function distanciaATraza(
  p: Punto,
  traza: Punto[],
): ResultadoDistanciaATraza {
  if (traza.length === 0) {
    throw new Error('La traza no puede estar vacía');
  }
  if (traza.length === 1) {
    return { metros: distanciaHaversine(p, traza[0]), indiceSegmento: 0 };
  }

  let mejor = Infinity;
  let indice = 0;
  for (let i = 0; i < traza.length - 1; i++) {
    const d = distanciaPuntoASegmento(p, traza[i], traza[i + 1]);
    if (d < mejor) {
      mejor = d;
      indice = i;
    }
  }
  return { metros: mejor, indiceSegmento: indice };
}
