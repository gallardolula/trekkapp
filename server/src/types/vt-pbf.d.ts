/** Minimal declaration for the one function the contour build uses.
 *
 *  `vt-pbf` ships no types. Rather than widening the whole build to `any`,
 *  the single entry point is described here, with the shape geojson-vt
 *  actually hands it.
 */
declare module 'vt-pbf' {
  interface LegacyTile {
    features: unknown[];
  }
  const vtpbf: {
    fromGeojsonVt(
      layers: Record<string, LegacyTile>,
      options?: { version?: number },
    ): Uint8Array;
  };
  export default vtpbf;
}
