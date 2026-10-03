'use strict';

const MAX_NESTING = 128;
// A parsed tree also contains the root and leaf text/open/close nodes.
const MAX_WALK_DEPTH = MAX_NESTING + 1;

const assertDepth = (depth, maximum = MAX_NESTING) => {
  if (depth > maximum) {
    throw new SyntaxError(`Brace pattern nesting exceeds the maximum depth (${MAX_NESTING})`);
  }
};

module.exports = { assertDepth, MAX_WALK_DEPTH };
