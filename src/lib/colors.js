'use strict';
// Swatch colours for variant names. Unknown names fall back to a neutral grey.
const { COLORS } = require('../../scripts/renders');

function swatch(name) {
  const c = COLORS[name];
  return c ? c.body : '#c9ccd1';
}
module.exports = { swatch };
