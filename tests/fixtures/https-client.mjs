import assert from "node:assert/strict";
import { serverEndpoint, suggestBranches, testChat } from "../../src/local-qwen.ts";

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

const checkChat = (model, extra = {}) => testChat({...settings,model,...extra},new AbortController().signal,getSecret);
await checkChat("chat-ok");
for (const [model, expected] of [
    ["missing-model", /404 · JSON.*model/],
    ["key-error", /404 · JSON.*klucz/],
    ["unknown-resource", /404 · JSON/],
    ["proxy-page", /404 · HTML/],
    ["long-error", /404.*przyczyny/],
    ["unexpected-200", /200.*bez wiadomości/],
    ["redirect-chat", /307/],
]) {
    await assert.rejects(checkChat(model), error => {
        assert.match(error.message, expected);
        assert.equal(error.message.includes(process.env.CANVAS_TEST_TOKEN), false);
        return true;
    });
}
await assert.rejects(checkChat("invalid",{mode:"local"}), /tryb serwera/);
await assert.rejects(checkChat("invalid",{credential:null}), /wybierz klucz/);

const ask = (streamBranches, onStreamData) => suggestBranches({...settings,streamBranches},
    "Próba dwóch formatów",["Sąsiad"],new AbortController().signal,getSecret,onStreamData);
await assert.rejects(ask(false),error=>/HTTP 502 po \d+ s/.test(error.message) &&
    !error.message.includes(process.env.CANVAS_TEST_TOKEN) && !error.message.includes("adres"));
let starts=0;
assert.deepEqual(await ask(true,()=>{starts++;}),["Trasa","Łódź","Bagaż"]);
assert.equal(starts,1);
