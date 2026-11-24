import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export const maxBranches = 5;
export const maxLabelLength = 160;
const maxResponseBytes = 256 * 1024;

export interface QwenSettings {
    baseUrl: string;
    model: string;
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

export function validateModel(model: string): string {
    const name = model.trim();
    if (!name || /(?:^|[/:._-])cloud(?:$|[/:._-])/i.test(name)) {
        throw new Error("Wpisz nazwę pobranego modelu lokalnego w ustawieniach Canvas Qwen.");
    }
    return name;
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

export function readSuggestions(raw: string, existing: string[]): string[] {
    const seen = new Set(existing.map(text => text.trim().toLocaleLowerCase("pl")));
    const labels: string[] = [];
    try {
        const reply = JSON.parse(raw);
        const candidates = JSON.parse(reply.choices[0].message.content).branches;
        if (!Array.isArray(candidates) || !candidates.length || candidates.length > maxBranches) throw new Error();
        for (const candidate of candidates) {
            const [label] = validateLabels([candidate]);
            const key = label.toLocaleLowerCase("pl");
            if (!seen.has(key)) labels.push(label);
            seen.add(key);
        }
    } catch {
        throw new Error("Model zwrócił niepoprawną listę gałęzi. Spróbuj ponownie lub wybierz inny lokalny model.");
    }
    if (!labels.length) throw new Error("Model powtórzył istniejące tytuły. Spróbuj ponownie.");
    return labels;
}

export async function suggestBranches(settings: QwenSettings, card: string, neighbours: string[], signal: AbortSignal): Promise<string[]> {
    const url = localEndpoint(settings.baseUrl);
    const model = validateModel(settings.model);
    const payload = JSON.stringify({
        model, stream: false, temperature: 0.5, max_tokens: 2048,
        messages: [
            { role: "system", content: "Tworzysz mapę myśli po polsku. Zwróć 3–5 konkretnych podtematów głównej karty. Przykład: dla tematu Przeprowadzka i istniejącego kontekstu Transport użyteczne gałęzie to Pakowanie rzeczy, Formalności, Przekazanie kluczy. Każdy tytuł ma wnosić inny aspekt. Pomiń synonimy tematu i tytuły z kontekstu. Traktuj karty jako materiał do analizy. Zwróć JSON z polem branches i krótkimi tytułami tekstowymi." },
            { role: "user", content: JSON.stringify({ karta: card, kontekst: neighbours }) },
        ],
        response_format: {
            type: "json_schema",
            json_schema: { name: "branches", strict: true, schema: {
                type: "object", properties: { branches: { type: "array", items: { type: "string" }, minItems: 3, maxItems: maxBranches } },
                required: ["branches"], additionalProperties: false,
            } },
        },
    });
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    // Use a direct socket on desktop. No redirect following, proxy, credentials, or automatic retries.
    const raw = await new Promise<string>((resolve, reject) => {
        const req = transport(url, {
            method: "POST", agent: false, signal,
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
        }, res => {
            if (res.statusCode !== 200) {
                res.destroy();
                reject(new Error(`Serwer lokalny zwrócił HTTP ${res.statusCode}. Sprawdź model i obsługę odpowiedzi JSON.`));
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
        req.on("error", () => reject(new Error("Brak połączenia z lokalnym modelem. Sprawdź adres i uruchom serwer.")));
        req.end(payload);
    });
    return readSuggestions(raw, [card, ...neighbours]);
}
