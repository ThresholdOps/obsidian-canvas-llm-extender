import assert from "node:assert/strict";
import { serverEndpoint, suggestBranches } from "../../src/local-qwen.ts";

const baseUrl=process.argv[2];
const settings={baseUrl,mode:"server",model:"demo",credential:{name:"test-key",endpoint:serverEndpoint(baseUrl).href}};
const getSecret=name=>{
    assert.equal(name,"test-key");
    return process.env.CANVAS_TEST_TOKEN;
};
const send=code=>suggestBranches(settings,String(code),["Wybrana karta"],new AbortController().signal,getSecret);
assert.deepEqual(await send(200),["Trasa","Nocleg","Bagaż"]);
for(const code of [401,403,404,307]) {
    await assert.rejects(send(code),error=>{
        assert.match(error.message,new RegExp(String(code)));
        assert.equal(error.message.includes("internal-body"),false);
        assert.equal(error.message.includes(process.env.CANVAS_TEST_TOKEN),false);
        return true;
    });
}
