const { parseHTML } = require("linkedom");
const { document, Element } = parseHTML("<html><body></body></html>");

Element.prototype.createEl = function (name, { text, type, cls, attr = {} } = {}) {
    const el = document.createElement(name);
    if (text !== undefined) el.textContent = text;
    if (type) el.setAttribute("type", type);
    if (cls) el.className = cls;
    for (const [key, value] of Object.entries(attr)) el.setAttribute(key, value);
    this.appendChild(el);
    return el;
};
Element.prototype.createDiv = function (options) { return this.createEl("div", options); };
Element.prototype.setText = function (text) { this.textContent = text; };
Element.prototype.empty = function () { this.replaceChildren(); };
Element.prototype.addClass = function (cls) { this.classList.add(cls); };

class Modal {
    constructor(app) {
        this.app = app;
        this.modalEl = document.createElement("section");
        this.titleEl = this.modalEl.createEl("h2");
        this.contentEl = this.modalEl.createDiv();
    }
    setTitle(title) { this.titleEl.setText(title); }
    open() { document.body.appendChild(this.modalEl); this.onOpen(); }
    close() { this.modalEl.remove(); this.onClose(); }
}
class Setting {
    constructor(pane) { this.el = pane.createDiv(); }
    addButton(configure) {
        const el = this.el.createEl("button");
        const button = {
            setButtonText(text) { el.setText(text); return this; },
            setCta() { return this; },
            setDisabled(value) { el.disabled = value; return this; },
            onClick(action) { el.onclick = action; return this; },
        };
        configure(button);
        return this;
    }
}
class Plugin {
    constructor(app) { this.app = app; }
    async loadData() { return this.app.settings; }
    registerEvent() {}
    addSettingTab() {}
}
module.exports = { document, Modal, Setting, Plugin, PluginSettingTab: class {}, Notice: class {} };
