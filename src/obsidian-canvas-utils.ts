import { randomUUID } from "node:crypto";
import type { AllCanvasNodeData, CanvasData, CanvasTextData } from "obsidian/canvas";

export interface Canvas {
    getData(): CanvasData;
    setData(data: CanvasData): void;
    requestSave(history: boolean): void;
}

export function isCanvasCard(value: unknown): value is { id: string; canvas: Canvas } {
    if (!value || typeof value !== "object" || !("id" in value) || !("canvas" in value)) return false;
    const canvas = value.canvas as Partial<Canvas> | null;
    return typeof value.id === "string" && !!canvas && typeof canvas.getData === "function"
        && typeof canvas.setData === "function" && typeof canvas.requestSave === "function";
}

export function textCard(data: CanvasData, id: string): CanvasTextData | undefined {
    return data.nodes.find((card): card is CanvasTextData => card.id === id && card.type === "text");
}

export function adjacentTextCards(data: CanvasData, id: string): CanvasTextData[] {
    const adjacent = new Set<string>();
    for (const edge of data.edges) {
        if (edge.fromNode === id) adjacent.add(edge.toNode);
        if (edge.toNode === id) adjacent.add(edge.fromNode);
    }
    adjacent.delete(id);
    return data.nodes.filter((card): card is CanvasTextData => card.type === "text" && adjacent.has(card.id));
}

function overlaps(a: CanvasTextData, b: AllCanvasNodeData): boolean {
    return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

// Build one complete change from the current graph so other edits made during generation survive.
export function appendBranches(data: CanvasData, parentId: string, expectedText: string, labels: string[]): CanvasData {
    const parent = textCard(data, parentId);
    if (!parent || parent.text !== expectedText) {
        throw new Error("Karta źródłowa uległa zmianie. Otwórz polecenie ponownie.");
    }
    const nodes = [...data.nodes];
    const edges = [...data.edges];
    const gap = 40;
    const width = Math.max(220, Math.min(parent.width, 360));
    const height = 120;
    let y = Math.round(parent.y + parent.height / 2 - (labels.length * height + (labels.length - 1) * gap) / 2);

    for (const label of labels) {
        const child: CanvasTextData = {
            id: randomUUID(), type: "text", text: label,
            x: Math.round(parent.x + parent.width + gap), y, width, height,
        };
        // A crowded column still has room below the last occupied rectangle.
        for (const obstacle of nodes.filter(n => n.x < child.x + width && n.x + n.width > child.x)
            .sort((a, b) => a.y - b.y)) {
            if (overlaps(child, obstacle)) child.y = Math.ceil(obstacle.y + obstacle.height + gap);
        }
        nodes.push(child);
        edges.push({
            id: randomUUID(), fromNode: parent.id, fromSide: "right",
            toNode: child.id, toSide: "left", toEnd: "arrow",
        });
        y = child.y + height + gap;
    }
    return { ...data, nodes, edges };
}
