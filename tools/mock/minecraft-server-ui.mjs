/* Stand-in for @minecraft/server-ui 1.1.0 - only what 1.1.0 actually has. */

export const forms = { shown: [], queue: [] };

export function resetForms() {
  forms.shown.length = 0;
  forms.queue.length = 0;
}

/** Queue the selection the next form of `kind` should resolve with. */
export function answer(kind, selection, formValues) {
  forms.queue.push({ kind, selection, formValues });
}

function resolveFor(kind, record) {
  const index = forms.queue.findIndex((q) => q.kind === kind);
  if (index < 0) return { canceled: true, cancelationReason: "UserClosed" };
  const [entry] = forms.queue.splice(index, 1);
  record.answered = entry;
  return { canceled: false, selection: entry.selection, formValues: entry.formValues };
}

export class ActionFormData {
  constructor() {
    this.data = { kind: "action", title: "", body: "", buttons: [] };
  }
  title(text) {
    this.data.title = text;
    return this;
  }
  body(text) {
    this.data.body = text;
    return this;
  }
  button(text, icon) {
    if (typeof text !== "string" && (!text || typeof text !== "object")) {
      throw new Error("button text must be a string or RawMessage");
    }
    this.data.buttons.push({ text, icon });
    return this;
  }
  show(player) {
    this.data.player = player.name;
    forms.shown.push(this.data);
    return Promise.resolve(resolveFor("action", this.data));
  }
}

export class MessageFormData {
  constructor() {
    this.data = { kind: "message", buttons: [] };
  }
  title(text) {
    this.data.title = text;
    return this;
  }
  body(text) {
    this.data.body = text;
    return this;
  }
  button1(text) {
    this.data.buttons[0] = text;
    return this;
  }
  button2(text) {
    this.data.buttons[1] = text;
    return this;
  }
  show(player) {
    this.data.player = player.name;
    forms.shown.push(this.data);
    return Promise.resolve(resolveFor("message", this.data));
  }
}

export class ModalFormData {
  constructor() {
    this.data = { kind: "modal", fields: [] };
  }
  title(text) {
    this.data.title = text;
    return this;
  }
  textField(label, placeholder, value) {
    this.data.fields.push({ type: "text", label, placeholder, value });
    return this;
  }
  toggle(label, value) {
    this.data.fields.push({ type: "toggle", label, value });
    return this;
  }
  slider(label, min, max, step, value) {
    this.data.fields.push({ type: "slider", label, min, max, step, value });
    return this;
  }
  dropdown(label, options, value) {
    this.data.fields.push({ type: "dropdown", label, options, value });
    return this;
  }
  show(player) {
    this.data.player = player.name;
    forms.shown.push(this.data);
    return Promise.resolve(resolveFor("modal", this.data));
  }
}

export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" };
