import { GpxInvalidoError, parsearGpx } from '../gpx';

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Wikiloc">
  <trk>
    <name>Ascenso al Champaquí por Villa Alpina</name>
    <desc>Ruta clásica de dos jornadas</desc>
    <trkseg>
      <trkpt lat="-31.9500" lon="-64.9000"><ele>1400.5</ele><time>2026-09-19T09:00:00Z</time></trkpt>
      <trkpt lat="-31.9510" lon="-64.9010"><ele>1425.0</ele><time>2026-09-19T09:10:00Z</time></trkpt>
      <trkpt lat="-31.9520" lon="-64.9020"><ele>1450.0</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

describe('parsearGpx', () => {
  it('extrae nombre, descripción y puntos', () => {
    const r = parsearGpx(GPX);
    expect(r.nombre).toBe('Ascenso al Champaquí por Villa Alpina');
    expect(r.descripcion).toBe('Ruta clásica de dos jornadas');
    expect(r.puntos).toHaveLength(3);
  });

  it('lee latitud, longitud, altitud y marca de tiempo', () => {
    const p = parsearGpx(GPX).puntos[0];
    expect(p.lat).toBeCloseTo(-31.95, 6);
    expect(p.lon).toBeCloseTo(-64.9, 6);
    expect(p.ele).toBeCloseTo(1400.5, 3);
    expect(p.tiempo).toBe('2026-09-19T09:00:00Z');
  });

  it('acepta puntos sin marca de tiempo', () => {
    expect(parsearGpx(GPX).puntos[2].tiempo).toBeUndefined();
  });

  it('acepta el orden invertido de los atributos y la etiqueta autocerrada', () => {
    const xml = `<gpx><trk><trkseg>
      <trkpt lon="-64.9" lat="-31.95"/>
    </trkseg></trk></gpx>`;
    const r = parsearGpx(xml);
    expect(r.puntos).toHaveLength(1);
    expect(r.puntos[0].lat).toBeCloseTo(-31.95, 6);
  });

  it('descarta puntos con coordenadas fuera de rango sin perder el resto', () => {
    const xml = `<gpx><trk><trkseg>
      <trkpt lat="-31.95" lon="-64.90"/>
      <trkpt lat="999" lon="-64.90"/>
      <trkpt lat="-31.96" lon="-64.91"/>
    </trkseg></trk></gpx>`;
    expect(parsearGpx(xml).puntos).toHaveLength(2);
  });

  it('desescapa entidades XML y CDATA del nombre', () => {
    const xml = `<gpx><trk><name><![CDATA[Cerro Los Gigantes & Co]]></name><trkseg>
      <trkpt lat="-31.4" lon="-64.8"/>
    </trkseg></trk></gpx>`;
    expect(parsearGpx(xml).nombre).toBe('Cerro Los Gigantes & Co');
  });

  it('rechaza un archivo que no es GPX', () => {
    expect(() => parsearGpx('<html></html>')).toThrow(GpxInvalidoError);
  });

  it('rechaza un GPX sin puntos de recorrido', () => {
    expect(() => parsearGpx('<gpx><trk><name>vacio</name></trk></gpx>')).toThrow(
      GpxInvalidoError,
    );
  });
});
