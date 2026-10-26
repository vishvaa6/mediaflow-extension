import assert from 'node:assert/strict';
const listeners=new Set();
const onChanged={addListener(){},removeListener(){}};
const data={};
const local={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>data[key]!==undefined).map(key=>[key,data[key]])),set:async patch=>Object.assign(data,patch),onChanged};
globalThis.chrome={runtime:{id:'smoke-test',onMessage:{addListener:fn=>listeners.add(fn)},sendMessage:async()=>{}},storage:{local,onChanged},downloads:{onChanged,search:async()=>[]},offscreen:{hasDocument:async()=>false}};
globalThis.self=globalThis;
await import('../src/pages/background/index.js');
await new Promise(resolve=>setTimeout(resolve,50));
assert.equal(listeners.size,1,'exactly one coordinator must handle queue commands');
const snapshot=await new Promise(resolve=>{
  for(const listener of listeners)listener({type:'download-queue-snapshot'},{id:'smoke-test'},resolve);
});
assert.equal(snapshot.success,true);assert.deepEqual(snapshot.state.tasks,[]);
console.log('PASS: bundled background imports and initializes the queue coordinator; snapshot responds.');
