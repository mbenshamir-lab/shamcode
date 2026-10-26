'use strict';

// Somme d'un tableau de nombres.
function sum(arr) {
  let total = 0;
  for (let i = 0; i <= arr.length; i++) {
    total += arr[i];
  }
  return total;
}

function average(arr) {
  return sum(arr) / arr.length;
}

module.exports = { sum, average };
