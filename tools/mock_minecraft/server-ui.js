/* Stand-in for @minecraft/server-ui. Records the form instead of showing it. */

export const shownForms = [];

/** Set to a button index to auto-answer the next form, or undefined to cancel. */
export const formResponse = { selection: undefined, canceled: true, cancelationReason: undefined };

export class ActionFormData {
  constructor() {
    this.data = { title: "", body: "", buttons: [] };
  }

  title(t) {
    this.data.title = t;
    return this;
  }

  body(t) {
    this.data.body = t;
    return this;
  }

  button(label, icon) {
    this.data.buttons.push({ label, icon });
    return this;
  }

  show(player) {
    shownForms.push({ player, ...this.data });
    return Promise.resolve({
      canceled: formResponse.canceled,
      selection: formResponse.selection,
      cancelationReason: formResponse.cancelationReason
    });
  }
}

export class MessageFormData {
  constructor() {
    this.data = { title: "", body: "", buttons: [] };
  }

  title(t) {
    this.data.title = t;
    return this;
  }

  body(t) {
    this.data.body = t;
    return this;
  }

  button1(t) {
    this.data.buttons.push(t);
    return this;
  }

  button2(t) {
    this.data.buttons.push(t);
    return this;
  }

  show(player) {
    shownForms.push({ player, ...this.data });
    return Promise.resolve({ canceled: true });
  }
}
