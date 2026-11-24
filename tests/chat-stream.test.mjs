import { test } from "node:test";
import assert from "node:assert/strict";
import { readChatStream } from "../src/chat-stream.ts";

const frame = (delta, finish_reason = null) => JSON.stringify({choices:[{index:0,delta,finish_reason}]});
const event = value => "data: " + value + "\n\n";
const stop = event(frame({}, "stop"));
const end = event("[DONE]");
const read = (wire, limit=1000) => readChatStream([Buffer.from(wire)], limit);

test("SSE joins only answer content across split UTF-8, CRLF, comments, multiline data and usage", async () => {
    const wire="\uFEFF: ping\r\n\r\n"+
        event(frame({role:"assistant",content:"",reasoning_content:"private-test"})).replaceAll("\n","\r\n")+
        'id: 1\rdata: {"choices":\rdata: [{"index":0,"delta":{"content":"Łódź"}}]}\r\r'+
        event(JSON.stringify({choices:[{index:1,delta:{content:"skip"}},{index:0,delta:{content:" i góry"}}]}))+
        stop+event(JSON.stringify({choices:[],usage:{}}))+end;
    let starts=0;
    const bytes=[...Buffer.from(wire)].map(value=>Uint8Array.of(value));
    assert.equal(await readChatStream(bytes,100,()=>{starts++;}), "Łódź i góry");
    assert.equal(starts,1);
});

test("SSE accepts an explicit finish and rejects partial or errored answers without exposing provider data", async () => {
    const reply=event(frame({content:"complete text"}));
    assert.equal(await read(reply+end), "complete text");
    assert.equal(await read(reply+stop), "complete text");
    for (const wire of [reply, end, stop, reply+"data: [DONE]",reply+stop+"data: truncated", reply+event(frame({},"length"))+end,
        reply+"event: error\ndata: private-test\n\n", reply+event(JSON.stringify({error:{message:"private-test"}})),
        reply+event("private-test"), reply+event(frame({content:["private-test"]}))+end]) {
        await assert.rejects(read(wire),error=>!error.message.includes("private-test"));
    }
    await assert.rejects(readChatStream([Uint8Array.of(255)],100),/niepoprawne|Przerwano/);
    await assert.rejects(read(reply+end,3),/rozmiar/);
    await assert.rejects(read("data: "+"x".repeat(270000)),/za duży/);
});
