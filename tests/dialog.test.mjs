import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { createServer } from "node:http";
import { once } from "node:events";

const require = createRequire(import.meta.url);
const host = new URL("./fixtures/obsidian.cjs", import.meta.url);
const hooks = registerHooks({ resolve(id, ctx, next) {
    return id === "obsidian" ? { url: host.href, shortCircuit: true } : next(id, ctx);
} });
const { document } = require("./fixtures/obsidian.cjs");
const Plugin = require("../main.js").default;
hooks.deregister();

const root = { id:"root", type:"text", text:"Planowanie wycieczki w góry", x:0, y:0, width:280, height:120 };
const button = prefix => [...document.querySelectorAll("button")].find(el => el.textContent.startsWith(prefix));

async function dialog(t, settings, withNeighbours = false, secretStorage) {
    let graph = { nodes:[{ ...root }], edges:[] };
    if (withNeighbours) {
        for (const [id, text] of [["yes", "Trasa kolejowa"], ["no", "Prywatna notatka testowa"]]) {
            graph.nodes.push({ ...root, id, text, x:-400 });
            graph.edges.push({ id:"e-"+id, fromNode:id, toNode:root.id });
        }
    }
    let saves = 0;
    const canvas = { getData:() => structuredClone(graph), setData:data => { graph = data; }, requestSave:() => { saves++; } };
    let menuEvent;
    const workspace = {
        on(event, fn) { assert.equal(event,"canvas:node-menu"); menuEvent = fn; },
        getLeavesOfType:() => [{ view:{ canvas } }],
    };
    const plugin = new Plugin({ settings, workspace, secretStorage });
    await plugin.onload();
    t.after(() => plugin.onunload());
    const item = { setTitle() { return this; }, setIcon() { return this; }, onClick(fn) { this.click = fn; return this; } };
    menuEvent({addItem:fn => fn(item)}, {id:root.id, canvas});
    item.click();
    return { graph:() => graph, saves:() => saves };
}

async function mockServer(t, callback) {
    const s = createServer(callback);
    s.listen(0, "127.0.0.1");
    await once(s,"listening");
    t.after(() => { s.closeAllConnections(); return new Promise(resolve => s.close(resolve)); });
    return { baseUrl:`http://127.0.0.1:${s.address().port}/v1`, model:"test" };
}

function check(el) {
    el.checked = true;
    el.onchange();
}

function acceptTwo() {
    const picks = [...document.querySelectorAll('input[type="checkbox"]')];
    assert.ok(picks.length >= 2 && picks.length <= 5);
    assert.ok(button("Dodaj wybrane").disabled);
    const last = picks.length - 1;
    check(picks[0]); check(picks[last]);
    const titles = [...document.querySelectorAll('input[type="text"]')];
    titles[0].value = "Moja poprawiona gałąź";
    titles[0].oninput();
    const selected = [titles[0].value, titles[last].value];
    button("Dodaj wybrane (2)").click();
    return selected;
}

test("menu, context selection, model, edit, accept two, then cancel during a new request", async t => {
    const payloads = [];
    const settings = await mockServer(t, async (req,res) => {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        payloads.push(JSON.parse(JSON.parse(raw).messages[1].content));
        if (payloads.length === 1) res.end(JSON.stringify({choices:[{message:{content:'{"branches":["Sprzęt","Nocleg","Mapa"]}'}}]}));
    });
    const first = await dialog(t,settings,true);
    const neighbours = [...document.querySelectorAll('input[type="checkbox"]')];
    assert.equal(neighbours.length,2);
    check(neighbours[0]);
    await button("Zaproponuj").onclick();
    assert.deepEqual(payloads,[{karta:root.text,kontekst:["Trasa kolejowa"]}]);
    assert.equal(first.saves(),0);
    const selected = acceptTwo();
    assert.deepEqual(first.graph().nodes.slice(3).map(n => n.text),selected);
    assert.equal(first.graph().edges.length,4);
    assert.equal(first.saves(),1);

    const second = await dialog(t,settings);
    const pending = button("Zaproponuj").onclick();
    button("Anuluj").click();
    await pending;
    assert.equal(second.graph().nodes.length,1);
    assert.equal(second.saves(),0);
    assert.equal(document.querySelector("section"),null);
});

test("an unavailable local server leaves the map alone and enables retry", async t => {
    const settings = await mockServer(t, (_,res) => { res.writeHead(503); res.end(); });
    const ui = await dialog(t,settings);
    await button("Zaproponuj").onclick();
    assert.match(document.querySelector('[role="status"]').textContent,/503/);
    assert.ok(!button("Zaproponuj").disabled);
    assert.equal(ui.saves(),0);
    assert.equal(ui.graph().nodes.length,1);
});

if (process.env.CANVAS_QWEN_TEST_MODEL) {
    const model = process.env.CANVAS_QWEN_TEST_MODEL;
    const connections = [{name:"loopback", settings:{baseUrl:process.env.CANVAS_QWEN_TEST_URL, model}}];
    const gateway = process.env.CANVAS_QWEN_TEST_HTTPS_URL;
    if (gateway) connections.push({name:"authenticated HTTPS", settings:{
        mode:"server",baseUrl:gateway,model,credential:{name:"integration",endpoint:gateway+"/chat/completions"},
    }});
    if (gateway) test("the settings button checks a real HTTPS chat once with the already selected secret", async t => {
        let reads=0;
        const app={settings:connections[1].settings,workspace:{on(){}},secretStorage:{
            getSecret(name){assert.equal(name,"integration"); reads++; return process.env.CANVAS_QWEN_TEST_BEARER;},
        }};
        const plugin=new Plugin(app);
        await plugin.onload();
        t.after(()=>plugin.onunload());
        const tab=app.settingsTab;
        tab.display();
        assert.equal(reads,0);
        const button=[...tab.containerEl.querySelectorAll("button")].find(el=>el.textContent==="Sprawdź czat");
        const first=button.onclick();
        assert.equal(button.disabled,true);
        await button.onclick();
        await first;
        assert.equal(reads,1);
        assert.match(tab.containerEl.textContent,/CZAT OK · HTTP 200/);
        assert.equal(button.disabled,false);
        await plugin.updateSettings({model:"other-model"});
        assert.doesNotMatch(tab.containerEl.textContent,/CZAT OK/);
    });
    for (const {name,settings} of connections) test(`plugin bundle expands a single card with a real model over ${name}`, async t => {
        const ui = await dialog(t,settings,false,{ getSecret:id => id==="integration" ? process.env.CANVAS_QWEN_TEST_BEARER : null });
        await button("Zaproponuj").onclick();
        assert.ok(button("Dodaj wybrane"), document.querySelector('[role="status"]')?.textContent);
        assert.equal(ui.saves(),0);
        const selected = acceptTwo();
        assert.deepEqual(ui.graph().nodes.slice(1).map(n => n.text),selected);
        assert.equal(ui.saves(),1);
        assert.equal(ui.graph().edges.length,2);
    });
}

test("upgrading a configured server keeps it opt-in and stores only the selected secret name and destination", async () => {
    let reads = 0;
    const app = {
        workspace: {on(){}},
        settings: {baseUrl:"https://example.org/gateway/v1",model:"my-qwen"},
        secretStorage: {getSecret(){ reads++; return "test-only-raw-value"; }},
    };
    const plugin = new Plugin(app);
    await plugin.onload();
    assert.equal(plugin.settings.mode,"local");
    assert.equal(plugin.settings.model,"my-qwen");
    const tab = app.settingsTab;
    tab.display();
    const pane = tab.containerEl;
    assert.equal(pane.querySelector('[aria-label="secret name"]'),null);
    const select = pane.querySelector("select");
    select.querySelector('option[value="local"]').selected=false;
    select.querySelector('option[value="server"]').selected=true;
    await select.onchange();
    assert.match(pane.textContent,/gateway\/v1\/chat\/completions/);
    const pick = pane.querySelector('[aria-label="secret name"]');
    pick.value="qwen-test";
    await pick.onchange();
    assert.deepEqual(app.saved.credential,{name:"qwen-test",endpoint:"https://example.org/gateway/v1/chat/completions"});
    assert.equal(JSON.stringify(app.saved).includes("test-only-raw-value"),false);
    const address = [...pane.querySelectorAll('input')].find(el=>el.value===app.settings.baseUrl);
    const change = () => address.dispatchEvent(new address.ownerDocument.defaultView.Event("change"));
    address.value="https://other.example.org/v1";
    change();
    assert.equal(plugin.settings.credential,null);
    await pick.onchange();
    assert.equal(plugin.settings.credential,null);
    address.value="https://other.example.org/v1?key=test-only-raw-value";
    change();
    await plugin.updateSettings({model:"my-qwen"});
    assert.equal(app.saved.baseUrl,"");
    assert.equal(JSON.stringify(app.saved).includes("test-only-raw-value"),false);
    assert.equal(reads,0);
});

test("a missing server token fails on Generate before any request and leaves the map alone", async t => {
    const baseUrl="https://qwen.example.org/v1";
    const lookups=[];
    const remote={baseUrl,mode:"server",model:"example",credential:{name:"qwen-token",endpoint:baseUrl+"/chat/completions"}};
    const ui=await dialog(t,remote,false,{getSecret(name){lookups.push(name); return null;}});
    assert.deepEqual(lookups,[]);
    assert.match(document.body.textContent,/https:\/\/qwen\.example\.org\/v1\/chat\/completions/);
    await button("Zaproponuj").onclick();
    assert.deepEqual(lookups,["qwen-token"]);
    assert.match(document.querySelector('[role="status"]').textContent,/magazynie sekretów/);
    assert.equal(ui.saves(),0);
});

test("the chat test uses the saved secret only on click and drops stale results when settings close or change", async () => {
    const baseUrl="https://example.org/v1";
    const settings={baseUrl,mode:"server",model:"example",credential:{name:"test-key",endpoint:baseUrl+"/chat/completions"}};
    let reads=0;
    const app={settings,workspace:{on(){}},secretStorage:{getSecret(){reads++; return null;}}};
    const plugin=new Plugin(app);
    await plugin.onload();
    const tab=app.settingsTab;
    tab.display();
    const check=[...tab.containerEl.querySelectorAll("button")].find(el=>el.textContent==="Sprawdź czat");
    assert.equal(reads,0);
    const failed=check.onclick();
    await check.onclick();
    await failed;
    assert.equal(reads,1);
    assert.match(tab.containerEl.textContent,/wartość klucza API/);
    const obsolete=check.onclick();
    await plugin.updateSettings({model:"changed"});
    await obsolete;
    assert.doesNotMatch(tab.containerEl.textContent,/wartość klucza API|Oczekiwanie/);
    const hidden=check.onclick();
    tab.hide();
    await hidden;
    assert.doesNotMatch(tab.containerEl.textContent,/wartość klucza API|Oczekiwanie/);
    plugin.onunload();
});
