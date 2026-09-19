/** Motor de reglas de negocio de TrekkApp.
 *
 *  Tres reglas, las tres puras y ejecutables sin conexión:
 *    1. si un caminante puede descargar un sendero según su nivel declarado,
 *    2. si su posición actual constituye un desvío de la traza,
 *    3. si el pronóstico del sendero representa un riesgo.
 *
 *  Al no depender de la base de datos ni de la red, se pueden probar de forma
 *  aislada y se comportan igual en el terreno que en los casos de prueba.
 */
import {
  AlertaClimatica,
  AtributosSendero,
  ESTADO_DESVIO_INICIAL,
  EstadoDesvio,
  EvaluacionDescarga,
  Nivel,
  ORDEN_NIVEL,
  Pronostico,
  Severidad,
} from './tipos';

// ---------------------------------------------------------------- descarga --

const ETIQUETA_NIVEL: Record<Nivel, string> = {
  principiante: 'principiante',
  intermedio: 'intermedio',
  avanzado: 'avanzado',
};

/**
 * Decide si un caminante puede descargar un sendero.
 *
 * La descarga nunca se bloquea: la persona conserva la decisión final. Lo que
 * cambia es que, cuando la exigencia del sendero supera el nivel declarado, se
 * exige una confirmación explícita en lugar de permitir la descarga en silencio.
 */
export function evaluarDescarga(
  atributos: AtributosSendero,
  nivelUsuario: Nivel,
): EvaluacionDescarga {
  const salto = ORDEN_NIVEL[atributos.exigencia] - ORDEN_NIVEL[nivelUsuario];

  if (salto <= 0) return { permitida: true, requiereConfirmacion: false };

  const km = (atributos.distanciaM / 1000).toFixed(1);
  const desnivel = Math.round(atributos.desnivelAcumuladoM);
  const motivo =
    `Este sendero está clasificado como ${ETIQUETA_NIVEL[atributos.exigencia]} ` +
    `(${km} km y ${desnivel} m de desnivel acumulado) y tu nivel declarado es ` +
    `${ETIQUETA_NIVEL[nivelUsuario]}.`;

  return { permitida: true, requiereConfirmacion: true, motivo };
}

// ------------------------------------------------------------------ desvío --

/** Radio de tolerancia por defecto, en metros. */
export const RADIO_TOLERANCIA_M = 50;

/**
 * Lecturas consecutivas fuera del radio necesarias para abrir la alerta.
 *
 * Una sola lectura no alcanza: el error del receptor satelital bajo cobertura
 * arbórea o en una quebrada puede superar los 30 metros de manera puntual.
 */
export const LECTURAS_PARA_ABRIR = 3;

/** Lecturas consecutivas dentro del radio de reingreso necesarias para cerrarla. */
export const LECTURAS_PARA_CERRAR = 3;

/**
 * Proporción del radio que hay que recuperar para cerrar la alerta.
 *
 * Cerrar con el mismo umbral con el que se abre haría que la alerta parpadeara
 * mientras la persona camina justo sobre el límite. Exigir volver al 70 % del
 * radio introduce una histéresis que evita ese comportamiento.
 */
export const FACTOR_REINGRESO = 0.7;

export interface ResultadoDesvio {
  estado: EstadoDesvio;
  /** true solo en la lectura en que la alerta se abre, para no repetir el aviso. */
  debeAlertar: boolean;
  /** true solo en la lectura en que la alerta se cierra. */
  debeCerrarAlerta: boolean;
}

/**
 * Evalúa una lectura de posición contra el estado previo del seguimiento.
 *
 * Es una función pura: recibe el estado anterior y devuelve el nuevo, de modo
 * que la lógica de la alerta no depende de ninguna variable global ni del
 * momento en que se la llame.
 */
export function evaluarDesvio(
  distanciaATrazaM: number,
  estadoPrevio: EstadoDesvio = ESTADO_DESVIO_INICIAL,
  radioM: number = RADIO_TOLERANCIA_M,
): ResultadoDesvio {
  const fuera = distanciaATrazaM > radioM;
  const dentroDeReingreso = distanciaATrazaM <= radioM * FACTOR_REINGRESO;

  if (!estadoPrevio.enDesvio) {
    const lecturasFuera = fuera ? estadoPrevio.lecturasFuera + 1 : 0;
    const abre = lecturasFuera >= LECTURAS_PARA_ABRIR;
    return {
      estado: {
        enDesvio: abre,
        lecturasFuera: abre ? 0 : lecturasFuera,
        lecturasDentro: 0,
      },
      debeAlertar: abre,
      debeCerrarAlerta: false,
    };
  }

  const lecturasDentro = dentroDeReingreso ? estadoPrevio.lecturasDentro + 1 : 0;
  const cierra = lecturasDentro >= LECTURAS_PARA_CERRAR;
  return {
    estado: {
      enDesvio: !cierra,
      lecturasFuera: 0,
      lecturasDentro: cierra ? 0 : lecturasDentro,
    },
    debeAlertar: false,
    debeCerrarAlerta: cierra,
  };
}

// ------------------------------------------------------------------- clima --

export interface UmbralesClima {
  precipitacionMm: number;
  vientoKmh: number;
  temperaturaMinC: number;
}

/** Umbrales por defecto para una salida de montaña de jornada. */
export const UMBRALES_CLIMA: UmbralesClima = {
  precipitacionMm: 10,
  vientoKmh: 40,
  temperaturaMinC: 0,
};

/** Multiplicador a partir del cual una condición pasa de advertencia a riesgo. */
export const FACTOR_RIESGO = 2;

/**
 * Evalúa el pronóstico del sendero contra los umbrales definidos.
 *
 * Devuelve la severidad más alta alcanzada y el detalle de cada condición que
 * la motivó, de modo que la advertencia pueda explicar por qué se emitió en
 * lugar de limitarse a decir que hay riesgo.
 */
export function evaluarClima(
  pronostico: Pronostico,
  umbrales: UmbralesClima = UMBRALES_CLIMA,
  ahora: Date = new Date(),
): AlertaClimatica {
  const motivos: string[] = [];
  let severidad: Severidad = 'ninguna';

  const elevar = (nueva: Severidad) => {
    if (nueva === 'riesgo' || severidad === 'ninguna') severidad = nueva;
  };

  if (pronostico.precipitacionMm >= umbrales.precipitacionMm) {
    const grave = pronostico.precipitacionMm >= umbrales.precipitacionMm * FACTOR_RIESGO;
    motivos.push(`Precipitación prevista de ${pronostico.precipitacionMm} mm.`);
    elevar(grave ? 'riesgo' : 'advertencia');
  }

  if (pronostico.vientoKmh >= umbrales.vientoKmh) {
    const grave = pronostico.vientoKmh >= umbrales.vientoKmh * FACTOR_RIESGO;
    motivos.push(`Viento previsto de ${pronostico.vientoKmh} km/h.`);
    elevar(grave ? 'riesgo' : 'advertencia');
  }

  if (pronostico.temperaturaMinC <= umbrales.temperaturaMinC) {
    const grave = pronostico.temperaturaMinC <= umbrales.temperaturaMinC - 5;
    motivos.push(`Temperatura mínima prevista de ${pronostico.temperaturaMinC} °C.`);
    elevar(grave ? 'riesgo' : 'advertencia');
  }

  return { severidad, motivos, evaluadaEn: ahora.toISOString() };
}
