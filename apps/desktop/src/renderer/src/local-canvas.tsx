import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
  type ReactNode,
} from "react";
import { FileEditor } from "@tidy/editor";
import { EditorHostProvider, type EditorThreadContext } from "@tidy/editor/host";
import type { DesignDocument } from "@tidy/design/document";
import type { DesignContext, DesktopAPI, LocalDesign } from "../../shared/contracts";

import { useDesign, useDesignRepository } from "./design-context";
import { showToast } from "@tidy/ui/toast";

export type LocalCanvasHandle = { captureContext(): Promise<DesignContext | undefined> };

export const LocalCanvas = memo(function LocalCanvas({
  api,
  projectId,
  initial,
  active,
  onBack,
  onUpdate,
  ref,
  threadControl,
  onContextChange,
  backLabel,
  compact,
}: {
  api: DesktopAPI;
  projectId: string;
  initial: LocalDesign;
  active: boolean;
  onBack(): void;
  onUpdate(design: LocalDesign): void;
  ref?: Ref<LocalCanvasHandle>;
  threadControl?: ReactNode;
  onContextChange?(context: { fileId: string; pageId: string; nodeIds: string[] }): void;
  backLabel: string;
  compact?: boolean;
}) {
  const file = useRef(initial);
  const revision = useRef(0);
  const pending = useRef(0);
  const repository = useDesignRepository();
  const accepted = useDesign(projectId, initial.id);
  const threadContext = useRef<EditorThreadContext | undefined>(undefined);
  const [assets, setAssets] = useState(initial.assets);
  const [external, setExternal] = useState<{ revision: number; content: DesignDocument }>();
  const notify = useRef(onUpdate);
  notify.current = onUpdate;
  const sync = useCallback(() => {
    const value = repository.get(projectId, initial.id).value;
    if (!value || pending.current || value.version === file.current.version) return;
    file.current = value;
    setAssets(value.assets);
    setExternal({ revision: ++revision.current, content: value.document });
  }, [repository, projectId, initial.id]);
  useEffect(sync, [sync, accepted.value]);
  useEffect(() => {
    if (accepted.error) showToast(accepted.error, "error");
  }, [accepted.error]);
  useImperativeHandle(
    ref,
    () => ({
      async captureContext() {
        const context = threadContext.current;
        if (!context) return undefined;
        const { pageId, nodeIds } = context;
        await context.whenSettled();
        const current = await repository.load(projectId, initial.id);
        return { fileId: initial.id, pageId, nodeIds, version: current.version };
      },
    }),
    [repository, projectId, initial.id],
  );

  async function update(changes: { document?: DesignDocument; name?: string }) {
    pending.current++;
    try {
      const value = await repository.update(projectId, initial.id, changes, file.current.version);
      file.current = value;
      setAssets(value.assets);
      revision.current++;
      notify.current(value);
    } finally {
      pending.current--;
      sync();
    }
  }

  return (
    <EditorHostProvider
      value={{
        Link: function BackLink({ children, className, onNavigate }) {
          return (
            <button
              className={className}
              aria-label={backLabel}
              onClick={() => {
                let blocked = false;
                onNavigate?.({
                  preventDefault() {
                    blocked = true;
                  },
                });
                if (!blocked) onBack();
              }}
            >
              {children}
            </button>
          );
        },
      }}
    >
      <FileEditor
        fileId={initial.id}
        fileName={accepted.value?.name ?? initial.name}
        organizationName=""
        backHref="#"
        initialDocument={{ revision: 0, content: initial.document }}
        threadControl={threadControl}
        onThreadContextChange={(context) => {
          threadContext.current = context;
          onContextChange?.({
            fileId: initial.id,
            pageId: context.pageId,
            nodeIds: context.nodeIds,
          });
        }}
        initialPanelsOpen
        local
        compact={compact}
        active={active}
        previewAssetUrls={assets}
        externalDocument={external}
        localPersistence={{
          async loadLibrary(source) {
            const id =
              source
                .trim()
                .split("/")
                .at(-1)
                ?.replace(/\.json$/, "") ?? source;
            const value = await repository.load(projectId, id);
            setAssets((current) => ({ ...current, ...value.assets }));
            return {
              fileUid: value.id,
              name: value.name,
              revision: new Date(value.updatedAt).getTime(),
              content: value.document,
            };
          },
          commit: (document) => update({ document }),
          rename: (name) => update({ name }),
          async uploadAsset(file) {
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(String(reader.result));
              reader.onerror = () => reject(new Error("Could not read this image."));
              reader.readAsDataURL(file);
            });
            const value = await api.uploadDesignAsset(projectId, dataUrl);
            setAssets((current) => ({ ...current, [value.assetId]: value.url }));
            return value;
          },
        }}
      />
    </EditorHostProvider>
  );
});
