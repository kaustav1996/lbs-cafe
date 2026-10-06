/** The pass a phone gets after entering a table's code. Kept per table; the API decides whether it's still valid. */
const key = (table: string) => `lbs.tablePass.${table.trim()}`;

export function getTablePass(table: string): string | undefined {
  try {
    return localStorage.getItem(key(table)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setTablePass(table: string, pass: string) {
  try {
    localStorage.setItem(key(table), pass);
  } catch {
    // Private mode or storage blocked: the code is asked again next time, which still works.
  }
}
