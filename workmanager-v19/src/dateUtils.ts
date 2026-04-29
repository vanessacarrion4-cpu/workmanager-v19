/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export function formatLocalISO(date: Date): string {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) return '';
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseLocalISO(dateStr: string): Date {
  if (!dateStr) return new Date();
  const parts = dateStr.split('-').map(Number);
  if (parts.length === 3 && !parts.some(isNaN)) {
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? new Date() : d;
}
