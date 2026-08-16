/* Minimal stand-in for @minecraft/server-ui used by the validation harness. */

export class ActionFormData {
  constructor() {
    this.buttons = [];
  }
  title(text) {
    this._title = text;
    return this;
  }
  body(text) {
    this._body = text;
    return this;
  }
  button(text) {
    this.buttons.push(text);
    return this;
  }
  show() {
    return Promise.resolve({ canceled: true });
  }
}

export class MessageFormData {
  title() {
    return this;
  }
  body() {
    return this;
  }
  button1() {
    return this;
  }
  button2() {
    return this;
  }
  show() {
    return Promise.resolve({ canceled: true });
  }
}

export class ModalFormData {
  title() {
    return this;
  }
  show() {
    return Promise.resolve({ canceled: true });
  }
}
