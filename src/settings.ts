import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type CanvasQwenPlugin from "./main";
import { localEndpoint, serverEndpoint } from "./local-qwen";
import type { QwenSettings } from "./local-qwen";

export const defaultSettings: QwenSettings = {
    baseUrl: "http://127.0.0.1:11434/v1", model: "", mode: "local", credential: null,
};

export class QwenSettingsTab extends PluginSettingTab {
    constructor(app: App, private readonly plugin: CanvasQwenPlugin) {
        super(app, plugin);
    }

    display(): void {
        this.containerEl.empty();
        const settings = this.plugin.settings;
        const server = settings.mode === "server";

        new Setting(this.containerEl).setName("Połączenie").addDropdown(field => field
            .addOption("local", "Na tym komputerze")
            .addOption("server", "Serwer HTTPS (OpenAI Compatible)")
            .setValue(settings.mode)
            .onChange(value => {
                const saved = this.plugin.updateSettings({ mode: value === "server" ? "server" : "local" });
                this.display();
                return saved;
            }));
        const address = new Setting(this.containerEl)
            .setName(server ? "Adres API" : "Adres lokalnego serwera")
            .setDesc(server ? "Wklej adres bazowy z instrukcji albo pełny adres chat/completions."
                : "Adres API na tym komputerze. Domyślny port Ollamy to 11434, a LM Studio 1234.");
        const addressMessage = this.containerEl.createDiv({ cls: "canvas-qwen-destination", attr: { role: "status" } });
        new Setting(this.containerEl)
            .setName("Model Qwen")
            .setDesc(server ? "Dokładna nazwa modelu z instrukcji serwera."
                : "Dokładna nazwa pobranego modelu widoczna w Ollamie lub LM Studio.")
            .addText(field => field.setPlaceholder(server ? "" : "np. qwen2.5:7b").setValue(settings.model)
                .onChange(value => this.plugin.updateSettings({ model: value.trim() })));
        const keyRow = this.containerEl.createDiv();
        const showKey = (endpoint: URL) => {
            keyRow.empty();
            const binding = this.plugin.settings.credential;
            const selectedAddress = this.plugin.settings.baseUrl;
            new Setting(keyRow).setName("Klucz API")
                .setDesc("Wybierz lub utwórz sekret. W jego wartości wklej sam klucz z instrukcji.")
                .addComponent(el => new SecretComponent(this.app, el)
                    .setValue(binding?.endpoint === endpoint.href ? binding.name : "")
                    .onChange(name => {
                        const current = this.plugin.settings;
                        if (current.mode !== "server" || current.baseUrl !== selectedAddress) return;
                        return this.plugin.updateSettings({ credential: name ? { name, endpoint: endpoint.href } : null });
                    }));
        };
        const updateAddress = (value: string, save: boolean) => {
            keyRow.empty();
            addressMessage.empty();
            try {
                const baseUrl = value.trim();
                const endpoint = server ? serverEndpoint(baseUrl) : localEndpoint(baseUrl);
                if (save && baseUrl !== this.plugin.settings.baseUrl) {
                    const previous = this.plugin.settings.credential;
                    void this.plugin.updateSettings({
                        baseUrl, credential: previous?.endpoint === endpoint.href ? previous : null,
                    });
                }
                if (server) {
                    addressMessage.setText(`Adres żądania: ${endpoint.href}`);
                    showKey(endpoint);
                }
            } catch (err) {
                // An invalid edit must not silently leave the old destination enabled.
                if (save) void this.plugin.updateSettings({ baseUrl: "", credential: null });
                addressMessage.setText((err as Error).message);
                if (server) new Setting(keyRow).setName("Klucz API")
                    .setDesc("Wpisz prawidłowy adres HTTPS i zatwierdź go klawiszem Tab, aby wybrać sekret.");
            }
        };
        address.addText(field => {
            field.setValue(settings.baseUrl);
            field.inputEl.addEventListener("change", () => updateAddress(field.getValue(), true));
        });
        updateAddress(settings.baseUrl, false);
    }
}
