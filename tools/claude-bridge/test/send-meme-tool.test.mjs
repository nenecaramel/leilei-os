import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { createMemeMcpServer } from "../src/send-meme-mcp.mjs";

const sdk={tool(name,description,shape,callback){return {name,description,async call(input){return callback(z.object(shape).strict().parse(input));}};},createSdkMcpServer(input){return input;}};

test("local meme tool exposes only send_meme and passes an exact existing id",async()=>{
  let observed;
  const server=await createMemeMcpServer({async sendMeme(input){observed=input;return {attachmentId:"attachment",filename:"meme_0001.webp",mimeType:"image/webp",kind:"image",rawUrl:"PRIVATE",data:"BASE64"};}},sdk);
  assert.equal(server.name,"leileios-local-memes");
  assert.deepEqual(server.tools.map(tool=>tool.name),["send_meme"]);
  const result=await server.tools[0].call({meme_id:"meme_0001"});
  assert.deepEqual(observed,{memeId:"meme_0001"});
  assert.equal(result.isError,undefined);
  assert.equal(JSON.stringify(result).includes("PRIVATE"),false);
  assert.equal(JSON.stringify(result).includes("BASE64"),false);
  assert.deepEqual(JSON.parse(result.content[0].text),{attachment_id:"attachment",filename:"meme_0001.webp",kind:"image"});
  for(const input of [{meme_id:"meme_1"},{meme_id:"../meme_0001"},{meme_id:"meme_0001\n"},{meme_id:"meme_0001",repo:"arbitrary"},{meme_id:"meme_0001",path:"arbitrary"}])await assert.rejects(server.tools[0].call(input));
});

test("meme handler stage errors become safe actionable MCP isError messages",async()=>{
  const expected=new Map([
    ["MEME_GH_UNAVAILABLE","GitHub CLI is unavailable"],
    ["MEME_NOT_FOUND","not found"],
    ["MEME_GITHUB_FETCH_FAILED","GitHub fetch failed"],
    ["MEME_SOURCE_INVALID","invalid meme image bytes"],
    ["MEME_ATTACHMENT_FAILED","attachment upload or completion failed"],
  ]);
  for(const [code,fragment] of expected){
    const server=await createMemeMcpServer({async sendMeme(){throw Object.assign(new Error("TOKEN /credential/path"),{code});}},sdk);
    const result=await server.tools[0].call({meme_id:"meme_0001"});
    assert.equal(result.isError,true);
    assert.match(result.content[0].text,new RegExp(code));
    assert.match(result.content[0].text,new RegExp(fragment,"i"));
    assert.equal(JSON.stringify(result).includes("TOKEN"),false);
    assert.equal(JSON.stringify(result).includes("credential/path"),false);
  }
});

test("unknown meme handler errors stay generic and secret-free",async()=>{
  const server=await createMemeMcpServer({async sendMeme(){throw new Error("TOKEN /credential/path");}},sdk);
  const result=await server.tools[0].call({meme_id:"meme_0001"});
  assert.equal(result.isError,true);
  assert.match(result.content[0].text,/MEME_UNKNOWN/);
  assert.equal(JSON.stringify(result).includes("TOKEN"),false);
  assert.equal(JSON.stringify(result).includes("credential/path"),false);
});
