import type { DesignSummary, Thread } from "./contracts";

/** Only known project designs explicitly referenced or reported by this thread's tools. */
export function workingDesignIds(
  thread: Pick<Thread, "designIds" | "toolActivities">,
  designs: DesignSummary[],
) {
  const ids = new Set(thread.designIds);
  const paths = new Map(designs.map((design) => [design.path.replaceAll("\\", "/"), design.id]));
  const relativePaths = new Map(
    designs.map((design) => [`.tidy/designs/${design.id}.json`, design.id]),
  );
  for (const tool of thread.toolActivities ?? []) {
    for (const file of tool.files ?? []) {
      const path = file.path.replaceAll("\\", "/").replace(/^\.\//, "");
      const id = paths.get(path) ?? relativePaths.get(path);
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
