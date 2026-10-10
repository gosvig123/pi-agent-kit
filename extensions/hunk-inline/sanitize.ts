import { stripVTControlCharacters } from "node:util";

const UNSAFE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function safeText(value: string): string {
  return stripVTControlCharacters(value)
    .replaceAll("\r", "")
    .replaceAll("\t", "  ")
    .replace(UNSAFE_CONTROL, "�");
}
