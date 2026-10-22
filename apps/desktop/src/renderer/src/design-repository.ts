import type { DesktopAPI, DesignSummary, LocalDesign } from "../../shared/contracts";

type Snapshot = { value?: LocalDesign; error?: string };
const EMPTY: Snapshot = Object.freeze({});
type Entry = {
  snapshot: Snapshot;
  listeners: Set<() => void>;
  generation: number;
  dirty: boolean;
  request?: Promise<LocalDesign>;
  writes: Promise<void>;
  writing: number;
};

/** One accepted document and one in-flight read per project/file, shared by every surface. */
export class DesignRepository {
  private entries = new Map<string, Entry>();
  constructor(private api: Pick<DesktopAPI, "readDesign" | "updateDesign">) {}

  private entry(projectId: string, id: string) {
    const key = `${projectId}:${id}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        snapshot: {},
        listeners: new Set(),
        generation: 0,
        dirty: true,
        writes: Promise.resolve(),
        writing: 0,
      };
      this.entries.set(key, entry);
    }
    // Retain a small warm cache; subscribed documents and outstanding work stay pinned.
    if (this.entries.size > 24) {
      for (const [candidate, value] of this.entries) {
        if (this.entries.size <= 24) break;
        if (value !== entry && !value.listeners.size && !value.request && !value.writing)
          this.entries.delete(candidate);
      }
    }
    return entry;
  }

  get(projectId: string, id: string) {
    return this.entries.get(`${projectId}:${id}`)?.snapshot ?? EMPTY;
  }

  subscribe(projectId: string, id: string, listener: () => void) {
    const entry = this.entry(projectId, id);
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
    };
  }

  private publish(entry: Entry, snapshot: Snapshot) {
    entry.snapshot = snapshot;
    for (const listener of entry.listeners) listener();
  }

  put(projectId: string, value: LocalDesign) {
    const entry = this.entry(projectId, value.id);
    if (entry.snapshot.value?.version === value.version && !entry.snapshot.error) return;
    entry.generation++;
    entry.dirty = false;
    if (entry.snapshot.value?.version !== value.version || entry.snapshot.error)
      this.publish(entry, { value });
  }

  async load(projectId: string, id: string): Promise<LocalDesign> {
    const entry = this.entry(projectId, id);
    while (entry.writing) await entry.writes;
    if (!entry.dirty && entry.snapshot.value) return entry.snapshot.value;
    if (entry.request) return entry.request;
    const request = (async () => {
      try {
        // An invalidation during a read requires another read, never an older snapshot.
        for (;;) {
          const generation = entry.generation;
          let value: LocalDesign;
          try {
            value = await this.api.readDesign(projectId, id);
          } catch (cause) {
            if (generation !== entry.generation) {
              if (!entry.dirty && entry.snapshot.value) return entry.snapshot.value;
              continue;
            }
            throw cause;
          }
          if (generation !== entry.generation) {
            if (!entry.dirty && entry.snapshot.value) return entry.snapshot.value;
            continue;
          }
          entry.dirty = false;
          if (entry.snapshot.value?.version !== value.version || entry.snapshot.error)
            this.publish(entry, { value });
          return value;
        }
      } catch (cause) {
        this.publish(entry, {
          value: entry.snapshot.value,
          error: cause instanceof Error ? cause.message : "Could not load this design.",
        });
        throw cause;
      } finally {
        entry.request = undefined;
      }
    })();
    entry.request = request;
    return request;
  }

  invalidate(projectId: string, designs: DesignSummary[]) {
    const summaries = new Map(designs.map((design) => [design.id, design]));
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(`${projectId}:`)) continue;
      const id = key.slice(projectId.length + 1);
      const summary = summaries.get(id);
      const value = entry.snapshot.value;
      if (
        summary &&
        value &&
        !entry.snapshot.error &&
        (summary.version
          ? summary.version === value.version
          : summary.updatedAt === value.updatedAt)
      )
        continue;
      entry.generation++;
      entry.dirty = true;
      if (entry.listeners.size && !entry.writing) void this.load(projectId, id).catch(() => {});
    }
  }

  update(
    projectId: string,
    id: string,
    changes: { document?: LocalDesign["document"]; name?: string },
    expectedVersion?: string,
  ) {
    const entry = this.entry(projectId, id);
    const write = entry.writes.then(async () => {
      // Use the last accepted base. External edits must fail the native expected-version check.
      const current = entry.snapshot.value ?? (await this.api.readDesign(projectId, id));
      const generation = entry.generation;
      try {
        const value = await this.api.updateDesign({
          projectId,
          designId: id,
          expectedVersion: expectedVersion ?? current.version,
          ...changes,
        });
        const invalidated = entry.generation !== generation;
        this.put(projectId, value);
        // A disk notification can overtake the mutation response. Reconcile after writes settle.
        if (invalidated) entry.dirty = true;
        return value;
      } catch (cause) {
        entry.dirty = true;
        entry.generation++;
        throw cause;
      }
    });
    entry.writing++;
    entry.writes = write
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        entry.writing--;
        if (!entry.writing && entry.dirty && entry.listeners.size)
          void this.load(projectId, id).catch(() => {});
      });
    return write;
  }
}
