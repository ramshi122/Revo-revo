'use strict';
const assert = require('node:assert/strict');
const W = require('../public/wheel-direction.js');

assert.equal(W.WHEEL_ORDER.length, 54, 'Crazy Time wheel has 54 pockets');
assert.deepEqual(W.WHEEL_ORDER.reduce((counts, value) => {
  counts[value] = (counts[value] || 0) + 1;
  return counts;
}, {}), {
  '1':21, '2':13, '5':7, '10':4,
  'Coin Flip':4, 'Cash Hunt':2, 'Pachinko':2, 'Crazy Time':1
});

assert.deepEqual(W.getNextFivePockets(0, 'clockwise').map(x => x.index), [53,52,51,50,49]);
assert.deepEqual(W.getNextFivePockets(0, 'counterclockwise').map(x => x.index), [1,2,3,4,5]);
assert.deepEqual(W.getNextFivePockets(53, 'counterclockwise').map(x => x.index), [0,1,2,3,4]);
assert.equal(W.getNextFivePockets(-1, 'clockwise').length, 0);
assert.equal(W.getNextFivePockets(54, 'clockwise').length, 0);
assert.equal(W.getNextFivePockets(2, 'left').length, 0);

assert.equal(W.normalizeOutcome({result:'Coin Flip'}), 'Coin Flip');
assert.equal(W.normalizeOutcome('CrazyBonus'), 'Crazy Time');
assert.equal(W.normalizeOutcome('Pachinko'), 'Pachinko');
assert.equal(W.normalizeOutcome('unknown-result'), null);
assert.equal(W.evaluateOutcome(['1','2','5','10','Coin Flip'], 'coin flip'), 'HIT');
assert.equal(W.evaluateOutcome(['1','2','5','10','Coin Flip'], 'Cash Hunt'), 'MISS');
assert.equal(W.evaluateOutcome([], '1'), 'INVALID');
assert.equal(W.evaluateOutcome(['1','2'], '1'), 'INVALID');

const candidates = W.getNextFivePockets(0, 'clockwise');
assert.equal(W.expectedHitProbability(candidates), 1, 'all distinct outcomes on this test window are represented in this fixture');
const baselineSet = ['1','2','5'];
assert.equal(W.expectedHitProbability(baselineSet), 41/54);

const records = [
  {roundId:'r1',actualResult:'1',status:'HIT',direction:'clockwise',expectedProbability:0.5},
  {roundId:'r2',actualResult:'Cash Hunt',status:'MISS',direction:'counterclockwise',expectedProbability:0.2},
  {roundId:'r3',actualResult:'2',status:'INVALID',direction:null,expectedProbability:null},
  {roundId:null,actualResult:null,status:'INVALID',direction:null,expectedProbability:null}
];
const stats = W.computeStats(records);
assert.equal(stats.valid, 2);
assert.equal(stats.hits, 1);
assert.equal(stats.misses, 1);
assert.equal(stats.invalid, 1);
assert.equal(stats.hitRate, 0.5);
assert.equal(stats.baseline, 0.35);
assert.equal(stats.clockwise.total, 1);
assert.equal(stats.counterclockwise.total, 1);

function makeSignature() {
  const n = 360, channels = 9, a = new Uint8Array(n * channels);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels; c++) {
      a[i * channels + c] = (Math.sin(i * 0.13 + c * 1.7) * 0.5 + 0.5) * 255 | 0;
    }
  }
  return a;
}
function rotateSignature(source, bins) {
  const n = 360, channels = 9, out = new Uint8Array(source.length);
  for (let i = 0; i < n; i++) {
    const oldIndex = ((i - bins) % n + n) % n;
    for (let c = 0; c < channels; c++) out[i * channels + c] = source[oldIndex * channels + c];
  }
  return out;
}
const sig = makeSignature();
const motion = W.compareSignatures(sig, rotateSignature(sig, 5), 20);
assert.ok(motion);
assert.equal(motion.shiftBins, 5);
assert.ok(W.compareSignatures(sig, sig, 20).shiftBins === 0);
assert.equal(W.compareSignatures(null, sig, 20), null);

console.log('Wheel direction analysis tests passed.');
