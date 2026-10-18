import assert from "node:assert/strict";
import test from "node:test";
import {
  E5_DIMENSIONS, LSH_BANDS, LSH_BITS, mindLshBands, mindLshProbes,
} from "../src/domains/runtime/mind/claude-code-semantic-lsh.js";
const vector = Array.from({length:E5_DIMENSIONS},(_,i)=>
  Math.sin(i*0.097)+0.31*Math.cos(i*0.41));

test("semantic LSH is deterministic across calls and has all indexed bands",()=>{
  const one=mindLshBands(vector);
  assert.deepEqual(one,mindLshBands([...vector]));
  assert.equal(one.length,LSH_BANDS);
  assert.ok(one.every(x=>Number.isInteger(x)&&x>=0&&x<(1<<LSH_BITS)));
  assert.ok(new Set(one).size>5);
});

test("one-bit multiprobe includes each exact bucket and all its neighboring buckets",()=>{
  const bands=mindLshBands(vector);
  const probes=mindLshProbes(vector);
  assert.equal(probes.length,LSH_BANDS*(LSH_BITS+1));
  for(let band=0;band<LSH_BANDS;band++){
    const own=probes.filter(p=>p.band===band);
    assert.equal(new Set(own.map(p=>p.bucket)).size,LSH_BITS+1);
    assert.equal(own[0]!.bucket,bands[band]);
    for(let bit=0;bit<LSH_BITS;bit++)
      assert.ok(own.some(p=>p.bucket===(bands[band]!^(1<<bit))));
  }
});

test("nearby 384-dimensional embeddings share semantic index buckets",()=>{
  const nearby=vector.map((v,i)=>v+0.004*Math.sin(i));
  const original=new Set(mindLshProbes(vector).map(p=>`${p.band}:${p.bucket}`));
  const target=mindLshBands(nearby);
  assert.ok(target.some((bucket,band)=>original.has(`${band}:${bucket}`)));
});

test("rejects dimension mismatch, nonfinite and zero embeddings",()=>{
  assert.throws(()=>mindLshBands([]),/Invalid/);
  assert.throws(()=>mindLshBands(Array(384).fill(0)),/Invalid/);
  assert.throws(()=>mindLshBands([...vector.slice(0,383),Number.NaN]),/Invalid/);
});
