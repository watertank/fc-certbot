// A case-insensitive multi-value-safe header container, mirroring Go's http.Header.
export class HeadersMap {
  private readonly store = new Map<string, string[]>();

  private static norm(key: string): string {
    return key.toLowerCase();
  }

  set(key: string, value: string): void {
    const k = HeadersMap.norm(key);
    const existing = this.store.get(k);
    if (existing) {
      existing[0] = value;
    } else {
      this.store.set(k, [value]);
    }
  }

  add(key: string, value: string): void {
    const k = HeadersMap.norm(key);
    const existing = this.store.get(k);
    if (existing) {
      existing.push(value);
    } else {
      this.store.set(k, [value]);
    }
  }

  get(key: string): string | undefined {
    return this.store.get(HeadersMap.norm(key))?.[0];
  }

  has(key: string): boolean {
    return this.store.has(HeadersMap.norm(key));
  }

  delete(key: string): boolean {
    return this.store.delete(HeadersMap.norm(key));
  }

  keys(): IterableIterator<string> {
    return this.store.keys();
  }

  toMap(): ReadonlyMap<string, string[]> {
    return this.store;
  }

  get size(): number {
    return this.store.size;
  }

  /** Convert to plain lowercased-key map for use with fetch/RequestInit. */
  toObject(): Record<string, string> {
    const obj: Record<string, string> = {};
    for (const [key, values] of this.store) {
      obj[key] = values.join(", ");
    }
    return obj;
  }
}
