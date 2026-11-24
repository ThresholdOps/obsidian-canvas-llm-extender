// OpenAI-compatible servers send one JSON chunk per SSE event. Keep only the final answer text.
const maxWireBytes = 8 * 1024 * 1024;
const maxEventChars = 256 * 1024;
class StreamError extends Error {}

async function* streamLines(chunks: AsyncIterable<Uint8Array>, onFirstData?: () => void) {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let carry = "";
    let afterCR = false;
    let received = 0;
    for await (const chunk of chunks) {
        if (!chunk.byteLength) continue;
        if (!received) onFirstData?.();
        received += chunk.byteLength;
        if (received > maxWireBytes) throw new StreamError("Strumień przekroczył dopuszczalny rozmiar.");
        let text = decoder.decode(chunk, { stream: true });
        if (!text) continue;
        if (afterCR && text.startsWith("\n")) text = text.slice(1);
        afterCR = text.endsWith("\r");
        const lines = text.split(/\r\n|[\n\r]/);
        lines[0] = carry + lines[0];
        carry = lines.pop()!;
        if (carry.length > maxEventChars) throw new StreamError("Pojedynczy fragment strumienia jest za duży.");
        yield* lines;
    }
    carry += decoder.decode();
    if (carry) yield carry;
}

async function* streamEvents(chunks: AsyncIterable<Uint8Array>, onFirstData?: () => void) {
    let fields: string[] = [];
    let size = 0;
    let event = "";
    for await (const line of streamLines(chunks, onFirstData)) {
        if (line === "") {
            if (event === "error") throw new StreamError("Serwer zgłosił błąd w trakcie przesyłania odpowiedzi.");
            if (fields.length) yield fields.join("\n");
            fields = [];
            size = 0;
            event = "";
            continue;
        }
        const colon = line.indexOf(":");
        const key = colon < 0 ? line : line.slice(0, colon);
        if (key !== "event" && key !== "data") continue;
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (key === "event") {
            event = value;
            continue;
        }
        size += value.length + 1;
        if (size > maxEventChars) throw new StreamError("Pojedynczy fragment strumienia jest za duży.");
        fields.push(value);
    }
    if (fields.length || event) throw new StreamError("Połączenie zakończyło się w połowie zdarzenia strumienia.");
}

export async function readChatStream(chunks: AsyncIterable<Uint8Array>, maxContentBytes: number,
    onFirstData?: () => void): Promise<string> {
    const parts: string[] = [];
    let size = 0;
    let finished = false;
    try {
        for await (const data of streamEvents(chunks, onFirstData)) {
            if (data.trim() === "[DONE]") {
                finished = true;
                break;
            }
            const frame = JSON.parse(data);
            if (frame?.error) throw new StreamError("Serwer zgłosił błąd w trakcie przesyłania odpowiedzi.");
            if (!Array.isArray(frame?.choices)) throw new StreamError("Serwer zwrócił niepoprawne zdarzenie czatu.");
            // Usage-only events have no choices, and reasoning deltas need no storage.
            const choice = frame.choices.find((item: { index?: number } | null) =>
                item && (item.index === 0 || item.index === undefined));
            if (!choice) continue;
            if (choice.finish_reason != null) {
                if (choice.finish_reason !== "stop") throw new StreamError("Model zakończył strumień bez pełnej odpowiedzi.");
                finished = true;
            }
            const text = choice.delta?.content;
            if (text == null || text === "") continue;
            if (typeof text !== "string") throw new StreamError("Serwer zwrócił niepoprawny fragment tekstu.");
            size += Buffer.byteLength(text);
            if (size > maxContentBytes) throw new StreamError("Odpowiedź modelu przekroczyła dopuszczalny rozmiar.");
            parts.push(text);
        }
    } catch (error) {
        if (error instanceof StreamError) throw error;
        throw new StreamError("Przerwano strumień lub serwer przesłał niepoprawne dane czatu.");
    }
    if (!finished || !size) throw new StreamError("Serwer nie przesłał pełnej odpowiedzi tekstowej.");
    return parts.join("");
}
