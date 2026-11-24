import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:https";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serverEndpoint, suggestBranches } from "../src/local-qwen.ts";

const exec = promisify(execFile);
const hasOpenSSL = spawnSync("openssl", ["version"], {stdio:"ignore"}).status === 0;

test("trusted HTTPS receives one Bearer request per click; untrusted TLS, redirects and error bodies stay contained",
    {skip:hasOpenSSL ? false : "OpenSSL is needed to create an ephemeral test certificate"}, async t => {
        const dir = await mkdtemp(join(tmpdir(),"canvas-qwen-tls-"));
        t.after(() => rm(dir,{force:true,recursive:true}));
        const cert = join(dir,"cert.pem"), key = join(dir,"key.pem");
        await exec("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN=localhost",
            "-addext","subjectAltName=IP:127.0.0.1,DNS:localhost","-keyout",key,"-out",cert]);
        const token = randomUUID();
        const calls=[];
        const chatTests=[];
        const server=createServer({cert:await readFile(cert),key:await readFile(key)},async(req,res)=>{
            let body="";
            for await(const chunk of req) body+=chunk;
            const payload=JSON.parse(body);
            if (payload.messages.length === 1) {
                chatTests.push(payload.model);
                assert.equal(req.method,"POST");
                assert.equal(req.url,"/gateway/v1/chat/completions");
                assert.equal(req.headers.authorization,`Bearer ${token}`);
                assert.deepEqual(payload,{model:payload.model,messages:[{role:"user",content:"Odpowiedz tylko OK."}],stream:false});
                const errors={
                    "missing-model":[404,"application/json",JSON.stringify({error:{code:"model_not_found",message:token}})],
                    "key-error":[404,"application/json",JSON.stringify({code:"invalid_api_key",message:token})],
                    "unknown-resource":[404,"application/json",JSON.stringify({detail:token})],
                    "proxy-page":[404,"text/html","<html>"+token+"</html>"],
                    "long-error":[404,"text/plain",token.repeat(1000)],
                    "unexpected-200":[200,"text/html","<html>"+token+"</html>"],
                    "redirect-chat":[307,"text/plain",token],
                };
                const [status,contentType,answer]=errors[payload.model] ??
                    [200,"application/json",JSON.stringify({choices:[{message:{role:"assistant",content:"OK"}}]})];
                if (status === 307) res.setHeader("Location","/redirect-target");
                res.writeHead(status,{"Content-Type":contentType});
                res.end(answer);
                return;
            }
            const data=JSON.parse(payload.messages[1].content);
            calls.push({ path:req.url, method:req.method, authorized:req.headers.authorization===`Bearer ${token}`, data,
                model:payload.model, hasSchema:Object.hasOwn(payload,"response_format") });
            const status=Number(data.karta);
            if (status === 307) res.setHeader("Location","/redirect-target");
            res.writeHead(status,{"Content-Type":"application/json"});
            const reply = {choices:[{message:{content:'{"branches":["Trasa","Nocleg","Bagaż"]}'}}]};
            res.end(status===200 ? JSON.stringify(reply) : "internal-body-"+token);
        });
        server.listen(0,"127.0.0.1");
        await once(server,"listening");
        t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
        const baseUrl=`https://127.0.0.1:${server.address().port}/gateway/v1`;
        const settings={baseUrl,model:"demo",mode:"server",credential:{name:"test-key",endpoint:serverEndpoint(baseUrl).href}};
        await assert.rejects(suggestBranches(settings,"200",[],new AbortController().signal,()=>token),/TLS/);
        assert.deepEqual(calls,[]);

        await exec(process.execPath,["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
            fileURLToPath(new URL("./fixtures/https-client.mjs",import.meta.url)),baseUrl],{
            env:{...process.env,NODE_EXTRA_CA_CERTS:cert,CANVAS_TEST_TOKEN:token},
        });
        assert.deepEqual(calls.map(c=>c.data.karta),["200","401","403","404","307"]);
        assert.deepEqual(chatTests,["chat-ok","missing-model","key-error","unknown-resource","proxy-page","long-error","unexpected-200","redirect-chat"]);
        for(const call of calls) {
            assert.equal(call.method,"POST");
            assert.equal(call.path,"/gateway/v1/chat/completions");
            assert.ok(call.authorized);
            assert.equal(call.model,"demo");
            assert.equal(call.hasSchema,false);
            assert.deepEqual(call.data.kontekst,["Wybrana karta"]);
        }
    });
