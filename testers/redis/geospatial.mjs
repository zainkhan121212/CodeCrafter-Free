import { R, show } from '../../lib/protocols/resp.mjs';
import { key, shuffle, randInt } from '../../lib/harness/random.mjs';
import { encode, decode, distance } from '../../lib/protocols/geo.mjs';
import { startServer } from './base.mjs';

const CITIES = [
  ['Munich', 11.5030378, 48.164271], ['Paris', 2.2944692, 48.8584625], ['London', -0.0884948, 51.506479],
  ['Berlin', 13.404954, 52.520008], ['Madrid', -3.70379, 40.416775], ['Rome', 12.496366, 41.902782],
  ['Vienna', 16.373819, 48.208174], ['Prague', 14.4378, 50.075538], ['Amsterdam', 4.904139, 52.367573],
  ['Lisbon', -9.139337, 38.722252], ['Warsaw', 21.012229, 52.229676], ['Dublin', -6.260273, 53.349805],
];
const cities = n => shuffle(CITIES).slice(0, n);

async function geoadd(client, k, list) {
  for (const [name, lon, lat] of list) await client.check(['GEOADD', k, String(lon), String(lat), name], R.int(1));
}

function closeTo(t, actual, expected, places, what) {
  const v = Number(actual);
  if (!Number.isFinite(v) || Math.abs(v - expected) > 10 ** -places) t.fail(`Expected ${what} ≈ ${expected.toFixed(places)} (±1e-${places}), got ${JSON.stringify(actual)}`);
}

export const stages = {
  async zt4(t) {
    const { client } = await startServer(t);
    const [[name, lon, lat]] = cities(1);
    await client.check(['GEOADD', key(), String(lon), String(lat), name], R.int(1));
  },

  async ck3(t) {
    const { client } = await startServer(t);
    const k = key();
    const cases = [[200, 10, ['longitude']], [10, 100, ['latitude']], [-190, -95, ['longitude', 'latitude']], [10, 86, ['latitude']]];
    for (const [lon, lat, words] of cases) {
      const reply = await client.command('GEOADD', k, String(lon), String(lat), 'foo');
      if (reply.type !== 'error' || !reply.value.startsWith('ERR')) t.fail(`Expected an error starting with "ERR", got ${show(reply)}`);
      const lonBad = lon < -180 || lon > 180;
      const needed = lonBad && words.includes('latitude') ? ['longitude'] : words;
      for (const w of needed) if (!reply.value.toLowerCase().includes(w)) t.fail(`Expected the error to mention "${w}", got ${show(reply)}`);
      t.log.success(`✔︎ Received ${show(reply)}`);
    }
    const [[name, glon, glat]] = cities(1);
    await client.check(['GEOADD', k, String(glon), String(glat), name], R.int(1));
  },

  async tn5(t) {
    const { client } = await startServer(t);
    const k = key(), list = cities(1);
    await geoadd(client, k, list);
    await client.check(['ZRANGE', k, '0', '-1'], R.array([list[0][0]]));
  },

  async cr3(t) {
    const { client } = await startServer(t);
    const k = key(), list = cities(randInt(2, 4));
    await geoadd(client, k, list);
    for (const [name, lon, lat] of list) await client.check(['ZSCORE', k, name], R.bulk(String(encode(lon, lat))));
  },

  async xg4(t) {
    const { client } = await startServer(t);
    const k = key(), list = cities(2);
    await geoadd(client, k, list);
    const reply = await client.command('GEOPOS', k, list[0][0], list[1][0]);
    const ok = reply.type === 'array' && reply.value?.length === 2 && reply.value.every(p => p.type === 'array' && p.value?.length === 2 && p.value.every(x => x.type === 'bulk' && Number.isFinite(Number(x.value))));
    if (!ok) t.fail(`Expected an array of two [longitude, latitude] pairs (bulk strings), got ${show(reply)}`);
    t.log.success(`✔︎ Received ${show(reply)}`);
    await client.check(['GEOPOS', k, 'missing_location'], R.array([R.nullArray()]));
    await client.check(['GEOPOS', `missing_${key()}`, list[0][0], list[1][0]], R.array([R.nullArray(), R.nullArray()]));
  },

  async hb5(t) {
    const { client } = await startServer(t);
    const k = key(), list = cities(randInt(2, 4));
    for (const [name, lon, lat] of list) await client.check(['ZADD', k, String(encode(lon, lat)), name], R.int(1));
    for (const [name, lon, lat] of list) {
      const reply = await client.command('GEOPOS', k, name);
      const pair = reply.type === 'array' && reply.value?.[0]?.value;
      if (!pair || pair.length !== 2) t.fail(`Expected [[longitude, latitude]], got ${show(reply)}`);
      const d = decode(encode(lon, lat));
      closeTo(t, pair[0].value, d.lon, 6, `longitude of ${name}`);
      closeTo(t, pair[1].value, d.lat, 6, `latitude of ${name}`);
      t.log.success(`✔︎ ${name} decodes to ${pair[0].value}, ${pair[1].value}`);
    }
  },

  async ek6(t) {
    const { client } = await startServer(t);
    const k = key(), list = cities(3);
    await geoadd(client, k, list);
    for (const [a, b] of [[0, 1], [1, 2], [0, 2]]) {
      const reply = await client.command('GEODIST', k, list[a][0], list[b][0]);
      if (reply.type !== 'bulk' || reply.value === null) t.fail(`Expected a bulk string distance, got ${show(reply)}`);
      const pa = decode(encode(list[a][1], list[a][2])), pb = decode(encode(list[b][1], list[b][2]));
      const expected = distance(pa.lon, pa.lat, pb.lon, pb.lat);
      closeTo(t, Number(Number(reply.value).toFixed(4)), Number(expected.toFixed(4)), 4, `distance ${list[a][0]} → ${list[b][0]}`);
      t.log.success(`✔︎ GEODIST ${list[a][0]} ${list[b][0]} = ${reply.value}`);
    }
  },

  async rm9(t) {
    const { client } = await startServer(t);
    const k = key(), list = cities(randInt(5, 8));
    await geoadd(client, k, list);
    const decoded = list.map(([name, lon, lat]) => ({ name, ...decode(encode(lon, lat)) }));
    for (let i = 0; i < 3; i++) {
      const center = list[randInt(0, list.length - 1)];
      const cLon = Math.round(center[1] + randInt(-2, 2)), cLat = Math.round(center[2] + randInt(-1, 1));
      const radius = [100000, 300000, 600000, 1000000][randInt(0, 3)];
      const expected = decoded.filter(p => distance(cLon, cLat, p.lon, p.lat) <= radius).map(p => p.name).sort();
      const reply = await client.command('GEOSEARCH', k, 'FROMLONLAT', String(cLon), String(cLat), 'BYRADIUS', String(radius), 'm');
      const got = reply.type === 'array' && reply.value ? reply.value.map(v => v.value).sort() : null;
      if (!got || JSON.stringify(got) !== JSON.stringify(expected)) t.fail(`Expected ${JSON.stringify(expected)} (any order), got ${show(reply)}`);
      t.log.success(`✔︎ Received ${show(reply)}`);
    }
  },
};
