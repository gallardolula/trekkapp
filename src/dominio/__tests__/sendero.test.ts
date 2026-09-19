import {
  calcularAtributos,
  clasificarExigencia,
  desnivelAcumulado,
  distanciaTotal,
  indiceEsfuerzo,
  UMBRAL_RUIDO_ALTITUD_M,
} from '../sendero';
import { Punto } from '../tipos';

describe('distanciaTotal', () => {
  it('es cero para una traza de un solo punto', () => {
    expect(distanciaTotal([{ lat: 0, lon: 0 }])).toBe(0);
  });

  it('es cero para una traza vacía', () => {
    expect(distanciaTotal([])).toBe(0);
  });

  it('suma los tramos sucesivos', () => {
    const puntos: Punto[] = [
      { lat: 0, lon: 0 },
      { lat: 0.001, lon: 0 },
      { lat: 0.002, lon: 0 },
    ];
    // dos tramos de ~111 m
    expect(distanciaTotal(puntos)).toBeCloseTo(222.6, 0);
  });
});

describe('desnivelAcumulado', () => {
  it('es cero si ningún punto trae altitud', () => {
    expect(desnivelAcumulado([{ lat: 0, lon: 0 }, { lat: 0.1, lon: 0 }])).toBe(0);
  });

  it('suma solo los ascensos e ignora los descensos', () => {
    const puntos: Punto[] = [
      { lat: 0, lon: 0, ele: 100 },
      { lat: 0, lon: 0, ele: 150 }, // +50
      { lat: 0, lon: 0, ele: 120 }, // -30, no suma
      { lat: 0, lon: 0, ele: 170 }, // +50
    ];
    expect(desnivelAcumulado(puntos)).toBe(100);
  });

  it('descarta el ruido de altitud por debajo del umbral', () => {
    // Oscilación de ±2 m con el dispositivo quieto: no debe acumular nada.
    const puntos: Punto[] = [
      { lat: 0, lon: 0, ele: 100 },
      { lat: 0, lon: 0, ele: 102 },
      { lat: 0, lon: 0, ele: 100 },
      { lat: 0, lon: 0, ele: 101 },
      { lat: 0, lon: 0, ele: 99 },
    ];
    expect(desnivelAcumulado(puntos)).toBe(0);
  });

  it('acumula una subida sostenida aunque cada paso quede bajo el umbral', () => {
    // 20 pasos de 2 m: cada uno está bajo el umbral, pero la referencia no se
    // mueve, así que la subida real de 40 m se detecta igual.
    const puntos: Punto[] = Array.from({ length: 21 }, (_, i) => ({
      lat: 0,
      lon: 0,
      ele: 100 + i * 2,
    }));
    expect(desnivelAcumulado(puntos)).toBeGreaterThan(30);
  });

  it('respeta un umbral de ruido configurable', () => {
    const puntos: Punto[] = [
      { lat: 0, lon: 0, ele: 100 },
      { lat: 0, lon: 0, ele: 104 },
    ];
    expect(desnivelAcumulado(puntos, UMBRAL_RUIDO_ALTITUD_M)).toBe(4);
    expect(desnivelAcumulado(puntos, 10)).toBe(0);
  });

  it('ignora los puntos sin altitud intercalados', () => {
    const puntos: Punto[] = [
      { lat: 0, lon: 0, ele: 100 },
      { lat: 0, lon: 0 },
      { lat: 0, lon: 0, ele: 150 },
    ];
    expect(desnivelAcumulado(puntos)).toBe(50);
  });
});

describe('indiceEsfuerzo y clasificarExigencia', () => {
  it('equipara 100 m de ascenso a 1 km en llano', () => {
    expect(indiceEsfuerzo(0, 100)).toBeCloseTo(1, 6);
    expect(indiceEsfuerzo(1000, 0)).toBeCloseTo(1, 6);
  });

  it('distingue dos senderos de igual distancia y distinto desnivel', () => {
    const llano = indiceEsfuerzo(10_000, 100);
    const empinado = indiceEsfuerzo(10_000, 1200);
    expect(clasificarExigencia(llano)).toBe('intermedio');
    expect(clasificarExigencia(empinado)).toBe('avanzado');
  });

  it('clasifica en los bordes de los umbrales', () => {
    expect(clasificarExigencia(8)).toBe('principiante');
    expect(clasificarExigencia(8.01)).toBe('intermedio');
    expect(clasificarExigencia(18)).toBe('intermedio');
    expect(clasificarExigencia(18.01)).toBe('avanzado');
  });
});

describe('calcularAtributos', () => {
  it('deriva todos los atributos de la traza, sin datos cargados a mano', () => {
    const puntos: Punto[] = Array.from({ length: 51 }, (_, i) => ({
      lat: -31.9 + i * 0.0009,
      lon: -64.8,
      ele: 800 + i * 10,
    }));
    const a = calcularAtributos(puntos);

    expect(a.distanciaM).toBeGreaterThan(4900);
    expect(a.distanciaM).toBeLessThan(5100);
    expect(a.desnivelAcumuladoM).toBeCloseTo(500, 0);
    expect(a.indiceEsfuerzo).toBeCloseTo(a.distanciaM / 1000 + 5, 1);
    expect(a.exigencia).toBe('intermedio');
  });

  it('no falla con una traza vacía', () => {
    const a = calcularAtributos([]);
    expect(a.distanciaM).toBe(0);
    expect(a.desnivelAcumuladoM).toBe(0);
    expect(a.exigencia).toBe('principiante');
  });
});
