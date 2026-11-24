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
        const server=createServer({cert:await readFile(cert),key:await readFile(key)},async(req,res)=>{
            let body="";
            for await(const chunk of req) body+=chunk;
            const payload=JSON.parse(body);
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
        for(const call of calls) {
            assert.equal(call.method,"POST");
            assert.equal(call.path,"/gateway/v1/chat/completions");
            assert.ok(call.authorized);
            assert.equal(call.model,"demo");
            assert.equal(call.hasSchema,false);
            assert.deepEqual(call.data.kontekst,["Wybrana karta"]);
        }
    });
