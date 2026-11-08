/** Builds an empty ocean polygon shapefile.
 *
 *  Planetiler expects a water-polygons archive to draw the ocean. The host
 *  that publishes it is unreachable, and the Sierras de Córdoba are a
 *  thousand kilometres from the sea, so an archive with no features is the
 *  correct input rather than a stand-in: there is no ocean to draw.
 *
 *  Replace this with the real archive if the region ever reaches a coast.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const POLYGON = 5;

function shpHeader() {
  const b = Buffer.alloc(100);
  b.writeInt32BE(9994, 0);        // file code
  b.writeInt32BE(50, 24);         // length in 16-bit words: header only
  b.writeInt32LE(1000, 28);       // version
  b.writeInt32LE(POLYGON, 32);    // shape type
  return b;                        // bounding box and ranges stay zero
}

function dbf() {
  const fields = 1;
  const headerLength = 32 + 32 * fields + 1;
  const b = Buffer.alloc(headerLength + 1);
  b.writeUInt8(0x03, 0);                       // dBASE III without memo
  b.writeUInt8(26, 1); b.writeUInt8(11, 2); b.writeUInt8(8, 3);
  b.writeInt32LE(0, 4);                        // no records
  b.writeInt16LE(headerLength, 8);
  b.writeInt16LE(2, 10);                       // deletion flag plus one char
  b.write('FID', 32, 'ascii');                 // single character field
  b.writeUInt8(0x43, 32 + 11);                 // type C
  b.writeUInt8(1, 32 + 16);                    // length
  b.writeUInt8(0x0d, 32 + 32);                 // field terminator
  b.writeUInt8(0x1a, headerLength);            // end of file
  return b;
}

const dir = 'data/empty-water/water-polygons-split-3857';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/water_polygons.shp`, shpHeader());
writeFileSync(`${dir}/water_polygons.shx`, shpHeader());
writeFileSync(`${dir}/water_polygons.dbf`, dbf());
writeFileSync(`${dir}/water_polygons.prj`,
  'PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",' +
  'DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],' +
  'PROJECTION["Mercator_Auxiliary_Sphere"],UNIT["Meter",1.0]]');

execFileSync('zip', ['-qr', '../water-polygons-split-3857.zip', 'water-polygons-split-3857'],
  { cwd: 'data/empty-water' });
console.log('archivo de oceano vacio creado');
