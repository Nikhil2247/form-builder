import type { FocusEvent } from "react"
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Selects the field's whole value on focus, so typing over a default title
 * (a question label, an option, a page name) replaces it in one step instead
 * of requiring a manual select-all first.
 */
export function selectAllOnFocus(e: FocusEvent<HTMLInputElement>): void {
  e.target.select();
}
