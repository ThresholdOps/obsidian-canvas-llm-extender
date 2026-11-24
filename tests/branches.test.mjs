import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { adjacentTextCards, appendBranches } from "../src/obsidian-canvas-utils.ts";
import { localEndpoint, readSuggestions, suggestBranches, validateLabels, validateModel } from "../src/local-qwen.ts";

const root = { id: "topic", type: "text", text: "Wycieczka", x: 0, y: 0, width: 300, height: 120 };
const first = { nodes: [root], edges: [], extra: { preserve: true } };
const branches = ["Trasa", "Nocleg", "Dojazd"];

test("the first card can gain two independently editable native children in one change", () => {
    const data = appendBranches(first, root.id, root.text, branches.slice(0, 2));
    assert.deepEqual(first.nodes, [root]);
    assert.equal(first.edges.length, 0);
    assert.deepEqual(data.extra, first.extra);
    assert.deepEqual(data.nodes.slice(1).map(n => n.text), ["Trasa", "Nocleg"]);
    assert.deepEqual(data.edges.map(e => [e.fromNode, e.toNode]), data.nodes.slice(1).map(n => [root.id, n.id]));
    assert.equal(new Set([...data.nodes, ...data.edges].map(x => x.id)).size, 5);
});

test("live graph edits survive and new cards are placed clear of occupied space", () => {
    const obstacle = { ...root, id: "other", x: 330, y: -200, width: 500, height: 1000, color: "2" };
    const current = { ...first, nodes: [...first.nodes, obstacle] };
    const next = appendBranches(current, root.id, root.text, branches);
    assert.equal(next.nodes[1], obstacle);
    const children = next.nodes.slice(2);
    assert.ok(children[0].y >= obstacle.y + obstacle.height);
    for (let i = 1; i < children.length; i++) assert.ok(children[i].y >= children[i-1].y + children[i-1].height);
    assert.throws(() => appendBranches(current, "deleted", root.text, branches));
    assert.throws(() => appendBranches(current, root.id, "an older revision", branches));
});

test("only directly adjacent text cards are offered once, in both directions", () => {
    const ids = ["in", "out", "sibling", "file"];
    const nodes = [root, ...ids.map(id => ({ ...root, id, type: id === "file" ? "file" : "text" }))];
    const pairs = [["in",root.id],[root.id,"out"],["in","sibling"],[root.id,"file"],[root.id,"in"],[root.id,root.id]];
    const edges = pairs.map(([fromNode,toNode],i) => ({id: String(i),fromNode,toNode}));
    assert.deepEqual(adjacentTextCards({ nodes, edges }, root.id).map(n => n.id), ["in","out"]);
});

test("invalid settings stop before connecting", () => {
    for (const url of ["", "https://example.org/v1", "http://127.0.0.1.example.org", "http://user@localhost", "http://localhost/?to=elsewhere", "file:///v1", "http://127.0.0.1/other"]) {
        assert.throws(() => localEndpoint(url));
    }
    assert.equal(localEndpoint("http://localhost:11434/v1").href, "http://127.0.0.1:11434/v1/chat/completions");
    assert.equal(localEndpoint("http://[::1]:1234/").hostname, "[::1]");
    for (const model of ["", "qwen:cloud", "qwen:80b-cloud"]) assert.throws(() => validateModel(model));
});

test("branch labels are validated before changing the map", () => {
    assert.deepEqual(validateLabels(["  Plan  "]), ["Plan"]);
    for (const labels of [[], ["A","a"], [" "], ["x".repeat(161)], ["a\nb"], ["![[tajne]]"], ['<img src="https://example.org">']]) {
        assert.throws(() => validateLabels(labels));
    }
});

test("a small model repeating a source or a suggestion keeps the other suggestions usable", () => {
    const reply = labels => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ branches: labels }) } }] });
    assert.deepEqual(readSuggestions(reply([" WYCIECZKA ", "Trasa", "Nocleg", "nocleg", "Bagaż"]), ["Wycieczka", "Trasa"]), ["Nocleg", "Bagaż"]);
    assert.throws(() => readSuggestions(reply(["Trasa"]), ["trasa"]), /powtórzył/);
});

async function server(t, handler) {
    const instance = createServer(handler);
    instance.listen(0, "127.0.0.1");
    await once(instance, "listening");
    t.after(() => { instance.closeAllConnections(); return new Promise(resolve => instance.close(resolve)); });
    return { baseUrl: `http://127.0.0.1:${instance.address().port}/v1`, model: "test-qwen" };
}

test("one POST sends exactly the explicitly selected text and reads three alternatives", async t => {
    const requests = [];
    const local = await server(t, async (req,res) => {
        let body = "";
        for await (const part of req) body += part;
        const payload = JSON.parse(body);
        requests.push([req.method, req.url, JSON.parse(payload.messages[1].content), req.headers.authorization, payload.model]);
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ branches }) } }] }));
    });
    assert.deepEqual(await suggestBranches(local, "Temat", ["Jedna karta"], new AbortController().signal), branches);
    assert.deepEqual(requests, [["POST", "/v1/chat/completions", {karta:"Temat", kontekst:["Jedna karta"]}, undefined, "test-qwen"]]);
});

test("redirects are refused even between two loopback servers", async t => {
    let forwarded = 0;
    const other = await server(t, (_,res) => { forwarded++; res.end(); });
    const local = await server(t, (_,res) => { res.writeHead(307, {Location:other.baseUrl}); res.end(); });
    await assert.rejects(suggestBranches(local, "A", [], new AbortController().signal), /307/);
    assert.equal(forwarded, 0);
});

test("malformed output stops safely and a cancelled request does not reopen the dialog", async t => {
    const malformed = await server(t, (_,res) => res.end("{}"));
    await assert.rejects(suggestBranches(malformed, "A", [], new AbortController().signal), /niepoprawną/);
    const abort = new AbortController();
    const pending = await server(t, () => abort.abort());
    await assert.rejects(suggestBranches(pending, "A", [], abort.signal));
});
