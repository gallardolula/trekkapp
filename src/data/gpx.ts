/** Reading GPX files.
 *
 *  GPX is XML, but the part that matters is narrow: the route name and the
 *  sequence of `<trkpt>` with latitude, longitude, elevation and timestamp.
 *  Regular expressions handle it rather than adding a full XML parser, which
 *  in React Native would mean one more native dependency for no gain here.
 */
import { Point } from '../domain/types';

export interface ParsedGpx {
  name?: string;
  description?: string;
  points: Point[];
}

export class InvalidGpxError extends Error {}

// The attribute block is captured whole and the body separately, because the
// order of `lat` and `lon` varies between the programs that export GPX.
const TRKPT = /<trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/trkpt>)/gi;
const LAT = /\blat\s*=\s*"([^"]+)"/i;
const LON = /\blon\s*=\s*"([^"]+)"/i;
const ELE = /<ele>\s*([-\d.eE+]+)\s*<\/ele>/i;
const TIME = /<time>\s*([^<]+?)\s*<\/time>/i;
const NAME = /<trk>[\s\S]*?<name>\s*([\s\S]*?)\s*<\/name>/i;
const DESC = /<trk>[\s\S]*?<desc>\s*([\s\S]*?)\s*<\/desc>/i;

function unescapeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();
}

const validLat = (v: number) => Number.isFinite(v) && v >= -90 && v <= 90;
const validLon = (v: number) => Number.isFinite(v) && v >= -180 && v <= 180;

/**
 * Parses the contents of a GPX file.
 *
 * Points with missing or out of range coordinates are discarded rather than
 * aborting the read: a file exported by a device can carry isolated corrupt
 * readings, and losing the whole route over one of them would be worse. If no
 * valid point remains, the file is treated as unusable.
 */
export function parseGpx(xml: string): ParsedGpx {
  if (!/<gpx\b/i.test(xml)) {
    throw new InvalidGpxError('The file does not look like a GPX.');
  }

  const points: Point[] = [];
  TRKPT.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = TRKPT.exec(xml)) !== null) {
    const attributes = m[1] ?? '';
    const mLat = attributes.match(LAT);
    const mLon = attributes.match(LON);
    if (!mLat || !mLon) continue;

    const lat = Number.parseFloat(mLat[1]);
    const lon = Number.parseFloat(mLon[1]);
    if (!validLat(lat) || !validLon(lon)) continue;

    const point: Point = { lat, lon };
    const body = m[2] ?? '';

    const ele = body.match(ELE);
    if (ele) {
      const value = Number.parseFloat(ele[1]);
      if (Number.isFinite(value)) point.ele = value;
    }

    const time = body.match(TIME);
    if (time) point.time = time[1];

    points.push(point);
  }

  if (points.length === 0) {
    throw new InvalidGpxError('The GPX file contains no track points.');
  }

  const name = xml.match(NAME);
  const description = xml.match(DESC);

  return {
    name: name ? unescapeXml(name[1]) || undefined : undefined,
    description: description ? unescapeXml(description[1]) || undefined : undefined,
    points,
  };
}
