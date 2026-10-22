import { expect, test } from "bun:test";
import { blankDesignDocument } from "@tidy/design/document";
import type { LocalDesign } from "../shared/contracts";
import { DesignRepository } from "../renderer/src/design-repository";

const file = (version: string, id = "design"): LocalDesign => ({
  id,
  name: "Design",
  path: `/project/.tidy/designs/${id}.json`,
  updatedAt: "same-mtime",
  document: blankDesignDocument(),
  version,
  assets: {},
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("design surfaces deduplicate reads and invalidate only the changed project/file, even with the same mtime", async () => {
  let reads = 0;
  const repository = new DesignRepository({
    async readDesign(_projectId, id) {
      reads++;
      return file(String(reads), id);
    },
    async updateDesign() {
      throw new Error("Unused");
    },
  });
  const [first, same] = await Promise.all([
    repository.load("project", "design"),
    repository.load("project", "design"),
  ]);
  expect(first).toBe(same);
  expect(reads).toBe(1);
  await repository.load("other-project", "design");
  await repository.load("project", "other-design");
  const unchanged = repository.get("project", "other-design");
  repository.invalidate("project", [file("new"), file("3", "other-design")]);
  expect(await repository.load("project", "design")).not.toBe(first);
  expect(repository.get("project", "other-design")).toBe(unchanged);
  expect(reads).toBe(4);
  await repository.load("other-project", "design");
  expect(reads).toBe(4);
});

test("an invalidation or accepted edit that overtakes a read cannot be replaced by the stale response", async () => {
  const read = deferred<LocalDesign>();
  let reads = 0;
  const repository = new DesignRepository({
    readDesign: async () => (++reads === 1 ? read.promise : file("new")),
    async updateDesign() {
      throw new Error("Unused");
    },
  });
  const pending = repository.load("project", "design");
  repository.invalidate("project", [file("new")]);
  read.resolve(file("old"));
  expect((await pending).version).toBe("new");
  expect(reads).toBe(2);

  const later = deferred<LocalDesign>();
  const second = new DesignRepository({
    readDesign: () => later.promise,
    async updateDesign() {
      return file("accepted");
    },
  });
  const opening = second.load("project", "design");
  second.put("project", file("accepted"));
  later.resolve(file("old"));
  expect((await opening).version).toBe("accepted");
});

test("invalid external JSON retains the last accepted design and a retry clears the refresh error", async () => {
  let invalid = false;
  const repository = new DesignRepository({
    async readDesign() {
      if (invalid) throw new Error("Invalid design JSON");
      return file("valid");
    },
    async updateDesign() {
      throw new Error("Unused");
    },
  });
  const accepted = await repository.load("project", "design");
  invalid = true;
  repository.invalidate("project", []);
  await expect(repository.load("project", "design")).rejects.toThrow("Invalid design JSON");
  expect(repository.get("project", "design").value).toBe(accepted);
  expect(repository.get("project", "design").error).toBe("Invalid design JSON");
  invalid = false;
  await repository.load("project", "design");
  expect(repository.get("project", "design").error).toBeUndefined();
});

test("an obsolete failed read cannot attach an error to a newer accepted document", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<LocalDesign>((_resolve, fail) => {
    reject = fail;
  });
  const repository = new DesignRepository({
    readDesign: () => pending,
    async updateDesign() {
      return file("new");
    },
  });
  const opening = repository.load("project", "design");
  repository.put("project", file("new"));
  reject(new Error("Old read failed"));
  expect((await opening).version).toBe("new");
  expect(repository.get("project", "design").error).toBeUndefined();
});

test("a disk update overtaking a write response is reconciled and a stale editor base is never upgraded silently", async () => {
  const mutation = deferred<LocalDesign>();
  const expected: string[] = [];
  const repository = new DesignRepository({
    async readDesign() {
      return file("external");
    },
    async updateDesign(input) {
      expected.push(input.expectedVersion);
      return mutation.promise;
    },
  });
  repository.put("project", file("base"));
  const change = repository.update("project", "design", { name: "Edit" }, "base");
  await Promise.resolve();
  repository.invalidate("project", [file("external")]);
  mutation.resolve(file("response"));
  await change;
  repository.put("project", file("response")); // A consuming surface may acknowledge it too.
  expect((await repository.load("project", "design")).version).toBe("external");
  expect(expected).toEqual(["base"]);
  await repository.update("project", "design", { name: "Stale edit" }, "base");
  expect(expected).toEqual(["base", "base"]);
});
