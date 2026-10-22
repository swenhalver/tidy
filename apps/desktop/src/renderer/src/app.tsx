import { errorMessage } from "@tidy/ui/errors";
import { showToast, dismissToast } from "@tidy/ui/toast";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  memo,
  type ReactNode,
} from "react";
import { Button } from "@tidy/ui/button";
import { SelectMenu } from "@tidy/ui/select-menu";
import { TidyLogo } from "@tidy/ui/tidy-logo";
import { Icon } from "@tidy/editor/components/ui/icon";
import { LocalCanvas, type LocalCanvasHandle } from "./local-canvas";
import { useDesign, useDesignRepository } from "./design-context";
import { WorkingPane, type WorkingSurface } from "./working-pane";
import { workingDesignIds } from "../../shared/working-files";
import { Conversation } from "./conversation";
import { ThreadSidebar, type ThreadOrderControls } from "./thread-sidebar";
import { ApprovalRequests } from "./approval-requests";
import { AttachmentList } from "./message-attachments";
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_IMAGE_BYTES,
  MAX_ATTACHMENT_TOTAL_BYTES,
  type AttachedFile,
} from "../../shared/attachments";
import { ProjectFiles } from "./project-files";
import { HarnessControls } from "./harness-controls";
import { ThreadCard } from "./thread-card";
import { MessageQueue } from "./message-queue";
import { MessageActionIcon } from "./message-action-icon";
import { useMessageQueue } from "./use-message-queue";
import { MAX_QUEUED_MESSAGES, type MessageDelivery } from "../../shared/message-queue";
import { AppUpdate } from "./app-update";
import type { HarnessDetails, HarnessSettings } from "../../shared/harness-settings";
import { summarizeThread, applyThreadPatch, applyProjectEvent } from "../../shared/thread-updates";
import type {
  DesktopEvent,
  DesignSummary,
  HarnessConnection,
  HarnessId,
  LocalDesign,
  Project,
  ProjectSnapshot,
  Thread,
  ThreadSummary,
} from "../../shared/contracts";

type WorkspaceView = "files" | "thread" | "design";
type Draft = {
  text: string;
  harness: HarnessId;
  designIds: string[];
  settings?: HarnessSettings;
  attachments?: AttachedFile[];
};
const emptyDraft: Draft = { text: "", harness: "codex", designIds: [] };
const errorText = (error: unknown) =>
  errorMessage(error, "The operation could not be completed. Please try again.");

export function App() {
  const api = window.tidy;
  const repository = useDesignRepository();
  const [views, setViews] = useState<Record<string, WorkspaceView>>({});
  const [threadPanels, setThreadPanels] = useState<Record<string, boolean>>({});
  const [workingSurfaces, setWorkingSurfaces] = useState<Record<string, WorkingSurface>>({});
  const [previewURLs, setPreviewURLs] = useState<Record<string, string>>({});
  const [canvasReturns, setCanvasReturns] = useState<Record<string, "files" | "thread">>({});
  const canvas = useRef<LocalCanvasHandle>(null);
  const [canvasSelection, setCanvasSelection] = useState<{
    fileId: string;
    pageId: string;
    nodeIds: string[];
  }>();
  const preparing = useRef(new Map<string, { cancelled: boolean }>());
  const [designNavigation, setDesignNavigation] = useState<HTMLElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const projectFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (opening) return;
    const previous = projectFocus.current;
    projectFocus.current = null;
    if (previous?.isConnected && document.activeElement === document.body) previous.focus();
  }, [opening]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<Record<string, ProjectSnapshot>>({});
  const [harnesses, setHarnesses] = useState<HarnessConnection[]>([]);
  const [threads, setThreads] = useState<Record<string, Thread>>({});
  const [selectedThreads, setSelectedThreads] = useState<Record<string, string | null>>({});
  const [selectedDesigns, setSelectedDesigns] = useState<Record<string, string | null>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [harnessDetails, setHarnessDetails] = useState<
    Record<string, { info?: HarnessDetails; error?: string; loading: boolean }>
  >({});
  const [settingsPending, setSettingsPending] = useState<Record<string, boolean>>({});
  const detailRequests = useRef<Record<string, number>>({});
  const [now, setNow] = useState(Date.now);
  const [updatingDone, setUpdatingDone] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState<Record<string, boolean>>({});
  const pendingStarts = useRef(new Map<string, Promise<Thread>>());
  const failedStarts = useRef(new Set<string>());
  const sendingKeys = useRef(new Set<string>());
  const [uploading, setUploading] = useState<Record<string, number>>({});
  const uploads = useRef<Record<string, Promise<void>>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<{
    original?: unknown;
    projectId?: string;
    text: string;
  } | null>(null);
  const navigation = useRef(0);
  const threadSelection = useRef<Record<string, number>>({});
  const snapshot = activeProjectId ? snapshots[activeProjectId] : undefined;
  const project = snapshot?.project;
  const selectedThreadId = project ? selectedThreads[project.id] : null;
  const thread = selectedThreadId ? threads[selectedThreadId] : undefined;
  const selectedSummary = snapshot?.threads.find((item) => item.id === selectedThreadId);
  const view = project ? (views[project.id] ?? "files") : "files";
  const selectedDesignId = project ? selectedDesigns[project.id] : null;
  const threadVisible =
    view === "thread" || (view === "design" && Boolean(project && threadPanels[project.id]));
  const draftKey = `${project?.id ?? ""}:${selectedThreadId ?? (view === "design" && selectedDesignId ? `new:${selectedDesignId}` : "new")}`;
  const readyHarness = harnesses.find((item) => item.status === "ready")?.id ?? "codex";
  const draft = drafts[draftKey] ?? {
    ...emptyDraft,
    harness: readyHarness,
    designIds: !selectedThreadId && view === "design" && selectedDesignId ? [selectedDesignId] : [],
  };
  const designSnapshot = useMemo(
    () => (snapshot ? { ...snapshot, threads: [] } : undefined),
    [snapshot?.project, snapshot?.designs, snapshot?.folders],
  );
  const backToFiles = useCallback(() => {
    if (project)
      setViews((current) => ({ ...current, [project.id]: canvasReturns[project.id] ?? "files" }));
  }, [project?.id, canvasReturns]);
  const design = snapshot?.designs.find((item) => item.id === selectedDesignId);
  const workingIds = useMemo(
    () =>
      (thread || selectedSummary) && snapshot
        ? workingDesignIds(thread ?? selectedSummary!, snapshot.designs)
        : draft.designIds,
    [
      thread?.designIds,
      thread?.toolActivities,
      selectedSummary?.designIds,
      snapshot?.designs,
      draft.designIds,
    ],
  );
  const workingKey = `${project?.id ?? ""}:${selectedThreadId ?? "new"}`;
  const workingSurface = workingSurfaces[workingKey];
  const previewURL = previewURLs[workingKey];
  const previewAvailable = workingSurface === "preview" || Boolean(previewURL);
  const changeWorkingSurface = useCallback(
    (surface: WorkingSurface) => {
      setWorkingSurfaces((current) => ({ ...current, [workingKey]: surface }));
    },
    [workingKey],
  );
  const changePreviewURL = useCallback(
    (url: string) => {
      setPreviewURLs((current) => ({ ...current, [workingKey]: url }));
    },
    [workingKey],
  );
  const hasWorkingFiles =
    previewAvailable ||
    workingIds.length > 0 ||
    Boolean(thread?.toolActivities?.some((tool) => tool.kind === "edit" || tool.files?.length));
  const showSurface = view !== "thread" || hasWorkingFiles;
  const openDesign = useCallback(
    (projectId: string, id: string, from: "files" | "thread") => {
      setSelectedDesigns((current) => ({ ...current, [projectId]: id }));
      setViews((current) => ({ ...current, [projectId]: "design" }));
      setCanvasReturns((current) => ({ ...current, [projectId]: from }));
      setThreadPanels((current) => ({ ...current, [projectId]: from === "thread" }));
      void repository.load(projectId, id).catch(() => {});
    },
    [repository],
  );
  const openWorkingDesign = useCallback(
    (id: string) => {
      if (project) openDesign(project.id, id, "thread");
    },
    [project?.id, openDesign],
  );
  const browseFiles = useCallback(() => {
    if (project) setViews((current) => ({ ...current, [project.id]: "files" }));
  }, [project?.id]);
  const busy = Boolean(sending[draftKey] && thread?.status !== "running");

  const selectedHarness = thread?.harness ?? draft.harness;
  const harnessReady = harnesses.some(
    (item) => item.id === selectedHarness && item.status === "ready",
  );
  const detailKey = `${project?.id ?? ""}:${selectedHarness}`;
  const currentDetails = harnessDetails[detailKey];

  const queue = useMessageQueue({
    api,
    thread,
    waitForStart: (id) => pendingStarts.current.get(id),
    onThread(value) {
      setThreads((current) =>
        (current[value.id]?.revision ?? -1) > value.revision
          ? current
          : { ...current, [value.id]: value },
      );
      setSnapshots((current) => {
        const entry = current[value.projectId];
        return entry
          ? {
              ...current,
              [value.projectId]: applyProjectEvent(entry, { type: "thread", thread: value }),
            }
          : current;
      });
    },
    onError: (projectId, cause) => setError({ projectId, text: errorText(cause), original: cause }),
    onRecover(target, message) {
      const key = `${target.projectId}:${failedStarts.current.has(target.id) ? "new" : target.id}`;
      setDrafts((current) => {
        const previous = current[key] ?? { ...emptyDraft, harness: target.harness };
        return {
          ...current,
          [key]: {
            ...previous,
            text: [previous.text, message.text].filter(Boolean).join("\n\n"),
            designIds: [...new Set([...previous.designIds, ...(message.designIds ?? [])])],
            attachments: [...(previous.attachments ?? []), ...(message.attachments ?? [])].filter(
              (file, index, all) => all.findIndex((item) => item.id === file.id) === index,
            ),
          },
        };
      });
    },
  });
  const hasMessage = Boolean(draft.text.trim() || draft.attachments?.length);
  const running = thread?.status === "running" || queue.stopping;
  const submitLabel = busy
    ? "Starting…"
    : running || queue.messages.length
      ? "Queue"
      : thread
        ? "Send"
        : "Start thread";
  const canSend =
    hasMessage &&
    !uploading[draftKey] &&
    !busy &&
    !thread?.doneAt &&
    harnessReady &&
    !(selectedThreadId && !thread) &&
    !(thread && settingsPending[thread.id]);

  async function loadHarnessDetails(projectId: string, harness: HarnessId, refresh = false) {
    if (!api) return;
    const key = `${projectId}:${harness}`;
    const version = (detailRequests.current[key] ?? 0) + 1;
    detailRequests.current[key] = version;
    setHarnessDetails((current) => ({
      ...current,
      [key]: { ...current[key], loading: true, error: undefined },
    }));
    try {
      const info = await api.harnessDetails(projectId, harness, refresh);
      if (detailRequests.current[key] === version)
        setHarnessDetails((current) => ({
          ...current,
          [key]: { info, loading: false },
        }));
    } catch (cause) {
      if (detailRequests.current[key] === version)
        setHarnessDetails((current) => ({
          ...current,
          [key]: { ...current[key], error: errorText(cause), loading: false },
        }));
    }
  }
  useEffect(() => {
    if (api && project && harnessReady) void loadHarnessDetails(project.id, selectedHarness);
  }, [api, project?.id, selectedHarness, harnessReady]);

  async function changeSettings(settings: HarnessSettings) {
    if (!thread) {
      updateDraft({ settings });
      return;
    }
    if (!api || !project || running || settingsPending[thread.id]) return;
    const previous = thread,
      projectId = project.id;
    const optimistic = { ...thread, settings, revision: thread.revision + 1 };
    const apply = (value: Thread) => {
      setThreads((current) =>
        (current[value.id]?.revision ?? -1) > value.revision
          ? current
          : { ...current, [value.id]: value },
      );
      setSnapshots((current) => {
        const entry = current[projectId];
        return !entry
          ? current
          : {
              ...current,
              [projectId]: {
                ...entry,
                threads: entry.threads.map((item) =>
                  item.id === value.id && item.revision <= value.revision
                    ? summarizeThread(value)
                    : item,
                ),
              },
            };
      });
    };
    setSettingsPending((current) => ({ ...current, [thread.id]: true }));
    apply(optimistic);
    try {
      apply(await api.setThreadSettings(projectId, thread.id, settings));
    } catch (cause) {
      const matches = (value: ThreadSummary) =>
        value.revision === optimistic.revision &&
        value.status === optimistic.status &&
        JSON.stringify(value.settings) === JSON.stringify(settings);
      setThreads((current) =>
        current[previous.id] && matches(current[previous.id])
          ? { ...current, [previous.id]: previous }
          : current,
      );
      setSnapshots((current) => {
        const entry = current[projectId];
        return !entry
          ? current
          : {
              ...current,
              [projectId]: {
                ...entry,
                threads: entry.threads.map((item) =>
                  item.id === previous.id && matches(item) ? summarizeThread(previous) : item,
                ),
              },
            };
      });
      setError({ projectId, text: errorText(cause), original: cause });
    } finally {
      setSettingsPending((current) => ({ ...current, [previous.id]: false }));
    }
  }

  useEffect(() => {
    const updateTime = () => setNow(Date.now());
    const timer = window.setInterval(updateTime, 60_000);
    window.addEventListener("focus", updateTime);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateTime);
    };
  }, []);

  function updateDraft(patch: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [draftKey]: { ...draft, ...patch },
    }));
  }

  const selectThread = useCallback(
    (projectId: string, threadId: string | null, keepFile = false) => {
      threadSelection.current[projectId] = (threadSelection.current[projectId] ?? 0) + 1;
      setSelectedThreads((current) => ({ ...current, [projectId]: threadId }));
      if (!keepFile) setViews((current) => ({ ...current, [projectId]: "thread" }));
      setThreadPanels((current) => ({ ...current, [projectId]: true }));
    },
    [],
  );

  const toggleFileThread = useCallback(() => {
    if (!project || !selectedDesignId) return;
    if (threadPanels[project.id]) {
      setThreadPanels((current) => ({ ...current, [project.id]: false }));
      return;
    }
    const related = snapshot?.threads.find(
      (item) => !item.doneAt && item.designIds.includes(selectedDesignId),
    );
    const current = snapshot?.threads.find((item) => item.id === selectedThreadId);
    selectThread(
      project.id,
      current?.designIds.includes(selectedDesignId) ? current.id : (related?.id ?? null),
      true,
    );
  }, [
    project?.id,
    selectedDesignId,
    selectedThreadId,
    snapshot?.threads,
    threadPanels,
    selectThread,
  ]);

  const threadToggleAction = useRef(toggleFileThread);
  threadToggleAction.current = toggleFileThread;
  const toggleThreadPanel = useCallback(() => threadToggleAction.current(), []);
  const fileThreadControl = useMemo(
    () => (
      <Button
        className="secondary-button file-thread-toggle"
        aria-expanded={threadVisible}
        aria-controls="thread-pane"
        onClick={toggleThreadPanel}
      >
        Threads
      </Button>
    ),
    [threadVisible, toggleThreadPanel],
  );

  function applySnapshot(value: ProjectSnapshot) {
    setSnapshots((current) => {
      const summaries = new Map(value.threads.map((item) => [item.id, item]));
      for (const item of current[value.project.id]?.threads ?? []) {
        if ((summaries.get(item.id)?.revision ?? -1) < item.revision) summaries.set(item.id, item);
      }
      return {
        ...current,
        [value.project.id]: {
          ...value,
          threads: [...summaries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        },
      };
    });
    setProjects((current) => [
      value.project,
      ...current.filter((item) => item.id !== value.project.id),
    ]);
    setActiveProjectId(value.project.id);
  }

  useEffect(() => {
    if (!api) {
      setLoading(false);
      return;
    }
    let mounted = true;
    let bootstrapping = true;
    const initialEvents = new Map<string, DesktopEvent>();
    const unsubscribe = api.onEvent((event) => {
      if (!mounted) return;
      if (bootstrapping) {
        const key = event.type === "designs" ? event.projectId : event.thread.id;
        const previous = initialEvents.get(key);
        if (
          event.type === "designs" ||
          !previous ||
          previous.type === "designs" ||
          previous.thread.revision <= event.thread.revision
        )
          initialEvents.set(key, event);
      }
      if (event.type === "thread" || event.type === "thread-patch") {
        const value = event.thread;
        setThreads((current) => {
          const previous = current[value.id];
          if (event.type === "thread-patch")
            return previous
              ? { ...current, [value.id]: applyThreadPatch(previous, event) }
              : current;
          return {
            ...current,
            [value.id]: (previous?.revision ?? -1) > value.revision ? previous : event.thread,
          };
        });
      }
      const projectId = event.type === "designs" ? event.projectId : event.thread.projectId;
      setSnapshots((current) => {
        const entry = current[projectId];
        return entry ? { ...current, [projectId]: applyProjectEvent(entry, event) } : current;
      });
    });
    void api
      .bootstrap()
      .then((value) => {
        if (!mounted) return;
        setProjects(value.projects);
        setHarnesses(value.harnesses);
        if (value.activeProject) {
          const snapshot = [...initialEvents.values()].reduce(
            applyProjectEvent,
            value.activeProject,
          );
          setSnapshots((current) => ({ ...current, [snapshot.project.id]: snapshot }));
          setActiveProjectId(value.activeProject.project.id);
        }
        bootstrapping = false;
        initialEvents.clear();
      })
      .catch((value) => {
        if (mounted) setError({ text: errorText(value), original: value });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [api]);

  useEffect(() => {
    if (!api || !project || !selectedThreadId || threads[selectedThreadId]) return;
    let active = true;
    void api
      .readThread(project.id, selectedThreadId)
      .then((value) => {
        if (active)
          setThreads((current) => ({
            ...current,
            [value.id]: current[value.id] ?? value,
          }));
      })
      .catch((value) => {
        if (active) setError({ projectId: project.id, text: errorText(value), original: value });
      });
    return () => {
      active = false;
    };
  }, [api, project, selectedThreadId, threads]);

  async function chooseProject(projectId?: string) {
    if (!api || opening) return;
    projectFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const generation = ++navigation.current;
    setOpening(true);
    setError(null);
    try {
      const value = projectId ? await api.selectProject(projectId) : await api.openProject();
      if (value && navigation.current === generation) applySnapshot(value);
    } catch (value) {
      setError({ text: errorText(value), original: value });
    } finally {
      if (navigation.current === generation) setOpening(false);
    }
  }

  const updateLocalDesign = useCallback(
    (value: LocalDesign) => {
      repository.put(activeProjectId!, value);
      setSnapshots((current) => {
        const entry = current[activeProjectId!];
        if (!entry) return current;
        const summary: DesignSummary = {
          id: value.id,
          name: value.name,
          path: value.path,
          updatedAt: value.updatedAt,
          folderId: value.folderId,
          nodeCount: value.nodeCount,
          version: value.version,
        };
        return {
          ...current,
          [entry.project.id]: {
            ...entry,
            designs: [summary, ...entry.designs.filter((item) => item.id !== value.id)].sort(
              (a, b) => b.updatedAt.localeCompare(a.updatedAt),
            ),
          },
        };
      });
    },
    [activeProjectId, repository],
  );

  function attachFiles(files: File[]) {
    if (!api || !project || thread?.doneAt || busy || !files.length) return;
    const projectId = project.id,
      key = draftKey,
      fallback = draft;
    setUploading((current) => ({ ...current, [key]: (current[key] ?? 0) + 1 }));
    const queued = (uploads.current[key] ?? Promise.resolve())
      .then(async () => {
        const attached = [...(draftsRef.current[key]?.attachments ?? fallback.attachments ?? [])];
        const errors: string[] = [];
        for (const file of files) {
          if (attached.length >= MAX_ATTACHMENTS) {
            errors.push("Attach up to 10 files per message.");
            break;
          }
          const image = ["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type);
          if (file.size > (image ? MAX_IMAGE_BYTES : MAX_ATTACHMENT_BYTES)) {
            errors.push(
              `${file.name}: choose ${image ? "an image under 5 MB" : "a file under 20 MB"}.`,
            );
            continue;
          }
          if (
            attached.reduce((total, value) => total + value.size, file.size) >
            MAX_ATTACHMENT_TOTAL_BYTES
          ) {
            errors.push("Keep attachments under 25 MB per message.");
            continue;
          }
          try {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("Could not read this file."));
              reader.readAsDataURL(file);
            });
            const value = await api.addAttachment(
              projectId,
              file.name.slice(0, 200) || "Pasted image.png",
              dataUrl,
            );
            attached.push(value);
            setDrafts((current) => ({
              ...current,
              [key]: {
                ...(current[key] ?? fallback),
                attachments: [...(current[key]?.attachments ?? fallback.attachments ?? []), value],
              },
            }));
          } catch (cause) {
            errors.push(errorText(cause));
          }
        }
        if (errors.length) setError({ projectId, text: [...new Set(errors)].join(" ") });
      })
      .finally(() => {
        setUploading((current) => ({
          ...current,
          [key]: Math.max(0, (current[key] ?? 1) - 1),
        }));
      });
    uploads.current[key] = queued.catch(() => {});
  }

  async function send(delivery: MessageDelivery = "queue") {
    if (
      !api ||
      !project ||
      (!draft.text.trim() && !draft.attachments?.length) ||
      !harnessReady ||
      (selectedThreadId && !thread) ||
      (!running && sendingKeys.current.has(draftKey)) ||
      uploading[draftKey] ||
      busy ||
      thread?.doneAt ||
      (thread && settingsPending[thread.id])
    )
      return;
    const canvasHandle = view === "design" ? canvas.current : null;
    const references = [
      ...new Set([
        ...draft.designIds,
        ...(canvasHandle && selectedDesignId ? [selectedDesignId] : []),
      ]),
    ];
    if (thread && (running || queue.messages.length > 0)) {
      if (queue.messages.length >= MAX_QUEUED_MESSAGES) {
        setError({
          projectId: project.id,
          text: "The queue is full. Remove a message before adding another.",
        });
        return;
      }
      queue.enqueue(
        {
          id: crypto.randomUUID(),
          text: draft.text,
          attachments: draft.attachments,
          designIds: references,
        },
        delivery,
        canvasHandle ? () => canvasHandle.captureContext() : undefined,
      );
      setDrafts((current) => ({ ...current, [draftKey]: { ...draft, text: "", attachments: [] } }));
      return;
    }
    const projectId = project.id;
    const key = draftKey;
    const submitted = draft.text;
    const selection = threadSelection.current[projectId] ?? 0;
    const id = selectedThreadId ?? crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const pendingKey = `${projectId}:${id}`;
    const optimistic: Thread = {
      ...(thread ?? {
        id,
        projectId,
        harness: draft.harness,
        settings: draft.settings,
        title:
          submitted.replace(/\s+/g, " ").slice(0, 80) ||
          draft.attachments?.[0]?.name ||
          "New thread",
        designIds: references,
        messages: [],
        revision: 0,
      }),
      revision: (thread?.revision ?? 0) + 1,
      designIds: [...new Set([...(thread?.designIds ?? []), ...references])],
      messages: [
        ...(thread?.messages ?? []),
        {
          id: messageId,
          role: "user",
          text: submitted,
          ...(draft.attachments?.length ? { attachments: draft.attachments } : {}),
        },
      ],
      status: "running",
      activity: "Starting",
      error: undefined,
      updatedAt: new Date().toISOString(),
    };
    const preparation = { cancelled: false };
    preparing.current.set(id, preparation);
    sendingKeys.current.add(key);
    setSending((current) => ({ ...current, [key]: true }));
    setThreads((current) => ({ ...current, [id]: optimistic }));
    setSnapshots((current) => {
      const entry = current[projectId];
      return entry
        ? {
            ...current,
            [projectId]: {
              ...entry,
              threads: [
                summarizeThread(optimistic),
                ...entry.threads.filter((item) => item.id !== id),
              ],
            },
          }
        : current;
    });
    setDrafts((current) => ({
      ...current,
      [key]: { ...draft, text: "", attachments: [] },
      ...(id !== selectedThreadId ? { [pendingKey]: { ...draft, text: "", attachments: [] } } : {}),
    }));
    setSelectedThreads((current) => ({ ...current, [projectId]: id }));
    setError(null);
    try {
      const request = (async () => {
        const designContext = await canvasHandle?.captureContext();
        if (preparation.cancelled) throw new Error("The turn was stopped before it started.");
        preparing.current.delete(id);
        return selectedThreadId
          ? api.sendMessage({
              projectId,
              threadId: id,
              messageId,
              text: submitted,
              designContext,
              designIds: references,
              attachmentIds: draft.attachments?.map((file) => file.id),
            })
          : api.startThread({
              projectId,
              threadId: id,
              messageId,
              harness: draft.harness,
              prompt: submitted,
              designIds: references,
              designContext,
              settings: draft.settings,
              attachmentIds: draft.attachments?.map((file) => file.id),
            });
      })();
      pendingStarts.current.set(id, request);
      const value = await request;
      setThreads((current) => ({
        ...current,
        [value.id]:
          (current[value.id]?.revision ?? -1) > value.revision ? current[value.id] : value,
      }));
      if ((threadSelection.current[projectId] ?? 0) === selection)
        setSelectedThreads((current) => ({
          ...current,
          [projectId]: value.id,
        }));
    } catch (value) {
      // Remove only this pending turn. Preserve navigation, newer drafts and native events.
      if (!thread) failedStarts.current.add(id);
      setThreads((current) => {
        if (
          current[id]?.revision !== optimistic.revision ||
          current[id]?.updatedAt !== optimistic.updatedAt
        )
          return current;
        const next = { ...current };
        if (thread) next[id] = thread;
        else delete next[id];
        return next;
      });
      setSnapshots((current) => {
        const entry = current[projectId];
        if (!entry) return current;
        return {
          ...current,
          [projectId]: {
            ...entry,
            threads: entry.threads.flatMap((item) =>
              item.id !== id ||
              item.revision !== optimistic.revision ||
              item.updatedAt !== optimistic.updatedAt
                ? [item]
                : thread
                  ? [summarizeThread(thread)]
                  : [],
            ),
          },
        };
      });
      setDrafts((current) => ({
        ...current,
        [key]: {
          ...draft,
          ...(current[key] ?? {}),
          text: [
            submitted,
            current[key]?.text,
            ...(pendingKey !== key ? [current[pendingKey]?.text] : []),
          ]
            .filter(Boolean)
            .join("\n\n"),
          attachments: [
            ...(draft.attachments ?? []),
            ...(current[key]?.attachments ?? []),
            ...(pendingKey !== key ? (current[pendingKey]?.attachments ?? []) : []),
          ].filter((file, index, all) => all.findIndex((item) => item.id === file.id) === index),
        },
      }));
      if (!thread)
        setSelectedThreads((current) =>
          current[projectId] === id ? { ...current, [projectId]: null } : current,
        );
      if (!preparation.cancelled) setError({ projectId, text: errorText(value), original: value });
    } finally {
      pendingStarts.current.delete(id);
      preparing.current.delete(id);
      sendingKeys.current.delete(key);
      setSending((current) => ({ ...current, [key]: false }));
    }
  }

  const toggleThreadDone = useCallback(
    async (item: ThreadSummary) => {
      if (!api || !project || updatingDone[item.id] || item.status === "running") return;
      const projectId = project.id;
      const next = {
        ...item,
        revision: item.revision + 1,
        doneAt: item.doneAt ? undefined : new Date().toISOString(),
      };
      function apply(summary: ThreadSummary) {
        setSnapshots((current) => {
          const entry = current[projectId];
          if (!entry) return current;
          return {
            ...current,
            [projectId]: {
              ...entry,
              threads: entry.threads.map((value) =>
                value.id === summary.id && value.revision <= summary.revision ? summary : value,
              ),
            },
          };
        });
        setThreads((current) => {
          const value = current[summary.id];
          return value && value.revision <= summary.revision
            ? {
                ...current,
                [summary.id]: {
                  ...value,
                  doneAt: summary.doneAt,
                  revision: summary.revision,
                },
              }
            : current;
        });
      }
      setUpdatingDone((current) => ({ ...current, [item.id]: true }));
      apply(next);
      try {
        const value = await api.setThreadDone(projectId, item.id, Boolean(next.doneAt));
        apply(summarizeThread(value));
      } catch (cause) {
        // Roll back only this optimistic change, without undoing a newer thread event.
        const isOptimistic = (value: ThreadSummary) =>
          value.revision === next.revision &&
          value.doneAt === next.doneAt &&
          value.status === next.status;
        setSnapshots((current) => {
          const entry = current[projectId];
          if (!entry) return current;
          return {
            ...current,
            [projectId]: {
              ...entry,
              threads: entry.threads.map((value) =>
                value.id === item.id && isOptimistic(value) ? item : value,
              ),
            },
          };
        });
        setThreads((current) => {
          const value = current[item.id];
          return value && isOptimistic(value)
            ? {
                ...current,
                [item.id]: {
                  ...value,
                  doneAt: item.doneAt,
                  revision: item.revision,
                },
              }
            : current;
        });
        setError({ projectId, text: errorText(cause), original: cause });
      } finally {
        setUpdatingDone((current) => ({ ...current, [item.id]: false }));
      }
    },
    [api, project, updatingDone],
  );

  async function stop() {
    if (!api || !project || !thread) return;
    const preparation = preparing.current.get(thread.id);
    if (preparation) preparation.cancelled = true;
    queue.stop();
  }

  async function refreshHarnesses() {
    if (!api) return;
    try {
      setHarnesses(await api.checkHarnesses());
    } catch (value) {
      setError({ text: errorText(value), original: value });
    }
  }

  const renderThread = useCallback(
    (item: ThreadSummary, orderControls?: ThreadOrderControls) => (
      <ThreadCard
        thread={item}
        orderControls={orderControls}
        selected={selectedThreadId === item.id}
        now={now}
        pending={Boolean(updatingDone[item.id] || settingsPending[item.id])}
        onSelect={() =>
          selectThread(
            project!.id,
            item.id,
            view === "design" &&
              Boolean(selectedDesignId && item.designIds.includes(selectedDesignId)),
          )
        }
        onDone={() => void toggleThreadDone(item)}
        modelName={
          harnessDetails[`${project?.id}:${item.harness}`]?.info?.models.find(
            (model) => model.id === (item.settings?.model ?? item.actualModel),
          )?.name
        }
        designNames={item.designIds.map(
          (id) => snapshot?.designs.find((design) => design.id === id)?.name ?? "Design reference",
        )}
      />
    ),
    [
      selectedThreadId,
      now,
      updatingDone,
      settingsPending,
      selectThread,
      view,
      selectedDesignId,
      project,
      toggleThreadDone,
      harnessDetails,
      snapshot?.designs,
    ],
  );
  useEffect(() => {
    if (!error || (error.projectId && error.projectId !== activeProjectId)) return;
    const id = showToast(error.text, "error", () => setError(null), error);
    return () => dismissToast(id);
  }, [error, activeProjectId]);

  const projectFiles = useMemo(() => {
    const project = designSnapshot?.project;
    if (!api || !designSnapshot || !project) return null;
    return (
      <ProjectFiles
        key={project.id}
        api={api}
        snapshot={designSnapshot}
        navigationTarget={designNavigation}
        onBrowse={browseFiles}
        browsing={view === "files"}
        onOpen={(id) => openDesign(project.id, id, "files")}
        onCreated={(value) => {
          updateLocalDesign(value);
          openDesign(project.id, value.id, "files");
        }}
        onUpdate={updateLocalDesign}
        onFolderUpdate={(folder) =>
          setSnapshots((current) => {
            const entry = current[project.id];
            return {
              ...current,
              [project.id]: {
                ...entry,
                folders: [folder, ...(entry.folders ?? []).filter((item) => item.id !== folder.id)],
              },
            };
          })
        }
      />
    );
  }, [api, designSnapshot, designNavigation, updateLocalDesign, view, browseFiles, openDesign]);

  return (
    <div className="desktop connected-desktop">
      <aside className="desktop-navigation" aria-label="Project workspace">
        <header className="workspace-header">
          <div className="project-picker" title={project?.name}>
            {project && (
              <SelectMenu
                value={project.id}
                options={[
                  ...projects.map((item) => ({
                    value: item.id,
                    label: item.name,
                  })),
                  { value: "open", label: "Open project…" },
                ]}
                label="Project"
                disabled={opening}
                onChange={(value) => void chooseProject(value === "open" ? undefined : value)}
                triggerClassName="project-trigger"
              />
            )}
          </div>
        </header>
        {project && snapshot && (
          <>
            <nav
              ref={setDesignNavigation}
              className="design-navigation"
              aria-label="Files and folders"
            />
            <div className="thread-navigation">
              <ThreadSidebar
                key={project.id}
                projectId={project.id}
                threads={snapshot.threads}
                onNew={() => selectThread(project.id, null, view === "design")}
                renderThread={renderThread}
              />
            </div>
          </>
        )}
        <AppUpdate api={api} />
      </aside>
      <main className="workspace">
        {!project ? (
          <div className="project-home">
            <h1 aria-label="Tidy">
              <TidyLogo className="tidy-logo" />
            </h1>
            {loading ? (
              <p>Opening workspace…</p>
            ) : api ? (
              <>
                <p>Designs and engineering threads, together in your project.</p>
                <Button
                  className="primary-button"
                  disabled={opening}
                  onClick={() => void chooseProject()}
                >
                  {opening ? "Opening…" : "Open project"}
                </Button>
                {projects.length > 0 && (
                  <div className="recent-projects">
                    {projects.map((item) => (
                      <Button
                        key={item.id}
                        className="recent-project"
                        disabled={opening}
                        onClick={() => void chooseProject(item.id)}
                      >
                        <span>{item.name}</span>
                        <small>{item.path}</small>
                      </Button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p>Open Tidy desktop to work with local projects.</p>
            )}
          </div>
        ) : (
          <div
            className={`connected-workspace ${threadVisible ? "with-thread" : ""} ${showSurface ? "with-surface" : ""}`}
            data-view={view}
          >
            <section
              className="work-surface"
              aria-label={
                view === "design"
                  ? "Design editor"
                  : view === "files"
                    ? "Project files"
                    : "Working files"
              }
              hidden={!showSurface}
            >
              <div className="editor-surface" hidden={view !== "design"}>
                {design && (
                  <CanvasSurface
                    key={`${project.id}:${design.id}`}
                    ref={canvas}
                    api={api!}
                    projectId={project.id}
                    fileId={design.id}
                    active={view === "design"}
                    backLabel={
                      canvasReturns[project.id] === "thread" ? "Return to thread" : "Back to files"
                    }
                    onBack={backToFiles}
                    onUpdate={updateLocalDesign}
                    onContextChange={setCanvasSelection}
                    threadControl={fileThreadControl}
                  />
                )}
                {!design && (
                  <div className="working-unavailable">This design is no longer available.</div>
                )}
              </div>
              <div className="project-files-container" hidden={view !== "files"}>
                {projectFiles}
              </div>
              <div className="thread-working-surface" hidden={view !== "thread"}>
                {hasWorkingFiles && (
                  <WorkingPane
                    key={`${project.id}:${selectedThreadId ?? "draft"}`}
                    projectId={project.id}
                    api={api!}
                    surface={workingSurface}
                    onSurfaceChange={changeWorkingSurface}
                    previewURL={previewURL}
                    previewAvailable={previewAvailable}
                    onPreviewURL={changePreviewURL}
                    designs={snapshot.designs}
                    ids={workingIds}
                    thread={thread}
                    active={view === "thread"}
                    onOpen={openWorkingDesign}
                  />
                )}
              </div>
            </section>
            <section
              id="thread-pane"
              className="thread-workspace"
              aria-label="Thread"
              hidden={!threadVisible}
            >
              <div className="content-heading">
                <h1>
                  {thread?.title ??
                    selectedSummary?.title ??
                    (selectedThreadId ? "Opening thread…" : "New thread")}
                </h1>
                {selectedThreadId && !previewAvailable && (
                  <Button
                    className="quiet-button thread-preview-action"
                    onClick={() => {
                      changeWorkingSurface("preview");
                      setViews((current) => ({ ...current, [project.id]: "thread" }));
                    }}
                  >
                    Preview app
                  </Button>
                )}
                {thread?.doneAt && (
                  <Button
                    className="quiet-button thread-heading-action"
                    disabled={running || Boolean(updatingDone[thread.id])}
                    onClick={() => void toggleThreadDone(summarizeThread(thread))}
                  >
                    Reopen thread
                  </Button>
                )}
              </div>
              <Conversation
                key={`${project.id}:${selectedThreadId ?? "draft"}`}
                identity={`${project.id}:${selectedThreadId ?? "draft"}`}
                thread={thread}
                active={threadVisible}
                api={api!}
              />
              {thread?.pendingApprovals?.length && api ? (
                <ApprovalRequests
                  key={thread.id}
                  requests={thread.pendingApprovals}
                  onRespond={async (id, decision) => {
                    const value = await api.respondToApproval(project.id, thread.id, id, decision);
                    setThreads((current) => ({
                      ...current,
                      [value.id]:
                        (current[value.id]?.revision ?? -1) > value.revision
                          ? current[value.id]
                          : value,
                    }));
                  }}
                />
              ) : null}
              {thread && (
                <MessageQueue
                  key={`queue:${thread.id}`}
                  messages={queue.messages}
                  running={running}
                  error={thread.queueError}
                  onChange={queue.change}
                  onRecover={queue.recover}
                />
              )}
              <form
                className="composer"
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes("Files") && !thread?.doneAt)
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  if (event.dataTransfer.files.length) {
                    event.preventDefault();
                    attachFiles(Array.from(event.dataTransfer.files));
                  }
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                {view === "design" && design && (
                  <div className="composer-design-context">
                    <Icon name="frame" size={13} />
                    <span>{design.name}</span>
                    {canvasSelection?.fileId === design.id &&
                      canvasSelection.nodeIds.length > 0 && (
                        <span className="muted">{canvasSelection.nodeIds.length} selected</span>
                      )}
                  </div>
                )}
                {snapshot.designs.length > 0 && (
                  <DesignReferences
                    designs={snapshot.designs}
                    selected={draft.designIds}
                    attached={thread?.designIds}
                    onChange={(designIds) => updateDraft({ designIds })}
                  />
                )}
                <AttachmentList
                  files={draft.attachments ?? []}
                  onRemove={
                    thread?.doneAt
                      ? undefined
                      : (id) =>
                          updateDraft({
                            attachments: draft.attachments?.filter((file) => file.id !== id),
                          })
                  }
                />
                {Boolean(uploading[draftKey]) && (
                  <span className="attachment-progress" role="status">
                    Adding attachments…
                  </span>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  aria-label="Attach files"
                  onChange={(event) => {
                    attachFiles(Array.from(event.currentTarget.files ?? []));
                    event.currentTarget.value = "";
                  }}
                />
                <label className="sr-only" htmlFor="thread-prompt">
                  Message
                </label>
                <textarea
                  id="thread-prompt"
                  value={draft.text}
                  onChange={(event) => updateDraft({ text: event.target.value })}
                  onPaste={(event) => {
                    const files = Array.from(event.clipboardData.files);
                    if (files.length) {
                      event.preventDefault();
                      attachFiles(files);
                    }
                  }}
                  placeholder={
                    thread?.doneAt
                      ? "Reopen this thread to continue…"
                      : running
                        ? "Queue a follow-up, or send it now…"
                        : thread
                          ? "Continue this thread…"
                          : "What would you like to work on?"
                  }
                  disabled={Boolean(thread?.doneAt) || busy}
                  maxLength={32_000}
                  rows={2}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      event.shiftKey &&
                      (event.metaKey || event.ctrlKey) &&
                      running &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      const first = queue.messages[0];
                      if (first && !event.repeat)
                        queue.change({ kind: "steer", messageId: first.id });
                      return;
                    }
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.altKey &&
                      !event.nativeEvent.isComposing &&
                      event.nativeEvent.keyCode !== 229
                    ) {
                      event.preventDefault();
                      if (!event.repeat)
                        void send(event.metaKey || event.ctrlKey ? "steer" : "queue");
                    }
                  }}
                />
                <div className="composer-actions">
                  <Button
                    type="button"
                    className="quiet-button attachment-button"
                    aria-label="Attach files"
                    title="Attach files"
                    disabled={Boolean(thread?.doneAt) || busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none">
                      <path
                        d="m8 13 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </Button>
                  <HarnessControls
                    api={api!}
                    connections={harnesses}
                    harness={selectedHarness}
                    settings={thread?.settings ?? draft.settings ?? {}}
                    actualModel={thread?.actualModel}
                    usage={thread?.usage}
                    details={currentDetails?.info}
                    error={currentDetails?.error}
                    loading={Boolean(currentDetails?.loading)}
                    disabled={Boolean(
                      running || busy || (thread && settingsPending[thread.id]) || thread?.doneAt,
                    )}
                    onHarnessChange={
                      thread ? undefined : (harness) => updateDraft({ harness, settings: {} })
                    }
                    onSettingsChange={(settings) => void changeSettings(settings)}
                    onRefresh={() => {
                      if (project && harnessReady)
                        void loadHarnessDetails(project.id, selectedHarness, true);
                    }}
                  />
                  <span className="composer-spacer" />
                  <div className="composer-delivery">
                    {running && !hasMessage ? (
                      <Button
                        type="button"
                        className="composer-submit composer-stop"
                        aria-label={
                          queue.stopping || thread?.activity === "Stopping" ? "Stopping…" : "Stop"
                        }
                        title={
                          queue.stopping || thread?.activity === "Stopping" ? "Stopping…" : "Stop"
                        }
                        disabled={queue.stopping || thread?.activity === "Stopping"}
                        onClick={() => void stop()}
                      >
                        <MessageActionIcon action="stop" />
                      </Button>
                    ) : (
                      <>
                        {running && (
                          <Button
                            type="button"
                            className="quiet-button composer-steer"
                            disabled={!canSend}
                            title="Use this instruction now (Ctrl/⌘ Enter)"
                            onClick={() => void send("steer")}
                          >
                            <MessageActionIcon action="steer" />
                            Send now
                          </Button>
                        )}
                        <Button
                          type="submit"
                          className="composer-submit"
                          disabled={!canSend}
                          aria-label={submitLabel}
                          title={`${submitLabel} (Enter)`}
                        >
                          {busy ? (
                            <Icon name="more" size={16} />
                          ) : (
                            <MessageActionIcon
                              action={running || queue.messages.length ? "queue" : "send"}
                            />
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {!harnessReady && (
                  <div className="connection-help">
                    <span>
                      {harnesses.find((item) => item.id === selectedHarness)?.name ??
                        "Your harness"}{" "}
                      needs to be installed and signed in locally. Run{" "}
                      <code>
                        {selectedHarness === "codex" ? "codex login" : "claude auth login"}
                      </code>{" "}
                      in your terminal.
                    </span>
                    <Button
                      type="button"
                      className="quiet-button"
                      onClick={() => void refreshHarnesses()}
                    >
                      Check connection
                    </Button>
                  </div>
                )}
              </form>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

function DesignReferences({
  designs,
  selected,
  onChange,
  attached = [],
}: {
  designs: DesignSummary[];
  selected: string[];
  attached?: string[];
  onChange: (value: string[]) => void;
}) {
  return (
    <details className="design-references">
      <summary>Add designs{selected.length ? ` (${selected.length})` : ""}</summary>
      <div className="reference-options">
        {designs.map((design) => (
          <Button
            key={design.id}
            type="button"
            aria-pressed={selected.includes(design.id) || attached.includes(design.id)}
            className="reference-option"
            disabled={
              attached.includes(design.id) ||
              (!selected.includes(design.id) && new Set([...selected, ...attached]).size >= 20)
            }
            onClick={() =>
              onChange(
                selected.includes(design.id)
                  ? selected.filter((id) => id !== design.id)
                  : [...selected, design.id],
              )
            }
          >
            <span>{design.name}</span>
            <span aria-hidden="true">
              {selected.includes(design.id) || attached.includes(design.id) ? "✓" : "+"}
            </span>
          </Button>
        ))}
      </div>
    </details>
  );
}

const CanvasSurface = memo(function CanvasSurface({
  fileId,
  projectId,
  api,
  active,
  onBack,
  onUpdate,
  ref,
  threadControl,
  onContextChange,
  backLabel,
}: {
  fileId: string;
  projectId: string;
  api: NonNullable<Window["tidy"]>;
  active: boolean;
  onBack(): void;
  onUpdate(value: LocalDesign): void;
  ref: React.Ref<LocalCanvasHandle>;
  threadControl: ReactNode;
  backLabel: string;
  onContextChange(context: { fileId: string; pageId: string; nodeIds: string[] }): void;
}) {
  const { value, error } = useDesign(projectId, fileId);
  const repository = useDesignRepository();
  const container = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState<boolean>();
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setCompact(width < 1000);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={container} className="canvas-host">
      {value && compact !== undefined ? (
        <LocalCanvas
          ref={ref}
          api={api}
          projectId={projectId}
          initial={value}
          active={active}
          onBack={onBack}
          onUpdate={onUpdate}
          threadControl={threadControl}
          onContextChange={onContextChange}
          backLabel={backLabel}
          compact={compact}
        />
      ) : !value ? (
        <div className="working-unavailable">
          <span>{error ?? "Opening design…"}</span>
          {error && (
            <Button
              className="quiet-button"
              onClick={() => void repository.load(projectId, fileId).catch(() => {})}
            >
              Retry
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
});
