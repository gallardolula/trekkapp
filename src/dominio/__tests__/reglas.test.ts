import {
  evaluarClima,
  evaluarDescarga,
  evaluarDesvio,
  LECTURAS_PARA_ABRIR,
  LECTURAS_PARA_CERRAR,
  RADIO_TOLERANCIA_M,
} from '../reglas';
import { calcularAtributos } from '../sendero';
import { AtributosSendero, ESTADO_DESVIO_INICIAL, EstadoDesvio, Nivel, Pronostico } from '../tipos';

const atributos = (distanciaM: number, desnivelM: number): AtributosSendero => ({
  distanciaM,
  desnivelAcumuladoM: desnivelM,
  indiceEsfuerzo: distanciaM / 1000 + desnivelM / 100,
  exigencia:
    distanciaM / 1000 + desnivelM / 100 <= 8
      ? 'principiante'
      : distanciaM / 1000 + desnivelM / 100 <= 18
        ? 'intermedio'
        : 'avanzado',
});

describe('evaluarDescarga', () => {
  it('no pide confirmación cuando la exigencia coincide con el nivel', () => {
    const r = evaluarDescarga(atributos(5000, 200), 'principiante');
    expect(r).toEqual({ permitida: true, requiereConfirmacion: false });
  });

  it('no pide confirmación cuando el caminante supera la exigencia', () => {
    const r = evaluarDescarga(atributos(5000, 200), 'avanzado');
    expect(r.requiereConfirmacion).toBe(false);
  });

  it('exige confirmación a un principiante ante un sendero avanzado', () => {
    const r = evaluarDescarga(atributos(20_000, 1500), 'principiante');
    expect(r.requiereConfirmacion).toBe(true);
    expect(r.motivo).toContain('avanzado');
    expect(r.motivo).toContain('principiante');
  });

  it('nunca bloquea la descarga: la decisión final es del caminante', () => {
    const r = evaluarDescarga(atributos(30_000, 2500), 'principiante');
    expect(r.permitida).toBe(true);
  });

  it('informa distancia y desnivel en el motivo, para que la advertencia sea explicable', () => {
    const r = evaluarDescarga(atributos(20_000, 1500), 'principiante');
    expect(r.motivo).toContain('20.0 km');
    expect(r.motivo).toContain('1500 m');
  });
});

describe('evaluarDesvio', () => {
  /** Aplica una serie de distancias y devuelve el historial de resultados. */
  const correr = (distancias: number[]) => {
    let estado: EstadoDesvio = ESTADO_DESVIO_INICIAL;
    return distancias.map((d) => {
      const r = evaluarDesvio(d, estado);
      estado = r.estado;
      return r;
    });
  };

  it('no alerta mientras la persona va sobre la traza', () => {
    const rs = correr([5, 12, 30, 8]);
    expect(rs.every((r) => !r.debeAlertar && !r.estado.enDesvio)).toBe(true);
  });

  it('ignora una lectura suelta fuera del radio', () => {
    // El error del receptor puede superar el radio de manera puntual.
    const rs = correr([10, 80, 10, 12]);
    expect(rs.some((r) => r.debeAlertar)).toBe(false);
  });

  it('alerta recién a la tercera lectura consecutiva fuera del radio', () => {
    const rs = correr([80, 90, 100]);
    expect(rs[0].debeAlertar).toBe(false);
    expect(rs[1].debeAlertar).toBe(false);
    expect(rs[2].debeAlertar).toBe(true);
    expect(rs[2].estado.enDesvio).toBe(true);
  });

  it('alerta una sola vez y no repite el aviso mientras sigue desviada', () => {
    const rs = correr([80, 90, 100, 120, 150, 200]);
    expect(rs.filter((r) => r.debeAlertar)).toHaveLength(1);
    expect(rs[rs.length - 1].estado.enDesvio).toBe(true);
  });

  it('no cierra la alerta al volver apenas por debajo del radio (histéresis)', () => {
    const justoDebajo = RADIO_TOLERANCIA_M - 1; // 49 m: dentro del radio, fuera del reingreso
    const rs = correr([80, 90, 100, justoDebajo, justoDebajo, justoDebajo]);
    expect(rs[rs.length - 1].estado.enDesvio).toBe(true);
    expect(rs.some((r) => r.debeCerrarAlerta)).toBe(false);
  });

  it('cierra la alerta tras tres lecturas dentro del 70 % del radio', () => {
    const reingreso = RADIO_TOLERANCIA_M * 0.5; // 25 m
    const rs = correr([80, 90, 100, reingreso, reingreso, reingreso]);
    expect(rs[rs.length - 1].debeCerrarAlerta).toBe(true);
    expect(rs[rs.length - 1].estado.enDesvio).toBe(false);
  });

  it('vuelve a alertar si la persona se desvía otra vez después de reingresar', () => {
    const r = RADIO_TOLERANCIA_M * 0.5;
    const rs = correr([80, 90, 100, r, r, r, 80, 90, 100]);
    expect(rs.filter((x) => x.debeAlertar)).toHaveLength(2);
  });

  it('respeta un radio de tolerancia personalizado', () => {
    let estado = ESTADO_DESVIO_INICIAL;
    for (let i = 0; i < LECTURAS_PARA_ABRIR; i++) {
      estado = evaluarDesvio(150, estado, 200).estado;
    }
    expect(estado.enDesvio).toBe(false); // 150 m no es desvío con radio de 200 m
  });

  it('las constantes de apertura y cierre son coherentes con el comportamiento probado', () => {
    expect(LECTURAS_PARA_ABRIR).toBe(3);
    expect(LECTURAS_PARA_CERRAR).toBe(3);
  });
});

describe('evaluarClima', () => {
  const base: Pronostico = {
    fecha: '2026-09-20',
    precipitacionMm: 0,
    vientoKmh: 10,
    temperaturaMinC: 12,
    temperaturaMaxC: 24,
  };

  it('no alerta con un pronóstico benigno', () => {
    const a = evaluarClima(base);
    expect(a.severidad).toBe('ninguna');
    expect(a.motivos).toHaveLength(0);
  });

  it('advierte al alcanzar el umbral de precipitación', () => {
    const a = evaluarClima({ ...base, precipitacionMm: 12 });
    expect(a.severidad).toBe('advertencia');
    expect(a.motivos[0]).toContain('12 mm');
  });

  it('eleva a riesgo al duplicar el umbral', () => {
    const a = evaluarClima({ ...base, precipitacionMm: 25 });
    expect(a.severidad).toBe('riesgo');
  });

  it('acumula los motivos de varias condiciones a la vez', () => {
    const a = evaluarClima({ ...base, precipitacionMm: 12, vientoKmh: 45 });
    expect(a.motivos).toHaveLength(2);
  });

  it('una condición de riesgo domina sobre una de advertencia', () => {
    const a = evaluarClima({ ...base, precipitacionMm: 12, vientoKmh: 100 });
    expect(a.severidad).toBe('riesgo');
  });

  it('advierte por temperatura mínima bajo cero', () => {
    const a = evaluarClima({ ...base, temperaturaMinC: -1 });
    expect(a.severidad).toBe('advertencia');
  });

  it('registra el momento de evaluación, para poder mostrar su antigüedad sin conexión', () => {
    const momento = new Date('2026-09-20T08:00:00.000Z');
    const a = evaluarClima(base, undefined, momento);
    expect(a.evaluadaEn).toBe('2026-09-20T08:00:00.000Z');
  });
});

describe('integración: atributos calculados alimentan la regla de descarga', () => {
  it('un sendero corto y llano no exige confirmación a un principiante', () => {
    // ~2 km en llano
    const puntos = Array.from({ length: 21 }, (_, i) => ({
      lat: -31.9 + i * 0.0009,
      lon: -64.8,
      ele: 800,
    }));
    const attrs = calcularAtributos(puntos);
    expect(attrs.exigencia).toBe<Nivel>('principiante');
    expect(evaluarDescarga(attrs, 'principiante').requiereConfirmacion).toBe(false);
  });

  it('un ascenso sostenido sí la exige', () => {
    // ~10 km con 1400 m de ascenso: índice de esfuerzo ≈ 24
    const puntos = Array.from({ length: 101 }, (_, i) => ({
      lat: -31.9 + i * 0.0009,
      lon: -64.8,
      ele: 800 + i * 14,
    }));
    const attrs = calcularAtributos(puntos);
    expect(attrs.exigencia).toBe<Nivel>('avanzado');
    expect(evaluarDescarga(attrs, 'principiante').requiereConfirmacion).toBe(true);
  });
});
