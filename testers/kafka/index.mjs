// Kafka tester: speaks the Kafka wire protocol to the learner's broker on port 9092.
// Topic metadata and partition logs are written to /tmp/kraft-combined-logs (on Windows: <drive>:\tmp\...),
// and the broker is started with a server.properties file whose log.dirs points there.
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { TcpConn, ensurePortFree } from '../../lib/harness/net.mjs';
import { TestFailure } from '../../lib/harness/runner.mjs';
import {
  Reader, KafkaDecodeError, apiVersionsRequest, describeTopicPartitionsRequest, fetchRequest, produceRequest,
  decodeApiVersionsResponse, decodeDescribeTopicPartitionsResponse, decodeFetchResponse, decodeProduceResponse,
  clusterMetadataLog, recordBatch, splitBatches, newUuid,
} from '../../lib/protocols/kafka.mjs';
import { word, words, randInt, shuffle } from '../../lib/harness/random.mjs';

const PORT = 9092;
const randomId = () => randInt(1, 2 ** 31 - 1);

function logDir(t) {
  return resolve(t.project.dir, '/tmp/kraft-combined-logs');
}

// Writes cluster metadata and partition logs, plus server.properties; returns its path.
async function prepareCluster(t, topics = [], logs = {}) {
  const dir = logDir(t);
  await rm(dir, { recursive: true, force: true });
  await mkdir(join(dir, '__cluster_metadata-0'), { recursive: true });
  await writeFile(join(dir, '__cluster_metadata-0', '00000000000000000000.log'), clusterMetadataLog(topics));
  for (const topic of topics) {
    for (const p of topic.partitions) {
      await mkdir(join(dir, `${topic.name}-${p}`), { recursive: true });
      await writeFile(join(dir, `${topic.name}-${p}`, '00000000000000000000.log'), logs[`${topic.name}-${p}`] || Buffer.alloc(0));
    }
  }
  const props = join(resolve(t.project.dir, '/tmp'), 'server.properties');
  await writeFile(props, `process.roles=broker,controller\nnode.id=1\nlisteners=PLAINTEXT://:9092\nlog.dirs=${dir.replace(/\\/g, '/')}\n`);
  if (topics.length) t.log.info(`Wrote cluster metadata with topics: ${topics.map(x => `${x.name} (${x.partitions.length} partition(s))`).join(', ')}`);
  t.onCleanup(() => rm(dir, { recursive: true, force: true }).catch(() => {}));
  return props;
}

async function start(t, { cluster = [], logs = {} } = {}) {
  const props = await prepareCluster(t, cluster, logs);
  const proc = t.spawn([props]);
  return { proc, client: await connect(t, proc) };
}

async function connect(t, proc, name = null) {
  const conn = await TcpConn.connect(PORT, { isAlive: () => proc.running });
  t.onCleanup(() => conn.close());
  conn.name = name;
  return conn;
}

const label = conn => (conn.name ? `${conn.name}: ` : '');

// Reads one response frame: int32 message_size + that many bytes.
async function readFrame(conn) {
  const size = (await conn.readExact(4, 3000, 'response message_size')).readInt32BE(0);
  if (size < 4 || size > 10 * 1024 * 1024) throw new TestFailure(`Invalid message_size ${size}`);
  return conn.readExact(size, 3000, `response body (message_size says ${size} bytes)`);
}

function decode(fn, body, what) {
  try {
    const r = new Reader(body);
    const correlationId = r.int32('correlation_id');
    if (what !== 'ApiVersions') r.tags('response header tagged fields');
    const value = fn(r);
    r.done(`${what} response`);
    return { correlationId, ...value };
  } catch (err) {
    if (err instanceof KafkaDecodeError) throw new TestFailure(`Could not decode ${what} response: ${err.message}`);
    throw err;
  }
}

function expectEq(what, actual, expected) {
  if (actual !== expected) throw new TestFailure(`Expected ${what} to be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function apiVersions(t, conn, { min = {} } = {}) {
  const id = randomId();
  t.log.info(`${label(conn)}Sending ApiVersions (v4) request (correlation ID ${id})`);
  conn.write(apiVersionsRequest(id));
  const res = decode(decodeApiVersionsResponse, await readFrame(conn), 'ApiVersions');
  expectEq('correlation_id', res.correlationId, id);
  expectEq('error_code', res.errorCode, 0);
  const need = { 18: [0, 4], ...min };
  for (const [key, [minV, maxAtLeast]] of Object.entries(need)) {
    const entry = res.apiKeys.find(k => k.apiKey === Number(key));
    if (!entry) throw new TestFailure(`Expected ApiVersions response to include API key ${key}`);
    expectEq(`min_version for API key ${key}`, entry.min, minV);
    if (entry.max < maxAtLeast) throw new TestFailure(`Expected max_version for API key ${key} to be at least ${maxAtLeast}, got ${entry.max}`);
  }
  t.log.success(`${label(conn)}✓ ApiVersions response is valid (${res.apiKeys.map(k => k.apiKey).join(', ')})`);
}

async function describe(t, conn, names) {
  const id = randomId();
  t.log.info(`Sending DescribeTopicPartitions (v0) request for ${names.join(', ')} (correlation ID ${id})`);
  conn.write(describeTopicPartitionsRequest(id, names));
  const res = decode(decodeDescribeTopicPartitionsResponse, await readFrame(conn), 'DescribeTopicPartitions');
  expectEq('correlation_id', res.correlationId, id);
  if (res.nextCursor !== null) throw new TestFailure('Expected next_cursor to be null (-1)');
  return res;
}

function checkTopic(t, topic, expected) {
  expectEq('topic error_code', topic.errorCode, 0);
  expectEq('topic_name', topic.name, expected.name);
  expectEq(`topic_id for ${expected.name}`, topic.id, expected.id);
  const indexes = topic.partitions.map(p => p.index).sort();
  if (JSON.stringify(indexes) !== JSON.stringify([...expected.partitions].sort())) throw new TestFailure(`Expected partitions ${JSON.stringify(expected.partitions)} for ${expected.name}, got ${JSON.stringify(indexes)}`);
  for (const p of topic.partitions) expectEq(`error_code of partition ${p.index}`, p.errorCode, 0);
  t.log.success(`✓ Topic ${expected.name} is correct (${expected.partitions.length} partition(s))`);
}

const makeTopic = (n = 1, name = `${word()}-${randInt(10, 99)}`) => ({ name, id: newUuid(), partitions: [...Array(n).keys()] });

async function fetch(t, conn, topics) {
  const id = randomId();
  t.log.info(`Sending Fetch (v16) request with ${topics.length} topic(s) (correlation ID ${id})`);
  conn.write(fetchRequest(id, topics));
  const res = decode(decodeFetchResponse, await readFrame(conn), 'Fetch');
  expectEq('correlation_id', res.correlationId, id);
  expectEq('throttle_time_ms', res.throttle, 0);
  expectEq('error_code', res.errorCode, 0);
  return res;
}

async function fetchStage(t, values) {
  const topic = makeTopic(1);
  const log = values.length ? Buffer.concat(values.map((v, i) => recordBatch({ baseOffset: i, values: [v] }))) : Buffer.alloc(0);
  const { client } = await start(t, { cluster: [topic], logs: { [`${topic.name}-0`]: log } });
  const res = await fetch(t, client, [{ id: topic.id, partitions: [0] }]);
  expectEq('number of responses', res.responses.length, 1);
  expectEq('topic_id', res.responses[0].topicId, topic.id);
  const [p] = res.responses[0].partitions;
  if (!p) throw new TestFailure('Expected 1 partition in the response');
  expectEq('partition_index', p.index, 0);
  expectEq('partition error_code', p.errorCode, 0);
  const records = p.records || Buffer.alloc(0);
  const { batches, rest } = splitBatches(records);
  if (rest) throw new TestFailure(`records contains ${rest} trailing byte(s) that are not a complete RecordBatch`);
  expectEq('number of record batches', batches.length, values.length);
  if (!records.equals(log)) throw new TestFailure('The records in the response do not match the log file on disk byte-for-byte');
  t.log.success(`✓ Fetch response contains ${values.length} record batch(es) read from disk`);
}

async function produce(t, conn, topics) {
  const id = randomId();
  t.log.info(`Sending Produce (v11) request for ${topics.map(x => `${x.name}[${x.partitions.map(p => p.index).join(',')}]`).join(', ')} (correlation ID ${id})`);
  conn.write(produceRequest(id, topics));
  const res = decode(decodeProduceResponse, await readFrame(conn), 'Produce');
  expectEq('correlation_id', res.correlationId, id);
  expectEq('throttle_time_ms', res.throttle, 0);
  expectEq('number of topics in the response', res.topics.length, topics.length);
  return res;
}

function checkProduced(t, res, topics, { error = 0 } = {}) {
  for (const want of topics) {
    const got = res.topics.find(x => x.name === want.name);
    if (!got) throw new TestFailure(`Expected a response for topic ${want.name}`);
    expectEq(`number of partitions for ${want.name}`, got.partitions.length, want.partitions.length);
    for (const wp of want.partitions) {
      const gp = got.partitions.find(x => x.index === wp.index);
      if (!gp) throw new TestFailure(`Expected a response for partition ${wp.index} of ${want.name}`);
      expectEq(`error_code (${want.name}-${wp.index})`, gp.errorCode, error);
      expectEq(`base_offset (${want.name}-${wp.index})`, gp.baseOffset, error ? -1 : 0);
      expectEq(`log_append_time_ms (${want.name}-${wp.index})`, gp.logAppendTimeMs, -1);
      expectEq(`log_start_offset (${want.name}-${wp.index})`, gp.logStartOffset, error ? -1 : 0);
    }
  }
  t.log.success('✓ Produce response is correct');
}

async function checkLogs(t, topics) {
  for (const topic of topics) {
    for (const p of topic.partitions) {
      const file = join(logDir(t), `${topic.name}-${p.index}`, '00000000000000000000.log');
      const data = await readFile(file).catch(() => null);
      if (!data) throw new TestFailure(`Expected log file ${file} to exist`);
      if (!data.equals(p.records)) throw new TestFailure(`Log file ${topic.name}-${p.index}/00000000000000000000.log does not contain exactly the RecordBatch that was sent`);
    }
  }
  t.log.success('✓ Record batches were written to the partition log files');
}

async function produceStage(t, shape) {
  const cluster = shape.map(([n]) => makeTopic(Math.max(n, 2)));
  const { client } = await start(t, { cluster });
  const topics = cluster.map((c, i) => ({
    name: c.name,
    partitions: shuffle(c.partitions).slice(0, shape[i][0]).map(index => ({ index, records: recordBatch({ values: words(shape[i][1]).map(w => `${w} ${randInt(1, 999)}`) }) })),
  }));
  checkProduced(t, await produce(t, client, topics), topics);
  await checkLogs(t, topics);
}

export const stages = {
  async vi6(t) {
    const proc = t.spawn([await prepareCluster(t)]);
    t.log.info(`Connecting to port ${PORT}...`);
    await connect(t, proc);
    t.log.success('Connection successful');
  },
  async nv3(t) {
    const { client } = await start(t);
    t.log.info('Sending a request with correlation ID 7');
    client.write(apiVersionsRequest(7));
    const head = await client.readExact(8, 3000, 'response (message_size + correlation_id)');
    expectEq('correlation_id', head.readInt32BE(4), 7);
    t.log.success('✓ correlation_id is 7');
  },
  async wa6(t) {
    const { client } = await start(t);
    const id = randomId();
    t.log.info(`Sending ApiVersions request with correlation ID ${id}`);
    client.write(apiVersionsRequest(id));
    const head = await client.readExact(8, 3000, 'response (message_size + correlation_id)');
    expectEq('correlation_id', head.readInt32BE(4), id);
    t.log.success(`✓ correlation_id is ${id}`);
  },
  async nc5(t) {
    const { client } = await start(t);
    const id = randomId(), version = randInt(5, 30000);
    t.log.info(`Sending ApiVersions request with unsupported version ${version} (correlation ID ${id})`);
    client.write(apiVersionsRequest(id, version));
    const head = await client.readExact(10, 3000, 'response (message_size + correlation_id + error_code)');
    expectEq('correlation_id', head.readInt32BE(4), id);
    expectEq('error_code', head.readInt16BE(8), 35);
    t.log.success('✓ error_code is 35 (UNSUPPORTED_VERSION)');
  },
  async pv1(t) {
    const { client } = await start(t);
    await apiVersions(t, client);
  },
  async nh4(t) {
    const { client } = await start(t);
    for (let i = 0; i < randInt(2, 4); i++) await apiVersions(t, client);
  },
  async sk0(t) {
    const { proc } = await start(t);
    const clients = [];
    for (let i = 0; i < randInt(2, 3); i++) clients.push(await connect(t, proc, `client-${i + 1}`));
    for (let round = 0; round < 2; round++) for (const c of [...clients].reverse()) await apiVersions(t, c);
  },
  async yk1(t) {
    const { client } = await start(t);
    await apiVersions(t, client, { min: { 75: [0, 0] } });
  },
  async vt6(t) {
    const { client } = await start(t, { cluster: [makeTopic(1)] });
    const name = `unknown-topic-${word()}`;
    const res = await describe(t, client, [name]);
    expectEq('number of topics', res.topics.length, 1);
    const [topic] = res.topics;
    expectEq('error_code', topic.errorCode, 3);
    expectEq('topic_name', topic.name, name);
    expectEq('topic_id', topic.id, '00000000-0000-0000-0000-000000000000');
    expectEq('number of partitions', topic.partitions.length, 0);
    t.log.success('✓ Unknown topic response is correct');
  },
  async ea7(t) {
    const cluster = [makeTopic(1), makeTopic(2)];
    const { client } = await start(t, { cluster });
    const res = await describe(t, client, [cluster[0].name]);
    expectEq('number of topics', res.topics.length, 1);
    checkTopic(t, res.topics[0], cluster[0]);
  },
  async ku4(t) {
    const cluster = [makeTopic(1), makeTopic(2)];
    const { client } = await start(t, { cluster });
    const res = await describe(t, client, [cluster[1].name]);
    expectEq('number of topics', res.topics.length, 1);
    checkTopic(t, res.topics[0], cluster[1]);
  },
  async wq2(t) {
    const cluster = [makeTopic(randInt(1, 2)), makeTopic(randInt(1, 2)), makeTopic(1)];
    const { client } = await start(t, { cluster });
    const wanted = shuffle(cluster.slice(0, 2));
    const res = await describe(t, client, wanted.map(x => x.name));
    expectEq('number of topics', res.topics.length, 2);
    const sorted = [...wanted].sort((a, b) => (a.name < b.name ? -1 : 1));
    res.topics.forEach((topic, i) => checkTopic(t, topic, sorted[i]));
  },
  async gs0(t) {
    const { client } = await start(t);
    await apiVersions(t, client, { min: { 1: [0, 16] } });
  },
  async dh6(t) {
    const { client } = await start(t);
    const res = await fetch(t, client, []);
    expectEq('number of responses', res.responses.length, 0);
    t.log.success('✓ Fetch response is correct');
  },
  async hn6(t) {
    const { client } = await start(t, { cluster: [makeTopic(1)] });
    const unknown = newUuid();
    const res = await fetch(t, client, [{ id: unknown, partitions: [0] }]);
    expectEq('number of responses', res.responses.length, 1);
    expectEq('topic_id', res.responses[0].topicId, unknown);
    expectEq('number of partitions', res.responses[0].partitions.length, 1);
    expectEq('partition_index', res.responses[0].partitions[0].index, 0);
    expectEq('partition error_code', res.responses[0].partitions[0].errorCode, 100);
    t.log.success('✓ error_code is 100 (UNKNOWN_TOPIC_ID)');
  },
  async cm4(t) { await fetchStage(t, []); },
  async eg2(t) { await fetchStage(t, [`Hello ${word()}!`]); },
  async fd8(t) { await fetchStage(t, words(randInt(2, 4)).map(w => `Hello ${w}!`)); },
  async xz1(t) {
    const { client } = await start(t);
    await apiVersions(t, client, { min: { 0: [0, 11] } });
  },
  async zf2(t) {
    const topic = makeTopic(1);
    const { client } = await start(t, { cluster: [topic] });
    for (const target of [{ name: topic.name, index: randInt(2, 9) }, { name: `unknown-${word()}`, index: 0 }]) {
      const topics = [{ name: target.name, partitions: [{ index: target.index, records: recordBatch({ values: [word()] }) }] }];
      checkProduced(t, await produce(t, client, topics), topics, { error: 3 });
    }
  },
  async gg1(t) {
    const topic = makeTopic(1);
    const { client } = await start(t, { cluster: [topic] });
    const topics = [{ name: topic.name, partitions: [{ index: 0, records: recordBatch({ values: [word()] }) }] }];
    checkProduced(t, await produce(t, client, topics), topics);
  },
  async ls8(t) { await produceStage(t, [[1, 1]]); },
  async yd8(t) { await produceStage(t, [[1, randInt(2, 4)]]); },
  async ct4(t) { await produceStage(t, [[2, 1]]); },
  async ov0(t) { await produceStage(t, [[2, 1], [2, 1]]); },
};

export const beforeStage = () => ensurePortFree(PORT);
