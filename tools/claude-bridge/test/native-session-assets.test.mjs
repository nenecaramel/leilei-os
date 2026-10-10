import assert from 'node:assert/strict';
import test from 'node:test';
import { projectNativeHistory } from '../src/native-session-history.mjs';
const S='00000000-0000-4000-8000-000000000001', U='00000000-0000-4000-8000-000000000002', A='00000000-0000-4000-8000-000000000003', ID='00000000-0000-4000-8000-000000000004';
function fixture() {
  const nativeSnapshot={sessionId:S,revision:'a'.repeat(64),entries:[{type:'user',uuid:U,parentUuid:null,message:{content:[{type:'image',source:{type:'base64',media_type:'image/png',data:Buffer.from('synthetic image').toString('base64')}}]}},{type:'assistant',uuid:A,parentUuid:U,message:{content:'reply'}}]};
  return {nativeSnapshot,projection:projectNativeHistory(nativeSnapshot,A)};
}
test('native image materialization uses ordinary upload/complete, verifies metadata, binds once and sends no native text', async()=>{
  const {materializeNativeSessionHistoryAssets}=await import('../src/native-session-assets.mjs');
  const history=fixture(), calls=[]; let bound=false;
  const metadata={filename:'native.png',mimeType:'image/png',sizeBytes:15,sha256:'',kind:'image',attachmentId:null};
  const {createHash}=await import('node:crypto');metadata.sha256=createHash('sha256').update('synthetic image').digest('hex');
  const request=async(route,body)=>{
    calls.push(route);assert.doesNotMatch(JSON.stringify(body),/synthetic image|reply/);
    if(route==='asset') {if(body.attachmentId) bound=true;return {...metadata,attachmentId:bound?ID:null};}
    if(route==='attachment-upload-slot')return {attachment:{attachmentId:ID},upload:{url:'https://bucket.invalid/signed',method:'PUT',headers:{'content-type':'image/png','x-amz-meta-sha256':metadata.sha256}}};
    return {attachment:{attachmentId:ID,sha256:metadata.sha256,sizeBytes:15,mimeType:'image/png',status:'ready'}};
  };
  const uploadImpl=async(url,options)=>{assert.equal(url,'https://bucket.invalid/signed');assert.equal(options.headers.Authorization,undefined);assert.equal(Buffer.from(options.body).toString(),'synthetic image');return new Response(null,{status:200});};
  assert.deepEqual(await materializeNativeSessionHistoryAssets({history,conversationId:S,request,uploadImpl}),{materialized:1,unavailable:0});
  assert.deepEqual(calls,['asset','attachment-upload-slot','attachment-complete/'+ID,'asset']);
  calls.length=0;
  assert.deepEqual(await materializeNativeSessionHistoryAssets({history,conversationId:S,request,uploadImpl}),{materialized:1,unavailable:0});
  assert.deepEqual(calls,['asset']);
});
test('bad source metadata and upload failure never complete or bind; external sources are not fetched',async()=>{
  const {materializeNativeSessionHistoryAssets}=await import('../src/native-session-assets.mjs');
  const history=fixture(), calls=[];
  await assert.rejects(materializeNativeSessionHistoryAssets({history,conversationId:S,request:async route=>{calls.push(route);return {attachmentId:null,mimeType:'image/png',sizeBytes:14,sha256:'0'.repeat(64),kind:'image',filename:'n.png'};}}),{code:'NATIVE_ASSET_MISMATCH'});
  assert.deepEqual(calls,['asset']);
  calls.length=0;
  await assert.rejects(materializeNativeSessionHistoryAssets({history,conversationId:S,
    request:async route=>{
      calls.push(route);
      if(route==='asset')return {attachmentId:null,mimeType:'image/png',sizeBytes:15,sha256:'0'.repeat(64),kind:'image',filename:'n.png'};
      assert.fail('mismatched source must not request upload');
    }}),{code:'NATIVE_ASSET_MISMATCH'});
  const {createHash}=await import('node:crypto');
  const sha256=createHash('sha256').update('synthetic image').digest('hex');
  calls.length=0;
  let uploadCalls=0;
  await assert.rejects(materializeNativeSessionHistoryAssets({history,conversationId:S,
    request:async route=>{
      calls.push(route);
      if(route==='asset')return {attachmentId:null,mimeType:'image/png',sizeBytes:15,sha256,kind:'image',filename:'n.png'};
      if(route==='attachment-upload-slot')return {attachment:{attachmentId:ID},upload:{url:'https://bucket.invalid/signed',method:'PUT',headers:{'content-type':'image/png','x-leileios-sha256':sha256}}};
      assert.fail('failed upload must not complete or bind');
    },uploadImpl:async()=>{uploadCalls++;return new Response(null,{status:503});}}),{code:'NATIVE_ASSET_UPLOAD_FAILED'});
  assert.deepEqual(calls,['asset','attachment-upload-slot']);
  assert.equal(uploadCalls,1,'existing inline transfer header is supported too');
  history.projection.messages[0].blocks[0].payload.source_type='url';
  assert.deepEqual(await materializeNativeSessionHistoryAssets({history,conversationId:S,request:async()=>assert.fail('URL must not be fetched')}),{materialized:0,unavailable:1});
});
