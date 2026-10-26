'use strict';

function slugify(text) {
  return text.trim().toLowerCase().replace(/\s+/g, '-');
}

module.exports = { slugify };
