'use strict';

function formatMoney(value, currency = '€') {
  return `${Number(value).toFixed(2)} ${currency}`;
}

function padLabel(label, width = 20) {
  return label.length >= width ? label.slice(0, width) : label.padEnd(width, '.');
}

module.exports = { formatMoney, padLabel };
