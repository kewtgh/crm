"use strict";

/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS is the compatibility contract. */
const secured = require("brace-expansion-secure");

function expand(pattern) {
  return secured.expand(pattern);
}

Object.assign(expand, secured);
module.exports = expand;
