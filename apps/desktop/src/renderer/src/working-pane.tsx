import { memo, useMemo, useState } from "react";
import { Button } from "@tidy/ui/button";
import { SelectMenu } from "@tidy/ui/select-menu";
import { Icon } from "@tidy/editor/components/ui/icon";
import { DocumentPreview } from "@tidy/editor/components/files/document-preview";
import type { DesktopAPI, DesignSummary, Thread } from "../../shared/contracts";
import { useDesign, useDesignRepository } from "./design-context";
import { AppPreview } from "./app-preview";
import { ToolActivityGroup } from "./tool-activity";

export type WorkingSurface = "design" | "changes" | "preview";

const DesignWindow = memo(function DesignWindow({
  projectId,
  file,
  context,
  active,
  onOpen,
}: {
  projectId: string;
  file: DesignSummary;
  context?: Thread["messages"][number]["designContext"];
  active: boolean;
  onOpen(id: string): void;
}) {
  const repository = useDesignRepository();
  const { value, error } = useDesign(projectId, file.id, active);
  return (
    <div className="design-window">
      <div className="working-file-heading">
        <span className="working-file-name">
          <Icon name="frame" size={15} />
          {value?.name ?? file.name}
        </span>
        <span className="live-label">Live</span>
        <Button
          className="secondary-button"
          onClick={() => onOpen(file.id)}
          aria-label={`Expand ${value?.name ?? file.name}`}
        >
          Expand file
        </Button>
      </div>
      <button
        className="working-design-preview"
        onClick={() => onOpen(file.id)}
        aria-label={`Edit ${value?.name ?? file.name}`}
      >
        {value ? (
          <DocumentPreview
            content={value.document}
            assetUrl={(id) => value.assets[id] ?? ""}
            pageId={context?.pageId}
            nodeIds={context?.nodeIds}
          />
        ) : (
          <span className="muted">{error ? "Preview unavailable" : "Opening design…"}</span>
        )}
      </button>
      {error && (
        <div className="working-file-error" role="status">
          <span>
            {value ? "Showing the last available design. " : ""}
            {error}
          </span>
          <Button
            className="quiet-button"
            onClick={() => void repository.load(projectId, file.id).catch(() => {})}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
});

export const WorkingPane = memo(function WorkingPane({
  projectId,
  designs,
  ids,
  thread,
  active,
  onOpen,
  api,
  surface,
  onSurfaceChange,
  previewURL,
  previewAvailable,
  onPreviewURL,
}: {
  projectId: string;
  api: DesktopAPI;
  surface?: WorkingSurface;
  onSurfaceChange(surface: WorkingSurface): void;
  previewURL?: string;
  previewAvailable: boolean;
  onPreviewURL(url: string): void;
  designs: DesignSummary[];
  ids: string[];
  thread?: Thread;
  active: boolean;
  onOpen(id: string): void;
}) {
  const [chosen, setChosen] = useState<string>();
  const files = useMemo(
    () =>
      ids.map((id) => designs.find((file) => file.id === id)).filter((file) => file !== undefined),
    [ids, designs],
  );
  const edits = useMemo(
    () =>
      thread?.toolActivities?.filter((tool) => tool.kind === "edit" || tool.files?.length) ?? [],
    [thread?.toolActivities],
  );
  const selected = files.find((file) => file.id === chosen) ?? files[0];
  const showing =
    surface === "preview" && previewAvailable
      ? "preview"
      : surface === "changes" && edits.length
        ? "changes"
        : surface === "design" && files.length
          ? "design"
          : files.length
            ? "design"
            : edits.length
              ? "changes"
              : previewAvailable
                ? "preview"
                : "design";
  const showingChanges = showing === "changes";
  const surfaceCount =
    Number(files.length > 0) + Number(edits.length > 0) + Number(previewAvailable);
  const context = useMemo(() => {
    const messages = thread?.messages ?? [];
    for (let index = messages.length - 1; index >= 0; index--)
      if (messages[index].designContext?.fileId === selected?.id)
        return messages[index].designContext;
  }, [thread?.messages, selected?.id]);
  const missing = ids.length - files.length;
  return (
    <div className="working-pane" aria-label="Working files">
      {(files.length > 1 || surfaceCount > 1) && (
        <div className="working-toolbar">
          {files.length > 1 && (
            <SelectMenu
              value={selected?.id ?? ""}
              label="Working design"
              options={files.map((file) => ({ value: file.id, label: file.name }))}
              onChange={(id) => {
                setChosen(id);
                onSurfaceChange("design");
              }}
            />
          )}
          {surfaceCount > 1 && (
            <div className="working-surface-switch" aria-label="Working surface">
              {files.length > 0 && (
                <Button
                  className="quiet-button"
                  aria-pressed={showing === "design"}
                  onClick={() => onSurfaceChange("design")}
                >
                  Design
                </Button>
              )}
              {edits.length > 0 && (
                <Button
                  className="quiet-button"
                  aria-pressed={showingChanges}
                  onClick={() => onSurfaceChange("changes")}
                >
                  Changes
                </Button>
              )}
              {previewAvailable && (
                <Button
                  className="quiet-button"
                  aria-pressed={showing === "preview"}
                  onClick={() => onSurfaceChange("preview")}
                >
                  Preview
                </Button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="working-content" hidden={showing === "preview"}>
        {showingChanges ? (
          <div className="working-changes" aria-label="Code changes">
            <div className="working-file-heading">
              <span>Changes</span>
              <span className="muted">
                {edits.length} {edits.length === 1 ? "operation" : "operations"}
              </span>
            </div>
            <div className="working-changes-scroll">
              <ToolActivityGroup activities={edits} visible={active} />
            </div>
          </div>
        ) : selected ? (
          <DesignWindow
            key={selected.id}
            projectId={projectId}
            file={selected}
            context={context}
            active={active}
            onOpen={onOpen}
          />
        ) : missing > 0 ? (
          <p className="working-unavailable">
            The associated {missing === 1 ? "design is" : "designs are"} no longer available in this
            project.
          </p>
        ) : null}
      </div>
      {previewAvailable && (
        <div className="working-content" hidden={showing !== "preview"}>
          <AppPreview
            api={api}
            url={previewURL}
            active={active && showing === "preview"}
            onURL={onPreviewURL}
          />
        </div>
      )}
      {selected && missing > 0 && showing !== "preview" && (
        <p className="working-unavailable">
          {missing} associated {missing === 1 ? "file is" : "files are"} unavailable.
        </p>
      )}
    </div>
  );
});
