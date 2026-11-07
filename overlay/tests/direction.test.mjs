import test from 'node:test';import assert from 'node:assert/strict';
import {resolveRunDirection,runPosition,dustTrail,scatterTarget} from '../engine.js';
test('ltr/rtl config and backwards compatible aliases',()=>{
  for(const mode of ['ltr','left-to-right'])assert.equal(resolveRunDirection(mode,-1),1);
  for(const mode of ['rtl','right-to-left'])assert.equal(resolveRunDirection(mode,1),-1);
});
test('alternate starts LTR then switches from the last actual run',()=>{
  assert.equal(resolveRunDirection('alternate',null),1);
  assert.equal(resolveRunDirection('alternate',1),-1);
  assert.equal(resolveRunDirection('alternate',-1),1);
  assert.equal(resolveRunDirection('unknown',1),-1);
});
test('forced L/R override once; next E continues configured alternation',()=>{
  const forced=resolveRunDirection('alternate',1,.1,'ltr');assert.equal(forced,1);
  assert.equal(resolveRunDirection('alternate',forced),-1);
  const forcedR=resolveRunDirection('ltr',1,.1,'rtl');assert.equal(forcedR,-1);
  assert.equal(resolveRunDirection('ltr',forcedR),1);
});
test('random uses the supplied RNG roll on either side of .5',()=>{
  assert.equal(resolveRunDirection('random',null,0),1);
  assert.equal(resolveRunDirection('random',null,.499),1);
  assert.equal(resolveRunDirection('random',null,.5),-1);
  assert.equal(resolveRunDirection('random',null,.999),-1);
});
test('RTL positions are a true horizontal mirror, entering right and leaving left',()=>{
  for(const t of [0,.1,.25,.5,.9,1])assert.equal(runPosition(t,-1),1920-runPosition(t,1));
  assert(runPosition(0,-1)>1920);assert(runPosition(1,-1)<0);
  assert(runPosition(.4,-1)>runPosition(.6,-1));
});
test('dust always emits and drifts behind troop in both directions',()=>{
  for(const d of [1,-1]){const p=dustTrail(d,42);assert(p.offsetX*d<0);assert(p.vx*d<0);}
  assert.deepEqual(dustTrail(-1,42),{offsetX:30,vx:42});
});
test('murlocs flee away from the arriving corner',()=>{
  assert(scatterTarget(1)>1920);assert(scatterTarget(-1)<0);
});
