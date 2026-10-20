// Redis tester: starts the learner's server and talks RESP to it over TCP, like redis-cli would.
import * as base from './base.mjs';
import * as lists from './lists.mjs';
import * as streams from './streams.mjs';
import * as transactions from './transactions.mjs';
import * as locking from './optimistic-locking.mjs';
import * as replication from './replication.mjs';
import * as rdb from './rdb.mjs';
import * as aof from './aof.mjs';
import * as pubsub from './pubsub.mjs';
import * as sortedSets from './sorted-sets.mjs';
import * as bitmaps from './bitmaps.mjs';
import * as geospatial from './geospatial.mjs';
import * as auth from './auth.mjs';

export const stages = {
  ...base.stages,
  ...lists.stages,
  ...streams.stages,
  ...transactions.stages,
  ...locking.stages,
  ...replication.stages,
  ...rdb.stages,
  ...aof.stages,
  ...pubsub.stages,
  ...sortedSets.stages,
  ...bitmaps.stages,
  ...geospatial.stages,
  ...auth.stages,
};

export const timeouts = { tu8: 30000, na2: 30000, hd5: 30000 };
