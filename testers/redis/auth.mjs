import { createHash } from 'node:crypto';
import { R, show } from '../../lib/protocols/resp.mjs';
import { word, randInt } from '../../lib/harness/random.mjs';
import { startServer } from './base.mjs';
import { RedisClient } from './client.mjs';

const sha256 = s => createHash('sha256').update(s).digest('hex');
const password = () => `${word()}${randInt(100, 999)}`;

// Reads ACL GETUSER default as { flags: [...], passwords: [...] | undefined, raw }.
async function getUser(t, client) {
  const reply = await client.command('ACL', 'GETUSER', 'default');
  if (reply.type !== 'array' || !reply.value || reply.value.length < 2 || reply.value.length % 2) t.fail(`Expected ACL GETUSER to return a RESP array of property/value pairs, got ${show(reply)}`);
  const props = {};
  for (let i = 0; i < reply.value.length; i += 2) {
    const name = reply.value[i].value, val = reply.value[i + 1];
    props[name] = val.type === 'array' && val.value ? val.value.map(x => x.value) : val;
  }
  if (!Array.isArray(props.flags)) t.fail(`Expected the first property to be "flags" with an array value, got ${show(reply)}`);
  return { ...props, raw: reply };
}

async function expectNoAuth(t, client, cmd) {
  const reply = await client.command(...cmd);
  if (reply.type !== 'error' || !reply.value.startsWith('NOAUTH')) t.fail(`Expected an error starting with "NOAUTH", got ${show(reply)}`);
  t.log.success(`${client.label()}✔︎ Received ${show(reply)}`);
}

export const stages = {
  async jn4(t) {
    const { client } = await startServer(t);
    await client.check(['ACL', 'WHOAMI'], R.bulk('default'));
  },

  async gx8(t) {
    const { client } = await startServer(t);
    const user = await getUser(t, client);
    t.log.success(`✔︎ Received ${show(user.raw)}`);
  },

  async ql6(t) {
    const { client } = await startServer(t);
    const user = await getUser(t, client);
    if (JSON.stringify(user.flags) !== '["nopass"]') t.fail(`Expected flags to be ["nopass"], got ${show(user.raw)}`);
    t.log.success(`✔︎ Received ${show(user.raw)}`);
  },

  async pl7(t) {
    const { client } = await startServer(t);
    await client.check(['ACL', 'GETUSER', 'default'], R.array(['flags', R.array(['nopass']), 'passwords', R.array([])]));
  },

  async uv9(t) {
    const { client } = await startServer(t);
    await client.check(['ACL', 'GETUSER', 'default'], R.array(['flags', R.array(['nopass']), 'passwords', R.array([])]));
    const pw = password();
    await client.check(['ACL', 'SETUSER', 'default', `>${pw}`], R.simple('OK'));
    const user = await getUser(t, client);
    if (user.flags.includes('nopass')) t.fail(`Expected the nopass flag to be removed, got ${show(user.raw)}`);
    if (JSON.stringify(user.passwords) !== JSON.stringify([sha256(pw)])) t.fail(`Expected passwords to be ["${sha256(pw)}"] (SHA-256 of "${pw}"), got ${show(user.raw)}`);
    t.log.success(`✔︎ Received ${show(user.raw)}`);
  },

  async hz3(t) {
    const { client } = await startServer(t);
    const pw = password();
    await client.check(['ACL', 'SETUSER', 'default', `>${pw}`], R.simple('OK'));
    await client.check(['AUTH', 'default', `wrong${pw}`], R.error('WRONGPASS'));
    await client.check(['AUTH', 'default', pw], R.simple('OK'));
  },

  async nm2(t) {
    const { client: c1 } = await startServer(t, [], { names: ['client-1'] });
    const pw = password();
    await c1.check(['ACL', 'SETUSER', 'default', `>${pw}`], R.simple('OK'));
    await c1.check(['ACL', 'WHOAMI'], R.bulk('default'));
    const c2 = await RedisClient.connect(t, { name: 'client-2' });
    await expectNoAuth(t, c2, ['ACL', 'WHOAMI']);
    await c1.check(['PING'], R.simple('PONG'));
  },

  async ws7(t) {
    const { client } = await startServer(t, [], { names: ['client-1'] });
    const pw = password();
    await client.check(['ACL', 'SETUSER', 'default', `>${pw}`], R.simple('OK'));
    await client.check(['ACL', 'WHOAMI'], R.bulk('default'));
    const c2 = await RedisClient.connect(t, { name: 'client-2' });
    await expectNoAuth(t, c2, ['PING']);
    await expectNoAuth(t, c2, ['SET', word(), word()]);
    await c2.check(['AUTH', 'default', pw], R.simple('OK'));
    await c2.check(['PING'], R.simple('PONG'));
    await c2.check(['ACL', 'WHOAMI'], R.bulk('default'));
  },
};
