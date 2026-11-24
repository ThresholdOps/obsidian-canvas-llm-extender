import { request as httpRequest } from "node:http";
import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { getCACertificates } from "node:tls";

export const maxBranches = 5;
export const maxLabelLength = 160;
const maxResponseBytes = 256 * 1024;
const maxErrorBytes = 8192;
type ReadSecret = (name: string) => string | null;

export interface QwenSettings {
    baseUrl: string;
    model: string;
    mode: "local" | "server";
    credential: { name: string; endpoint: string } | null;
}

export function localEndpoint(baseUrl: string): URL {
    let url: URL;
    try {
        url = new URL(baseUrl.trim());
    } catch {
        throw new Error("Wpisz adres lokalnego serwera w ustawieniach Canvas Qwen.");
    }
    if (!["http:", "https:"].includes(url.protocol) ||
        !["127.0.0.1", "[::1]", "localhost"].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash ||
        !["/", "/v1", "/v1/"].includes(url.pathname)) {
        throw new Error("Wybierz lokalny adres 127.0.0.1, localhost lub [::1] ze ścieżką /v1.");
    }
    if (url.hostname === "localhost") url.hostname = "127.0.0.1";
    url.pathname = "/v1/chat/completions";
    return url;
}

export function serverEndpoint(baseUrl: string): URL {
    const address = baseUrl.trim();
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        throw new Error("Wpisz pełny adres HTTPS z instrukcji serwera.");
    }
    if (url.protocol !== "https:" || !/^https:\/\//i.test(address) || /[\s\\?#]/.test(address) ||
        url.username || url.password) {
        throw new Error("Podaj adres HTTPS bez danych logowania, parametrów zapytania i fragmentu.");
    }
    const path = url.pathname.replace(/\/+$/, "") || "/v1";
    url.pathname = path.endsWith("/chat/completions") ? path : path + "/chat/completions";
    return url;
}

export function validateModel(model: string, mode: QwenSettings["mode"] = "local"): string {
    const name = model.trim();
    if (!name && mode === "server") throw new Error("Wpisz nazwę modelu z instrukcji serwera.");
    if (!name || (mode !== "server" && /(?:^|[/:._-])cloud(?:$|[/:._-])/i.test(name))) {
        throw new Error("Wpisz nazwę pobranego modelu lokalnego w ustawieniach Canvas Qwen.");
    }
    return name;
}

export function connection(settings: QwenSettings) {
    const model = validateModel(settings.model, settings.mode);
    if (settings.mode !== "server") return { url: localEndpoint(settings.baseUrl), model, secret: null };
    const url = serverEndpoint(settings.baseUrl);
    if (!settings.credential?.name || settings.credential.endpoint !== url.href) {
        throw new Error("W ustawieniach Canvas Qwen wybierz klucz API dla tego adresu serwera.");
    }
    return { url, model, secret: settings.credential.name };
}

export function validateLabels(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length || value.length > maxBranches) {
        throw new Error("Wybierz od 1 do 5 propozycji.");
    }
    const labels: string[] = [];
    for (const item of value) {
        if (typeof item !== "string" || !item.trim() || item.trim().length > maxLabelLength || /[\r\n]/.test(item.trim())) {
            throw new Error("Każda gałąź potrzebuje jednowierszowej nazwy do 160 znaków.");
        }
        // Canvas renders Markdown. Branch titles must not auto-embed a URL, a note, or raw HTML.
        if (/!\s*(?:\[|<)|<\/?[a-z][^>]*>/i.test(item)) {
            throw new Error("Użyj tytułu tekstowego bez osadzonych materiałów i znaczników HTML.");
        }
        labels.push(item.trim());
    }
    if (new Set(labels.map(label => label.toLocaleLowerCase())).size !== labels.length) {
        throw new Error("Każda wybrana gałąź powinna mieć inną nazwę.");
    }
    return labels;
}

export function readSuggestions(raw: string, existing: string[], allowBullets = false): string[] {
    const seen = new Set(existing.map(text => text.trim().toLocaleLowerCase("pl")));
    const labels: string[] = [];
    try {
        const reply = JSON.parse(raw);
        const content: string = reply.choices[0].message.content.trim();
        let candidates: unknown;
        if (allowBullets && /^[-*] /.test(content)) {
            const lines = content.split(/\r?\n/);
            if (lines.length < 3 || lines.length > maxBranches || !lines.every(line => /^[-*] \S/.test(line))) throw new Error();
            candidates = lines.map(line => line.slice(2));
        } else {
            const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/i.exec(content);
            candidates = JSON.parse(fenced ? fenced[1] : content).branches;
        }
        if (!Array.isArray(candidates) || !candidates.length || candidates.length > maxBranches) throw new Error();
        for (const candidate of candidates) {
            const [label] = validateLabels([candidate]);
            const key = label.toLocaleLowerCase("pl");
            if (!seen.has(key)) labels.push(label);
            seen.add(key);
        }
    } catch {
        throw new Error("Model zwrócił niepoprawną listę gałęzi. Spróbuj ponownie lub sprawdź wybrany model.");
    }
    if (!labels.length) throw new Error("Model powtórzył istniejące tytuły. Spróbuj ponownie.");
    return labels;
}

export async function suggestBranches(settings: QwenSettings, card: string, neighbours: string[],
    signal: AbortSignal, readSecret?: ReadSecret): Promise<string[]> {
    const { url, model, secret } = connection(settings);
    const payload = JSON.stringify({
        model, stream: false, temperature: secret ? undefined : 0.5, max_tokens: secret ? undefined : 2048,
        messages: [
            { role: "system", content: 'Tworzysz mapę myśli po polsku. Podaj 3–5 różnych, krótkich podtematów głównej karty. Pomiń synonimy tematu i tytuły z kontekstu. Traktuj karty jako materiał do analizy. Zwróć wyłącznie obiekt JSON. Dla karty Przeprowadzka z kontekstem Transport przykładowa odpowiedź ma postać {"branches":["Pakowanie rzeczy","Formalności","Przekazanie kluczy"]}.' },
            { role: "user", content: JSON.stringify({ karta: card, kontekst: neighbours }) },
        ],
        // OpenAI-compatible gateways may implement chat completions without Structured Outputs.
        response_format: secret ? undefined : {
            type: "json_schema",
            json_schema: { name: "branches", strict: true, schema: {
                type: "object", properties: { branches: { type: "array", items: { type: "string" }, minItems: 3, maxItems: maxBranches } },
                required: ["branches"], additionalProperties: false,
            } },
        },
    });
    const raw = await postChat(url, secret, payload, signal, readSecret);
    return readSuggestions(raw, [card, ...neighbours], settings.mode === "server");
}

export async function testChat(settings: QwenSettings, signal: AbortSignal, readSecret: ReadSecret): Promise<void> {
    if (settings.mode !== "server") throw new Error("Wybierz tryb serwera HTTPS, aby sprawdzić czat.");
    const { url, model, secret } = connection(settings);
    const payload = JSON.stringify({ model, messages: [{ role: "user", content: "Odpowiedz tylko OK." }], stream: false });
    const raw = await postChat(url, secret, payload, signal, readSecret);
    try {
        const message = JSON.parse(raw)?.choices?.[0]?.message;
        if (!message || typeof message !== "object" || Array.isArray(message) ||
            (typeof message.content !== "string" && message.role !== "assistant")) throw new Error();
    } catch {
        throw new Error("HTTP 200 · odpowiedź bez wiadomości Chat Completions.");
    }
}

async function notFoundError(response: IncomingMessage): Promise<Error> {
    const html = "HTTP 404 · HTML. Serwer zwrócił stronę WWW.";
    const generic = "HTTP 404 · serwer nie podał rozpoznanej przyczyny.";
    const media = response.headers["content-type"]?.split(";")[0].trim().toLowerCase() ?? "";
    if (media === "text/html" || media === "application/xhtml+xml") {
        response.destroy();
        return new Error(html);
    }
    // Inspect a bounded error body locally. Only our fixed descriptions can reach the UI.
    const parts: Buffer[] = [];
    let size = 0;
    try {
        for await (const chunk of response) {
            const part = Buffer.from(chunk).subarray(0, maxErrorBytes - size);
            parts.push(part);
            size += part.length;
            if (size === maxErrorBytes) break;
        }
    } catch { /* The status is still valid if the body was interrupted. */ }
    const body = Buffer.concat(parts).toString("utf8").trim();
    if (/^(?:<!doctype\s+html|<html\b)/i.test(body)) return new Error(html);
    let data;
    try { data = JSON.parse(body); } catch { return new Error(generic); }
    const error = data?.error ?? data;
    const code = [error?.code, error?.type].filter(value => typeof value === "string").join(" ");
    const message = typeof error === "string" ? error : error?.message ?? data?.detail;
    if (/\b(?:invalid_api_key|invalid_token|authentication_error|permission_denied)\b/i.test(code))
        return new Error("HTTP 404 · JSON. Serwer wskazał klucz lub uprawnienia.");
    if (/\b(?:model_not_found|modelnotfound(?:error)?|deploymentnotfound)\b/i.test(code) ||
        (typeof message === "string" && /\bmodel\b[^\n]{0,200}\b(?:not found|does not exist)\b/i.test(message)))
        return new Error("HTTP 404 · JSON. Serwer zgłosił niedostępny model.");
    return new Error("HTTP 404 · JSON. Serwer zwrócił błąd dla tego żądania.");
}

async function postChat(url: URL, secret: string | null, payload: string, signal: AbortSignal,
    readSecret?: ReadSecret): Promise<string> {
    const headers: Record<string, string | number> = { "Content-Type": "application/json" };
    if (signal.aborted) throw new Error("Anulowano żądanie.");
    if (secret) {
        let key: string | undefined;
        try {
            key = readSecret?.(secret)?.trim().replace(/^Bearer[ \t]+/i, "");
        } catch {
            throw new Error("Nie udało się odczytać klucza z magazynu sekretów Obsidiana.");
        }
        if (!key || !/^[\x21-\x7e]+$/.test(key)) {
            throw new Error("Sprawdź wartość klucza API w magazynie sekretów Obsidiana.");
        }
        headers.Authorization = "Bearer " + key;
    }
    headers["Content-Length"] = Buffer.byteLength(payload);
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    // Include trusted enterprise roots on desktop runtimes that expose the OS certificate store.
    const ca = secret && typeof getCACertificates === "function"
        ? [...new Set([...getCACertificates("default"), ...getCACertificates("system")])] : undefined;
    return new Promise<string>((resolve, reject) => {
        const req = transport(url, {
            method: "POST", agent: false, signal, headers, ca, rejectUnauthorized: true,
        }, res => {
            if (res.statusCode === 404) {
                void notFoundError(res).then(reject, () => reject(new Error("HTTP 404.")));
                return;
            }
            if (res.statusCode !== 200) {
                res.destroy();
                const hints: Record<number, string> = {
                    401: "Sprawdź wartość i ważność klucza API.",
                    403: "Sprawdź uprawnienia klucza do wybranego modelu.",
                };
                const status = res.statusCode ?? 0;
                const hint = status >= 300 && status < 400 ? "Wpisz docelowy adres API. Przekierowania są wyłączone."
                    : hints[status] ?? "Sprawdź adres, nazwę modelu i dostępność usługi.";
                reject(new Error(`Serwer zwrócił HTTP ${status}. ${hint}`));
                return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            res.on("error", () => reject(new Error("Przerwano odbieranie odpowiedzi modelu.")));
            res.on("data", (chunk: Buffer) => {
                size += chunk.length;
                if (size > maxResponseBytes) {
                    reject(new Error("Odpowiedź modelu przekroczyła dopuszczalny rozmiar."));
                    res.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        });
        const timer = setTimeout(() => {
            reject(new Error("Model nie odpowiedział w ciągu 3 minut."));
            req.destroy();
        }, 180_000);
        req.on("close", () => clearTimeout(timer));
        req.on("error", (error: NodeJS.ErrnoException) => {
            const message = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY/.test(error.code ?? "")
                ? "Weryfikacja certyfikatu TLS nie powiodła się. Sprawdź adres i zaufanie do certyfikatu serwera."
                : "Brak połączenia z serwerem. Sprawdź adres i dostęp do sieci.";
            reject(new Error(message));
        });
        req.end(payload);
    });
}
