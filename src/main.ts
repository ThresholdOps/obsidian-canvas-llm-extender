import { Notice, Plugin } from "obsidian";
import { BranchModal } from "./branch-modal";
import { adjacentTextCards, appendBranches, isCanvasCard, textCard } from "./obsidian-canvas-utils";
import type { QwenSettings } from "./local-qwen";
import { defaultSettings, QwenSettingsTab } from "./settings";

export default class CanvasQwenPlugin extends Plugin {
    settings: QwenSettings = { ...defaultSettings };
    private modal?: BranchModal;
    private preferences?: QwenSettingsTab;
    private pendingSave = Promise.resolve();

    async onload(): Promise<void> {
        const data = await this.loadData();
        this.settings = {
            baseUrl: typeof data?.baseUrl === "string" ? data.baseUrl : defaultSettings.baseUrl,
            model: typeof data?.model === "string" ? data.model : defaultSettings.model,
            mode: data?.mode === "server" ? "server" : "local",
            credential: typeof data?.credential?.name === "string" && typeof data.credential.endpoint === "string"
                ? { name: data.credential.name, endpoint: data.credential.endpoint } : null,
        };
        this.preferences = new QwenSettingsTab(this.app, this);
        this.addSettingTab(this.preferences);
        this.registerEvent(this.app.workspace.on("canvas:node-menu", (menu, node: unknown) => {
            if (!isCanvasCard(node) || !textCard(node.canvas.getData(), node.id)) return;
            menu.addItem(item => item.setTitle("Rozwiń gałąź z Qwenem").setIcon("git-fork")
                .onClick(() => this.openBranches(node)));
        }));
    }

    updateSettings(changes: Partial<QwenSettings>): Promise<void> {
        this.preferences?.resetChatTest();
        this.modal?.close();
        this.settings = { ...this.settings, ...changes };
        const snapshot = this.settings;
        this.pendingSave = this.pendingSave.then(() => this.saveData(snapshot)).catch(() => {
            new Notice("Nie udało się zapisać ustawień Canvas Qwen w tym sejfie.");
        });
        return this.pendingSave;
    }

    private openBranches(node: unknown): void {
        if (!isCanvasCard(node)) return;
        const { canvas, id } = node;
        const data = canvas.getData();
        const card = textCard(data, id);
        if (!card || !card.text.trim()) {
            new Notice("Wpisz temat w karcie tekstowej.");
            return;
        }
        const source = { ...card };
        this.modal?.close();
        this.modal = new BranchModal(this.app, source,
            adjacentTextCards(data, id).map(n => ({ ...n })), { ...this.settings }, labels => {
                const stillOpen = this.app.workspace.getLeavesOfType("canvas").some(leaf =>
                    "canvas" in leaf.view && leaf.view.canvas === canvas);
                if (!stillOpen) throw new Error("Mapa została zamknięta. Otwórz ją ponownie.");
                canvas.setData(appendBranches(canvas.getData(), id, source.text, labels));
                canvas.requestSave(true);
            }, () => { this.modal = undefined; });
        this.modal.open();
    }

    onunload(): void {
        this.preferences?.hide();
        this.modal?.close();
    }
}
