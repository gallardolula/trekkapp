/** Tipos del dominio de TrekkApp. */

/** Un punto de la traza de un sendero. La altitud puede faltar: no todos los GPX la traen. */
export interface Punto {
  lat: number;
  lon: number;
  /** Metros sobre el nivel del mar. */
  ele?: number;
  /** Marca de tiempo ISO 8601, cuando el GPX la registra. */
  tiempo?: string;
}

/** Nivel de experiencia declarado por el caminante y, con los mismos valores,
 *  exigencia técnica calculada del sendero. Que compartan escala es lo que
 *  permite compararlos en el motor de reglas. */
export type Nivel = 'principiante' | 'intermedio' | 'avanzado';

export const ORDEN_NIVEL: Record<Nivel, number> = {
  principiante: 0,
  intermedio: 1,
  avanzado: 2,
};

/** Atributos técnicos derivados de la traza, no cargados a mano. */
export interface AtributosSendero {
  distanciaM: number;
  desnivelAcumuladoM: number;
  /** Distancia equivalente en llano, en kilómetros. Ver `indiceEsfuerzo`. */
  indiceEsfuerzo: number;
  exigencia: Nivel;
}

export interface Sendero {
  id: string;
  nombre: string;
  descripcion?: string;
  puntos: Punto[];
  atributos: AtributosSendero;
  /** Un sendero aportado por un caminante no se publica hasta ser revisado. */
  estado: 'publicado' | 'pendiente_revision';
}

/** Resultado de evaluar si un caminante puede descargar un sendero. */
export interface EvaluacionDescarga {
  permitida: boolean;
  requiereConfirmacion: boolean;
  motivo?: string;
}

/** Estado del seguimiento de desvío durante un recorrido. Es un valor que el
 *  llamador conserva entre lecturas del GPS; el motor de reglas es puro. */
export interface EstadoDesvio {
  enDesvio: boolean;
  /** Lecturas consecutivas fuera del radio, para no disparar por una sola. */
  lecturasFuera: number;
  /** Lecturas consecutivas dentro del radio de reingreso, para cerrar la alerta. */
  lecturasDentro: number;
}

export const ESTADO_DESVIO_INICIAL: EstadoDesvio = {
  enDesvio: false,
  lecturasFuera: 0,
  lecturasDentro: 0,
};

/** Pronóstico para las coordenadas de un sendero, tal como lo devuelve el
 *  servicio meteorológico una vez normalizado. */
export interface Pronostico {
  fecha: string;
  precipitacionMm: number;
  vientoKmh: number;
  temperaturaMinC: number;
  temperaturaMaxC: number;
}

export type Severidad = 'ninguna' | 'advertencia' | 'riesgo';

export interface AlertaClimatica {
  severidad: Severidad;
  motivos: string[];
  /** Momento en que se evaluó, para poder mostrarla sin conexión indicando su antigüedad. */
  evaluadaEn: string;
}
