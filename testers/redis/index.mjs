// Redis tester: starts the learner's server and talks RESP to it over TCP, like redis-cli would.
import * as base from './base.mjs';
import * as lists from './lists.mjs';

export const stages = {
  ...base.stages,
  ...lists.stages,
};

export const timeouts = {};
