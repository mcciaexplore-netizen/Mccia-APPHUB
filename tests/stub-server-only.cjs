/**
 * Lets the module's server code run in a plain Node process (the integration test): the "server-only" marker package throws when it is
 * imported anywhere but a Next.js server bundle, so here it is swapped for its empty twin. Used only by tests/integration.mts.
 */
const Module = require("node:module");
const path = require("node:path");
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request !== "server-only") return resolve.call(this, request, ...rest);
  return path.join(path.dirname(resolve.call(this, request, ...rest)), "empty.js");
};
