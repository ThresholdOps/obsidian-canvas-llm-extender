import { App, PluginSettingTab, Setting } from "obsidian";
import type CanvasQwenPlugin from "./main";
import type { QwenSettings } from "./local-qwen";

export const defaultSettings: QwenSettings = { baseUrl: "http://127.0.0.1:11434/v1", model: "" };

export class QwenSettingsTab extends PluginSettingTab {
    constructor(app: App, private readonly plugin: CanvasQwenPlugin) {
        super(app, plugin);
    }

    display(): void {
        this.containerEl.empty();
        new Setting(this.containerEl)
            .setName("Adres lokalnego serwera")
            .setDesc("Adres API zgodnego z OpenAI na tym komputerze. Domyślny port Ollamy to 11434, a LM Studio 1234.")
            .addText(field => field.setValue(this.plugin.settings.baseUrl)
                .onChange(value => this.plugin.updateSettings({ baseUrl: value.trim() })));
        new Setting(this.containerEl)
            .setName("Model Qwen")
            .setDesc("Dokładna nazwa pobranego modelu widoczna w Ollamie lub LM Studio.")
            .addText(field => field.setPlaceholder("np. qwen2.5:7b").setValue(this.plugin.settings.model)
                .onChange(value => this.plugin.updateSettings({ model: value.trim() })));
    }
}
