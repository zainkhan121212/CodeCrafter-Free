// Redis geohash scores (52-bit interleaved lat/lon) and distances, as Redis computes them.
const MIN_LAT = -85.05112878, MAX_LAT = 85.05112878, MIN_LON = -180, MAX_LON = 180;
const LAT_RANGE = MAX_LAT - MIN_LAT, LON_RANGE = MAX_LON - MIN_LON;
const STEP = 2 ** 26;
export const EARTH_RADIUS = 6372797.560856;
export const validLon = lon => lon >= MIN_LON && lon <= MAX_LON;
export const validLat = lat => lat >= MIN_LAT && lat <= MAX_LAT;

function spread(v) {
  let x = BigInt(v);
  let out = 0n;
  for (let i = 0n; i < 26n; i++) out |= ((x >> i) & 1n) << (2n * i);
  return out;
}
function compact(v) {
  let out = 0n;
  for (let i = 0n; i < 26n; i++) out |= ((v >> (2n * i)) & 1n) << i;
  return Number(out);
}

export function encode(lon, lat) {
  const latInt = Math.floor((STEP * (lat - MIN_LAT)) / LAT_RANGE);
  const lonInt = Math.floor((STEP * (lon - MIN_LON)) / LON_RANGE);
  return Number(spread(latInt) | (spread(lonInt) << 1n));
}

export function decode(score) {
  const s = BigInt(Math.round(score));
  const latInt = compact(s), lonInt = compact(s >> 1n);
  const latMin = MIN_LAT + LAT_RANGE * (latInt / STEP), latMax = MIN_LAT + LAT_RANGE * ((latInt + 1) / STEP);
  const lonMin = MIN_LON + LON_RANGE * (lonInt / STEP), lonMax = MIN_LON + LON_RANGE * ((lonInt + 1) / STEP);
  return { lon: (lonMin + lonMax) / 2, lat: (latMin + latMax) / 2 };
}

export function distance(lon1, lat1, lon2, lat2) {
  const r = d => (d * Math.PI) / 180;
  const u = Math.sin((r(lat2) - r(lat1)) / 2), v = Math.sin((r(lon2) - r(lon1)) / 2);
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(u * u + Math.cos(r(lat1)) * Math.cos(r(lat2)) * v * v));
}
