import { fmt } from "./recurrence";

let current = fmt(new Date());

export function setViewDate(date: string) {
  current = date;
}

export function getViewDate(): string {
  return current;
}

export function resetViewDate() {
  current = fmt(new Date());
}
