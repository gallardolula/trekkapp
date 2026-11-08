import { InvalidGpxError, parseGpx } from '../gpx';

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

describe('parseGpx', () => {
  it('extracts name, description and points', () => {
    const r = parseGpx(GPX);
    expect(r.name).toBe('Ascenso al Champaquí por Villa Alpina');
    expect(r.description).toBe('Ruta clásica de dos jornadas');
    expect(r.points).toHaveLength(3);
  });

  it('reads latitude, longitude, elevation and timestamp', () => {
    const p = parseGpx(GPX).points[0];
    expect(p.lat).toBeCloseTo(-31.95, 6);
    expect(p.lon).toBeCloseTo(-64.9, 6);
    expect(p.ele).toBeCloseTo(1400.5, 3);
    expect(p.time).toBe('2026-09-19T09:00:00Z');
  });

  it('accepts points without a timestamp', () => {
    expect(parseGpx(GPX).points[2].time).toBeUndefined();
  });

  it('accepts reversed attribute order and the self closing tag', () => {
    const xml = `<gpx><trk><trkseg><trkpt lon="-64.9" lat="-31.95"/></trkseg></trk></gpx>`;
    const r = parseGpx(xml);
    expect(r.points).toHaveLength(1);
    expect(r.points[0].lat).toBeCloseTo(-31.95, 6);
  });

  it('discards out of range coordinates without losing the rest', () => {
    const xml = `<gpx><trk><trkseg>
      <trkpt lat="-31.95" lon="-64.90"/>
      <trkpt lat="999" lon="-64.90"/>
      <trkpt lat="-31.96" lon="-64.91"/>
    </trkseg></trk></gpx>`;
    expect(parseGpx(xml).points).toHaveLength(2);
  });

  it('unescapes XML entities and CDATA in the name', () => {
    const xml = `<gpx><trk><name><![CDATA[Cerro Los Gigantes & Co]]></name><trkseg>
      <trkpt lat="-31.4" lon="-64.8"/>
    </trkseg></trk></gpx>`;
    expect(parseGpx(xml).name).toBe('Cerro Los Gigantes & Co');
  });

  it('rejects a file that is not a GPX', () => {
    expect(() => parseGpx('<html></html>')).toThrow(InvalidGpxError);
  });

  it('rejects a GPX with no track points', () => {
    expect(() => parseGpx('<gpx><trk><name>empty</name></trk></gpx>')).toThrow(InvalidGpxError);
  });
});
