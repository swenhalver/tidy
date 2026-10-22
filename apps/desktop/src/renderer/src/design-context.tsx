import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { DesktopAPI } from "../../shared/contracts";
import { DesignRepository } from "./design-repository";

const Context = createContext<DesignRepository | null>(null);

export function DesignProvider({ api, children }: { api: DesktopAPI; children: ReactNode }) {
  const repository = useMemo(() => new DesignRepository(api), [api]);
  useEffect(
    () =>
      api.onEvent((event) => {
        if (event.type === "designs") repository.invalidate(event.projectId, event.designs);
      }),
    [api, repository],
  );
  return <Context.Provider value={repository}>{children}</Context.Provider>;
}

export function useDesignRepository() {
  const repository = useContext(Context);
  if (!repository) throw new Error("Design surfaces require a document repository.");
  return repository;
}

export function useDesign(projectId: string, id: string, enabled = true) {
  const repository = useDesignRepository();
  const subscribe = useCallback(
    (listener: () => void) => (enabled ? repository.subscribe(projectId, id, listener) : () => {}),
    [repository, projectId, id, enabled],
  );
  const get = useCallback(() => repository.get(projectId, id), [repository, projectId, id]);
  const snapshot = useSyncExternalStore(subscribe, get);
  useEffect(() => {
    if (enabled) void repository.load(projectId, id).catch(() => {});
  }, [repository, projectId, id, enabled]);
  return snapshot;
}
