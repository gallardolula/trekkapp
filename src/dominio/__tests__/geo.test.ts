import {
  distanciaATraza,
  distanciaHaversine,
  distanciaPuntoASegmento,
} from '../geo';
import { Punto } from '../tipos';

/** Un grado de latitud son unos 111 320 m en cualquier meridiano. */
const M_POR_GRADO_LAT = 111_320;

describe('distanciaHaversine', () => {
  it('devuelve cero entre un punto y sí mismo', () => {
    const p: Punto = { lat: -31.9, lon: -64.8 };
    expect(distanciaHaversine(p, p)).toBe(0);
  });

  it('mide un grado de latitud con menos de 1 % de error', () => {
    const d = distanciaHaversine({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
    expect(d).toBeGreaterThan(M_POR_GRADO_LAT * 0.99);
    expect(d).toBeLessThan(M_POR_GRADO_LAT * 1.01);
  });

  it('es simétrica', () => {
    const a: Punto = { lat: -31.9, lon: -64.8 };
    const b: Punto = { lat: -31.95, lon: -64.75 };
    expect(distanciaHaversine(a, b)).toBeCloseTo(distanciaHaversine(b, a), 6);
  });

  it('acorta la distancia de un grado de longitud según la latitud', () => {
    const enEcuador = distanciaHaversine({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const enCordoba = distanciaHaversine({ lat: -31.9, lon: 0 }, { lat: -31.9, lon: 1 });
    expect(enCordoba).toBeLessThan(enEcuador);
    // cos(31,9°) ≈ 0,849
    expect(enCordoba / enEcuador).toBeCloseTo(Math.cos((31.9 * Math.PI) / 180), 3);
  });
});

describe('distanciaPuntoASegmento', () => {
  const a: Punto = { lat: 0, lon: 0 };
  const b: Punto = { lat: 0, lon: 1 };

  it('mide la perpendicular cuando la proyección cae dentro del segmento', () => {
    const p: Punto = { lat: 0.001, lon: 0.5 };
    const d = distanciaPuntoASegmento(p, a, b);
    expect(d).toBeCloseTo(0.001 * M_POR_GRADO_LAT, -1); // ~111 m
  });

  it('mide contra el extremo cuando la proyección cae fuera', () => {
    const p: Punto = { lat: 0, lon: 1.5 };
    const d = distanciaPuntoASegmento(p, a, b);
    // el punto más cercano del segmento es el extremo b, a medio grado
    expect(d).toBeCloseTo(distanciaHaversine(p, b), -1);
  });

  it('devuelve cero para un punto sobre el segmento', () => {
    expect(distanciaPuntoASegmento({ lat: 0, lon: 0.5 }, a, b)).toBeCloseTo(0, 3);
  });

  it('maneja un segmento degenerado sin dividir por cero', () => {
    const p: Punto = { lat: 0.001, lon: 0 };
    const d = distanciaPuntoASegmento(p, a, a);
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeCloseTo(distanciaHaversine(p, a), 6);
  });
});

describe('distanciaATraza', () => {
  // Traza en forma de L: baja por un meridiano y luego dobla hacia el este.
  const traza: Punto[] = [
    { lat: 0, lon: 0 },
    { lat: -0.01, lon: 0 },
    { lat: -0.01, lon: 0.01 },
  ];

  it('elige el segmento más cercano, no el primero', () => {
    const p: Punto = { lat: -0.0101, lon: 0.005 };
    const r = distanciaATraza(p, traza);
    expect(r.indiceSegmento).toBe(1);
    expect(r.metros).toBeLessThan(20);
  });

  it('no sobreestima la distancia en el medio de un tramo largo y recto', () => {
    // Medido solo contra los vértices, este punto daría ~550 m; contra el
    // segmento da ~11 m, que es la distancia real al sendero.
    const p: Punto = { lat: -0.005, lon: 0.0001 };
    const r = distanciaATraza(p, traza);
    expect(r.metros).toBeLessThan(20);
  });

  it('funciona con una traza de un solo punto', () => {
    const r = distanciaATraza({ lat: 0.001, lon: 0 }, [{ lat: 0, lon: 0 }]);
    expect(r.metros).toBeCloseTo(M_POR_GRADO_LAT * 0.001, -1);
  });

  it('rechaza una traza vacía', () => {
    expect(() => distanciaATraza({ lat: 0, lon: 0 }, [])).toThrow();
  });
});
