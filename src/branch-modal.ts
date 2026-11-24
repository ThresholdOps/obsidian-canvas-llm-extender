import { App, Modal, Setting } from "obsidian";
import type { CanvasTextData } from "obsidian/canvas";
import { connection, maxLabelLength, suggestBranches, validateLabels } from "./local-qwen";
import type { QwenSettings } from "./local-qwen";

export class BranchModal extends Modal {
    private readonly controller = new AbortController();
    private readonly selected = new Set<string>();

    constructor(app: App, private readonly card: CanvasTextData, private readonly neighbours: CanvasTextData[],
        private readonly settings: QwenSettings, private readonly apply: (labels: string[]) => void,
        private readonly dismissed: () => void) {
        super(app);
    }

    onOpen(): void {
        this.modalEl.addClass("canvas-qwen-modal");
        this.setTitle("Rozwiń gałąź z Qwenem");
        this.drawContext();
    }

    private drawContext(): void {
        const pane = this.contentEl;
        pane.empty();
        pane.createEl("h3", { text: "Karta źródłowa" });
        pane.createEl("pre", { text: this.card.text, cls: "canvas-qwen-card" });
        if (this.neighbours.length) {
            pane.createEl("h3", { text: "Dołącz sąsiednie karty" });
            for (const card of this.neighbours) {
                const label = pane.createEl("label", { cls: "canvas-qwen-row" });
                const check = label.createEl("input", { type: "checkbox" });
                check.onchange = () => {
                    if (check.checked) this.selected.add(card.id);
                    else this.selected.delete(card.id);
                };
                label.createEl("span", { text: card.text, cls: "canvas-qwen-card" });
            }
        }
        const destination = pane.createDiv({ cls: "canvas-qwen-destination" });
        const status = pane.createDiv({ attr: { role: "status", "aria-live": "polite" } });
        let ready = true;
        try {
            const target = connection(this.settings);
            destination.setText(`${target.model} · ${target.url.href}`);
        } catch (error) {
            status.setText((error as Error).message);
            ready = false;
        }
        new Setting(pane)
            .addButton(button => button.setButtonText("Anuluj").onClick(() => this.close()))
            .addButton(button => button.setButtonText("Zaproponuj gałęzie").setCta().setDisabled(!ready).onClick(async () => {
                button.setDisabled(true);
                const context = this.neighbours.filter(n => this.selected.has(n.id)).map(n => n.text);
                const checks = Array.from(pane.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
                checks.forEach(check => { check.disabled = true; });
                status.setText("Qwen przygotowuje propozycje…");
                try {
                    const labels = await suggestBranches(this.settings, this.card.text, context, this.controller.signal,
                        name => this.app.secretStorage.getSecret(name));
                    if (!this.controller.signal.aborted) this.drawSuggestions(labels);
                } catch (error) {
                    if (this.controller.signal.aborted) return;
                    status.setText((error as Error).message);
                    checks.forEach(check => { check.disabled = false; });
                    button.setDisabled(false);
                }
            }));
    }

    private drawSuggestions(suggestions: string[]): void {
        const pane = this.contentEl;
        pane.empty();
        this.setTitle("Wybierz gałęzie do dodania");
        pane.createEl("p", { text: "Możesz poprawić nazwy przed dodaniem ich do mapy." });
        const rows = suggestions.map((name, index) => {
            const row = pane.createDiv({ cls: "canvas-qwen-row" });
            const check = row.createEl("input", { type: "checkbox", attr: { "aria-label": `Wybierz propozycję ${index + 1}` } });
            const title = row.createEl("input", { type: "text", attr: { "aria-label": `Nazwa propozycji ${index + 1}`, maxlength: String(maxLabelLength) } });
            title.value = name;
            return { check, title };
        });
        const status = pane.createDiv({ attr: { role: "status", "aria-live": "polite" } });
        const actions = new Setting(pane).addButton(button => button.setButtonText("Anuluj").onClick(() => this.close()));
        actions.addButton(button => {
            const active = () => rows.filter(row => row.check.checked);
            const update = () => {
                const count = active().length;
                status.empty();
                button.setButtonText(`Dodaj wybrane (${count})`).setDisabled(count === 0);
            };
            for (const { check, title } of rows) {
                check.onchange = update;
                title.oninput = update;
            }
            button.setCta().onClick(() => {
                if (this.controller.signal.aborted) return;
                button.setDisabled(true);
                try {
                    this.apply(validateLabels(active().map(row => row.title.value)));
                    this.close();
                } catch (error) {
                    status.setText((error as Error).message);
                    button.setDisabled(false);
                }
            });
            update();
        });
    }

    onClose(): void {
        this.controller.abort();
        this.contentEl.empty();
        this.dismissed();
    }
}
