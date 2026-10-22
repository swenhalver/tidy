import { expect, test } from "bun:test";
import { workingDesignIds } from "../shared/working-files";
import type { DesignSummary, Thread } from "../shared/contracts";

test("working files include explicit references and actual tool-reported local designs without guessing from other threads", () => {
  const designs = ["reference", "new", "unrelated"].map((id): DesignSummary => ({
    id,
    name: id,
    path: `/project/.tidy/designs/${id}.json`,
    updatedAt: "now",
  }));
  const tool = (path: string) => ({ files: [{ path, kind: "added" }] });
  const thread = {
    designIds: ["reference", "deleted"],
    toolActivities: [
      tool("./.tidy/designs/new.json"),
      tool("/project/.tidy/designs/reference.json"),
      tool("/other/.tidy/designs/unrelated.json"),
      tool("../.tidy/designs/unrelated.json"),
    ],
  } as Pick<Thread, "designIds" | "toolActivities">;
  expect(workingDesignIds(thread, designs)).toEqual(["reference", "deleted", "new"]);
});
