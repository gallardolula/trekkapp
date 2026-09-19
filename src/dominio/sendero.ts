/** Atributos técnicos derivados de la traza de un sendero.
 *
 *  Ninguno de estos valores se carga a mano: todos se calculan a partir de la
 *  secuencia de puntos. Es lo que permite que la clasificación de exigencia sea
 *  un estado calculado y no un dato declarado por quien publica el recorrido.
 */
import { distanciaHaversine } from './geo';
import { AtributosSendero, Nivel, Punto } from './tipos';

/**
 * Ruido de altitud que se descarta al acumular ascensos, en metros.
 *
 * El receptor satelital estima la altitud con bastante menos precisión que la
 * posición horizontal, y oscila incluso con el dispositivo quieto. Sin este
 * umbral, un sendero llano acumularía cientos de metros de desnivel falso.
 */
export const UMBRAL_RUIDO_ALTITUD_M = 3;

/** Longitud total del recorrido, en metros. */
export function distanciaTotal(puntos: Punto[]): number {
  let total = 0;
  for (let i = 0; i < puntos.length - 1; i++) {
    total += distanciaHaversine(puntos[i], puntos[i + 1]);
  }
  return total;
}

/**
 * Suma de todos los ascensos del recorrido, en metros.
 *
 * Solo acumula las diferencias positivas y únicamente cuando superan el umbral
 * de ruido, comparando siempre contra la última altitud considerada válida y no
 * contra el punto inmediato anterior. De ese modo una subida sostenida y suave
 * se acumula igual, aunque cada paso individual quede por debajo del umbral.
 */
export function desnivelAcumulado(
  puntos: Punto[],
  umbralM: number = UMBRAL_RUIDO_ALTITUD_M,
): number {
  const conAltitud = puntos.filter((p) => typeof p.ele === 'number');
  if (conAltitud.length < 2) return 0;

  let total = 0;
  let referencia = conAltitud[0].ele as number;

  for (let i = 1; i < conAltitud.length; i++) {
    const actual = conAltitud[i].ele as number;
    const delta = actual - referencia;
    if (Math.abs(delta) < umbralM) continue; // oscilación: no mueve la referencia
    if (delta > 0) total += delta;
    referencia = actual;
  }
  return total;
}

/**
 * Metros de ascenso que se consideran equivalentes a un kilómetro en llano.
 *
 * Regla práctica difundida en montañismo: subir 100 metros cuesta, en tiempo y
 * esfuerzo, aproximadamente lo mismo que caminar un kilómetro sobre terreno
 * plano. Es la base del índice de esfuerzo.
 */
export const METROS_ASCENSO_POR_KM_LLANO = 100;

/** Umbrales del índice de esfuerzo que separan los tres niveles de exigencia. */
export const UMBRAL_PRINCIPIANTE = 8;
export const UMBRAL_INTERMEDIO = 18;

/**
 * Distancia equivalente en llano, en kilómetros.
 *
 * Combina longitud y desnivel en un único número comparable, de modo que dos
 * senderos de la misma distancia pero distinto desnivel no queden clasificados
 * igual.
 */
export function indiceEsfuerzo(distanciaM: number, desnivelM: number): number {
  return distanciaM / 1000 + desnivelM / METROS_ASCENSO_POR_KM_LLANO;
}

/** Traduce el índice de esfuerzo a uno de los tres niveles de exigencia. */
export function clasificarExigencia(indice: number): Nivel {
  if (indice <= UMBRAL_PRINCIPIANTE) return 'principiante';
  if (indice <= UMBRAL_INTERMEDIO) return 'intermedio';
  return 'avanzado';
}

/** Calcula de una vez todos los atributos derivados de una traza. */
export function calcularAtributos(puntos: Punto[]): AtributosSendero {
  const distanciaM = distanciaTotal(puntos);
  const desnivelAcumuladoM = desnivelAcumulado(puntos);
  const indice = indiceEsfuerzo(distanciaM, desnivelAcumuladoM);
  return {
    distanciaM,
    desnivelAcumuladoM,
    indiceEsfuerzo: indice,
    exigencia: clasificarExigencia(indice),
  };
}
