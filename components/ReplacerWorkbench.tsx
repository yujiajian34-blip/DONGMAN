"use client";

import { ChangeEvent, MouseEvent, useMemo, useRef, useState } from "react";
import { Crop, Download, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { Character } from "@/hooks/useCharacterStore";

export type ReplaceMode = "global-targets" | "scene-mapping";
export type ReplacementStatus = "pending" | "processing" | "done" | "failed" | "partial";
export type TargetReplacementStatus = Exclude<ReplacementStatus, "partial">;

export type RoiRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type RoiOverlay = {
  id: string;
  label: string;
  roi: RoiRect;
  isActive: boolean;
};

export type WorkbenchCandidate = {
  imageBase64: string;
  score: number | null;
  meta?: {
    selectedVariant?: string;
    stage?: "initial" | "refined";
  };
};

export type UploadedSourceImage = {
  name: string;
  imageBase64: string;
};

export type SourceQueueDisplayItem = {
  id: string;
  name: string;
  sourceImageBase64: string;
  resultImageBase64: string | null;
  extraPrompt: string;
  status: ReplacementStatus;
  error: string | null;
  detailText?: string;
};

export type TargetPreviewOption = {
  id: string;
  name: string;
  imageBase64: string;
  status: TargetReplacementStatus;
  error: string | null;
};

export type SceneMappingDraft = {
  id: string;
  label: string;
  targetCharacterId: string | null;
  targetCharacterName: string | null;
  targetCharacterImageBase64: string | null;
  roi: RoiRect | null;
  notes: string;
};

type ReplacerWorkbenchProps = {
  replaceMode: ReplaceMode;
  onReplaceModeChange: (mode: ReplaceMode) => void;
  sourceItems: SourceQueueDisplayItem[];
  selectedSourceId: string | null;
  selectedSourceName: string | null;
  sourceImageBase64: string | null;
  resultImageBase64: string | null;
  resultLabel: string | null;
  selectedSourcePrompt: string;
  selectedResultError: string | null;
  globalSelectedCharacters: Character[];
  targetOptions: TargetPreviewOption[];
  activeTargetCharacterId: string | null;
  availableCharacters: Character[];
  sceneMappings: SceneMappingDraft[];
  activeSceneMappingId: string | null;
  roiOverlays: RoiOverlay[];
  activeRoi: RoiRect | null;
  activeRoiLabel: string | null;
  isReplacing: boolean;
  error: string | null;
  candidates: WorkbenchCandidate[];
  selectedCandidateIndex: number;
  batchProgress: { completed: number; total: number } | null;
  onSourceImagesUpload: (images: UploadedSourceImage[]) => void;
  onSelectSource: (id: string) => void;
  onRemoveSource: (id: string) => void;
  onExecuteReplace: () => void;
  onActiveRoiChange: (roi: RoiRect | null) => void;
  onClearActiveRoi: () => void;
  onSelectCandidate: (index: number) => void;
  onSelectedSourcePromptChange: (value: string) => void;
  onActiveTargetCharacterChange: (id: string) => void;
  onAddSceneMapping: () => void;
  onRemoveSceneMapping: (id: string) => void;
  onActiveSceneMappingChange: (id: string) => void;
  onSceneMappingLabelChange: (id: string, value: string) => void;
  onSceneMappingTargetCharacterChange: (id: string, targetCharacterId: string | null) => void;
  onSceneMappingNotesChange: (id: string, value: string) => void;
  extraActionsLeft?: React.ReactNode;
};

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read source image."));
        return;
      }
      resolve(result);
    };

    reader.onerror = () => reject(new Error("Failed to read source image."));
    reader.readAsDataURL(file);
  });
}

function makeDownloadName(name: string | null, replaceMode: ReplaceMode): string {
  if (!name) {
    return replaceMode === "scene-mapping" ? "manga-scene-mapped.png" : "manga-replaced.png";
  }

  const normalized = name.replace(/\.[a-zA-Z0-9]+$/, "").replace(/\s+/g, "-");
  return replaceMode === "scene-mapping"
    ? `${normalized || "manga-image"}-scene-mapped.png`
    : `${normalized || "manga-image"}-replaced.png`;
}

function statusLabel(status: ReplacementStatus): string {
  if (status === "processing") {
    return "Processing";
  }
  if (status === "done") {
    return "Done";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "partial") {
    return "Partial";
  }
  return "Pending";
}

function statusClassName(status: ReplacementStatus): string {
  if (status === "processing") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  if (status === "done") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "failed") {
    return "border-rose-500/40 bg-rose-500/10 text-rose-200";
  }
  if (status === "partial") {
    return "border-sky-500/40 bg-sky-500/10 text-sky-200";
  }
  return "border-zinc-700 bg-zinc-800/60 text-zinc-300";
}

function buildResultPlaceholder(
  replaceMode: ReplaceMode,
  activeTargetOption: TargetPreviewOption | null,
  sceneMappings: SceneMappingDraft[],
): string {
  if (replaceMode === "global-targets") {
    if (activeTargetOption?.status === "processing") {
      return "Generating...";
    }
    if (activeTargetOption?.status === "failed") {
      return "This target failed. Review the error above or retry.";
    }
    if (activeTargetOption && activeTargetOption.status === "pending" && sceneMappings.length === 0) {
      return "Generated result appears here.";
    }
    if (activeTargetOption) {
      return "Select a target above and run replace to generate its version.";
    }
    return "Generated result appears here.";
  }

  if (sceneMappings.length === 0) {
    return "Add one or more subject mappings, then draw each ROI on the source image.";
  }

  return "Assign every subject to a target character and run mapped replace.";
}

export function ReplacerWorkbench({
  replaceMode,
  onReplaceModeChange,
  sourceItems,
  selectedSourceId,
  selectedSourceName,
  sourceImageBase64,
  resultImageBase64,
  resultLabel,
  selectedSourcePrompt,
  selectedResultError,
  globalSelectedCharacters,
  targetOptions,
  activeTargetCharacterId,
  availableCharacters,
  sceneMappings,
  activeSceneMappingId,
  roiOverlays,
  activeRoi,
  activeRoiLabel,
  isReplacing,
  error,
  candidates,
  selectedCandidateIndex,
  batchProgress,
  onSourceImagesUpload,
  onSelectSource,
  onRemoveSource,
  onExecuteReplace,
  onActiveRoiChange,
  onClearActiveRoi,
  onSelectCandidate,
  onSelectedSourcePromptChange,
  onActiveTargetCharacterChange,
  onAddSceneMapping,
  onRemoveSceneMapping,
  onActiveSceneMappingChange,
  onSceneMappingLabelChange,
  onSceneMappingTargetCharacterChange,
  onSceneMappingNotesChange,
  extraActionsLeft,
}: ReplacerWorkbenchProps) {
  const sourceStageRef = useRef<HTMLDivElement | null>(null);
  const [isDrawingRoi, setIsDrawingRoi] = useState(false);
  const [roiStart, setRoiStart] = useState<{ x: number; y: number } | null>(null);
  const [draftRoi, setDraftRoi] = useState<RoiRect | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const selectedItem = useMemo(
    () => sourceItems.find((item) => item.id === selectedSourceId) ?? null,
    [sourceItems, selectedSourceId],
  );

  const activeTargetOption = useMemo(() => {
    if (targetOptions.length === 0) {
      return null;
    }

    return targetOptions.find((target) => target.id === activeTargetCharacterId) ?? targetOptions[0] ?? null;
  }, [activeTargetCharacterId, targetOptions]);

  const globalTargetLabel = useMemo(() => {
    if (globalSelectedCharacters.length === 0) {
      return null;
    }

    if (globalSelectedCharacters.length <= 3) {
      return globalSelectedCharacters.map((character) => character.name).join(", ");
    }

    const preview = globalSelectedCharacters
      .slice(0, 3)
      .map((character) => character.name)
      .join(", ");
    return `${preview} +${globalSelectedCharacters.length - 3} more`;
  }, [globalSelectedCharacters]);

  const configuredSceneMappings = useMemo(
    () => sceneMappings.filter((mapping) => Boolean(mapping.roi) && Boolean(mapping.targetCharacterId)).length,
    [sceneMappings],
  );

  const plannedReplaceCount =
    replaceMode === "global-targets"
      ? sourceItems.length * Math.max(globalSelectedCharacters.length, 1)
      : selectedItem
        ? 1
        : 0;
  const canRun =
    replaceMode === "global-targets"
      ? sourceItems.length > 0 && globalSelectedCharacters.length > 0 && !isReplacing
      : Boolean(selectedItem) && !isReplacing;

  const canDrawRoi =
    Boolean(sourceImageBase64) &&
    (replaceMode === "global-targets" || Boolean(activeSceneMappingId));

  const handleSourceUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) {
      return;
    }

    try {
      const uploaded = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          imageBase64: await fileToBase64(file),
        })),
      );

      onSourceImagesUpload(uploaded);
      setDraftRoi(null);
      setRoiStart(null);
      setIsDrawingRoi(false);
      setUploadError(null);
      event.target.value = "";
    } catch (readError) {
      setUploadError(readError instanceof Error ? readError.message : "Failed to read source files.");
    }
  };

  const getRelativePoint = (event: MouseEvent<HTMLDivElement>): { x: number; y: number } | null => {
    const element = sourceStageRef.current;
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    return { x, y };
  };

  const beginRoiDraw = (event: MouseEvent<HTMLDivElement>) => {
    if (!canDrawRoi) {
      return;
    }

    const point = getRelativePoint(event);
    if (!point) {
      return;
    }

    setIsDrawingRoi(true);
    setRoiStart(point);
    setDraftRoi({
      x: point.x,
      y: point.y,
      width: 0,
      height: 0,
    });
  };

  const continueRoiDraw = (event: MouseEvent<HTMLDivElement>) => {
    if (!isDrawingRoi || !roiStart) {
      return;
    }

    const point = getRelativePoint(event);
    if (!point) {
      return;
    }

    const x = Math.min(roiStart.x, point.x);
    const y = Math.min(roiStart.y, point.y);
    const width = Math.abs(point.x - roiStart.x);
    const height = Math.abs(point.y - roiStart.y);

    setDraftRoi({ x, y, width, height });
  };

  const finishRoiDraw = () => {
    if (!isDrawingRoi) {
      return;
    }

    setIsDrawingRoi(false);
    setRoiStart(null);

    if (!draftRoi || draftRoi.width < 0.03 || draftRoi.height < 0.03) {
      setDraftRoi(null);
      return;
    }

    onActiveRoiChange(draftRoi);
    setDraftRoi(null);
  };

  const displayedOverlays = useMemo(() => {
    if (!draftRoi || !isDrawingRoi) {
      return roiOverlays;
    }

    return [
      ...roiOverlays.filter((overlay) => !overlay.isActive),
      {
        id: "__draft__",
        label: activeRoiLabel ?? "ROI",
        roi: draftRoi,
        isActive: true,
      },
    ];
  }, [activeRoiLabel, draftRoi, isDrawingRoi, roiOverlays]);

  const resultPlaceholder = buildResultPlaceholder(replaceMode, activeTargetOption, sceneMappings);

  return (
    <section className="h-full rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-4 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-300">Replacement Workbench</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {replaceMode === "global-targets"
              ? "Batch upload source images, then replace each image with one or more target characters."
              : "Map each person in the current image to a different target character and replace them in one pass."}
            {isReplacing ? " Gateway processing can take 30-70s per request." : ""}
          </p>
        </div>

        {extraActionsLeft}

        <button
          type="button"
          onClick={onExecuteReplace}
          disabled={!canRun}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 transition disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 hover:enabled:bg-emerald-400"
        >
          {isReplacing ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
          {isReplacing
            ? `Replacing ${batchProgress?.completed ?? 0}/${batchProgress?.total ?? plannedReplaceCount}`
            : replaceMode === "global-targets"
              ? globalSelectedCharacters.length > 1
                ? `Execute Multi Replace (${sourceItems.length} x ${globalSelectedCharacters.length})`
                : `Execute Batch Replace (${sourceItems.length})`
              : "Execute Mapped Replace"}
        </button>
      </div>

      <div className="mb-3 inline-flex w-full rounded-lg border border-zinc-800 bg-zinc-900/80 p-1">
        <button
          type="button"
          onClick={() => onReplaceModeChange("global-targets")}
          disabled={isReplacing}
          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
            replaceMode === "global-targets"
              ? "bg-emerald-500 text-zinc-950"
              : "text-zinc-300 hover:bg-zinc-800"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          Global Targets
        </button>
        <button
          type="button"
          onClick={() => onReplaceModeChange("scene-mapping")}
          disabled={isReplacing}
          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
            replaceMode === "scene-mapping"
              ? "bg-emerald-500 text-zinc-950"
              : "text-zinc-300 hover:bg-zinc-800"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          Mapped Subjects
        </button>
      </div>

      <div className="mb-3">
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handleSourceUpload}
          className="w-full cursor-pointer rounded-lg border border-dashed border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-200 hover:file:bg-zinc-700"
        />
      </div>

      {uploadError ? <p className="mb-3 text-xs text-rose-400">{uploadError}</p> : null}

      <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-2">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-[11px] uppercase tracking-[0.12em] text-zinc-400">Source Queue ({sourceItems.length})</p>
          <p className="text-[11px] text-zinc-500">
            {replaceMode === "global-targets" ? "Click an item to preview and edit ROI" : "Click an item to configure subject mappings"}
          </p>
        </div>
        <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
          {sourceItems.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-2 text-xs text-zinc-500">
              No source images yet.
            </p>
          ) : null}

          {sourceItems.map((item) => {
            const isSelected = item.id === selectedSourceId;

            return (
              <div
                key={item.id}
                className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${
                  isSelected
                    ? "border-emerald-500/70 bg-emerald-500/10"
                    : "border-zinc-800 bg-zinc-900/80 hover:border-zinc-700"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectSource(item.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <img
                    src={item.sourceImageBase64}
                    alt={item.name}
                    className="h-8 w-8 rounded border border-zinc-700 object-cover"
                  />
                  <div className="min-w-0">
                    <span className="block truncate text-xs text-zinc-200">{item.name}</span>
                    {item.detailText ? (
                      <span className="block text-[10px] text-zinc-500">{item.detailText}</span>
                    ) : null}
                  </div>
                </button>

                <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusClassName(item.status)}`}>
                  {statusLabel(item.status)}
                </span>

                {item.extraPrompt.trim() ? (
                  <span className="rounded border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-200">
                    Prompt
                  </span>
                ) : null}

                <button
                  type="button"
                  onClick={() => onRemoveSource(item.id)}
                  disabled={isReplacing}
                  className="rounded p-1 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label={`Remove ${item.name}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {replaceMode === "global-targets" ? (
          globalSelectedCharacters.length > 0 ? (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
              {globalSelectedCharacters.length === 1 ? "Current reference: " : "Current targets: "}
              <span className="font-medium text-zinc-100">{globalTargetLabel}</span>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-500">
              Pick at least one target character from the library.
            </div>
          )
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
            Subject mappings ready: <span className="font-medium text-zinc-100">{configuredSceneMappings}/{sceneMappings.length}</span>
          </div>
        )}

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Crop size={12} />
            {replaceMode === "global-targets" ? "Drag on source to mark target ROI" : "Select a subject slot, then drag on source to mark that person"}
          </span>
        </div>

        {activeRoi ? (
          <button
            type="button"
            onClick={onClearActiveRoi}
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300 transition hover:border-zinc-600 hover:text-zinc-100"
          >
            <X size={12} />
            Clear ROI
          </button>
        ) : null}
      </div>

      <div className="mb-3 space-y-2 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">Prompt For Selected Source</p>
          <p className="text-[11px] text-zinc-500">{selectedSourcePrompt.length}/600</p>
        </div>
        <textarea
          value={selectedSourcePrompt}
          onChange={(event) => onSelectedSourcePromptChange(event.target.value.slice(0, 600))}
          disabled={!selectedItem || isReplacing}
          rows={3}
          placeholder={
            selectedItem
              ? replaceMode === "global-targets"
                ? "Example: Keep short orange hair, tired narrow eyes, masculine jawline, plain gray shirt."
                : "Example: Keep left person in school uniform, right person smiling, preserve the table and cups."
              : "Select one source image first."
          }
          className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {replaceMode === "scene-mapping" ? (
        <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">Subject Mappings</p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Add one slot per person, choose a target character, then draw that person&apos;s ROI on the source image.
              </p>
            </div>
            <button
              type="button"
              onClick={onAddSceneMapping}
              disabled={!selectedItem || isReplacing}
              className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus size={12} />
              Add Subject
            </button>
          </div>

          {!selectedItem ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-xs text-zinc-500">
              Select one source image from the queue to configure subject mappings.
            </p>
          ) : sceneMappings.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-xs text-zinc-500">
              No subject mappings yet. Add one to start assigning people in this image.
            </p>
          ) : (
            <div className="space-y-2">
              {sceneMappings.map((mapping) => {
                const isActive = mapping.id === activeSceneMappingId;

                return (
                  <div
                    key={mapping.id}
                    className={`rounded-xl border p-3 transition ${
                      isActive
                        ? "border-emerald-500/70 bg-emerald-500/10"
                        : "border-zinc-800 bg-zinc-900/70"
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onActiveSceneMappingChange(mapping.id)}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                          isActive
                            ? "bg-emerald-500 text-zinc-950"
                            : "border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500"
                        }`}
                      >
                        {isActive ? "Active ROI" : "Edit ROI"}
                      </button>

                      <input
                        type="text"
                        value={mapping.label}
                        onChange={(event) => onSceneMappingLabelChange(mapping.id, event.target.value.slice(0, 40))}
                        disabled={isReplacing}
                        placeholder="Subject label"
                        className="min-w-[8rem] flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                      />

                      <select
                        value={mapping.targetCharacterId ?? ""}
                        onChange={(event) =>
                          onSceneMappingTargetCharacterChange(mapping.id, event.target.value || null)
                        }
                        disabled={isReplacing}
                        className="min-w-[10rem] rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">Select target</option>
                        {availableCharacters.map((character) => (
                          <option key={character.id} value={character.id}>
                            {character.name}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => onRemoveSceneMapping(mapping.id)}
                        disabled={isReplacing}
                        className="rounded-md p-2 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Remove ${mapping.label}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-zinc-400">
                      <span className={`rounded-full border px-2 py-0.5 ${mapping.roi ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-zinc-700 bg-zinc-900 text-zinc-400"}`}>
                        {mapping.roi ? "ROI set" : "ROI missing"}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 ${mapping.targetCharacterId ? "border-sky-500/40 bg-sky-500/10 text-sky-200" : "border-zinc-700 bg-zinc-900 text-zinc-400"}`}>
                        {mapping.targetCharacterName ?? "Target missing"}
                      </span>
                    </div>

                    {mapping.targetCharacterImageBase64 ? (
                      <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2">
                        <img
                          src={mapping.targetCharacterImageBase64}
                          alt={mapping.targetCharacterName ?? "Target preview"}
                          className="h-9 w-9 rounded border border-zinc-700 object-cover"
                        />
                        <div className="min-w-0 text-xs text-zinc-300">
                          <div className="truncate font-medium text-zinc-100">{mapping.targetCharacterName}</div>
                          <div className="text-[11px] text-zinc-500">Reference image used for this subject</div>
                        </div>
                      </div>
                    ) : null}

                    <textarea
                      value={mapping.notes}
                      onChange={(event) => onSceneMappingNotesChange(mapping.id, event.target.value.slice(0, 240))}
                      disabled={isReplacing}
                      rows={2}
                      placeholder="Optional notes for this person, for example: left student with glasses, keep seated pose, keep umbrella."
                      className="mt-2 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {replaceMode === "global-targets" && selectedItem && targetOptions.length > 1 ? (
        <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">Target Outputs</p>
            <p className="text-[11px] text-zinc-500">Switch preview between selected targets</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {targetOptions.map((target) => {
              const isActive = target.id === activeTargetCharacterId;

              return (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => onActiveTargetCharacterChange(target.id)}
                  className={`flex min-w-[9rem] items-center gap-2 rounded-lg border px-2 py-2 text-left transition ${
                    isActive
                      ? "border-emerald-500 bg-emerald-500/10"
                      : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
                  }`}
                >
                  <img
                    src={target.imageBase64}
                    alt={target.name}
                    className="h-9 w-9 rounded border border-zinc-700 object-cover"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-zinc-100">{target.name}</div>
                    <div className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] ${statusClassName(target.status)}`}>
                      {statusLabel(target.status)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? <p className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">{error}</p> : null}
      {selectedResultError ? (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
          Selected result error: {selectedResultError}
        </p>
      ) : null}

      <div className="grid h-[62vh] grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="border-b border-zinc-800 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-zinc-400">
            Source
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            {sourceImageBase64 ? (
              <div
                ref={sourceStageRef}
                className={`relative h-full w-full select-none ${canDrawRoi ? "cursor-crosshair" : "cursor-default"}`}
                onMouseDown={beginRoiDraw}
                onMouseMove={continueRoiDraw}
                onMouseUp={finishRoiDraw}
                onMouseLeave={finishRoiDraw}
              >
                <img src={sourceImageBase64} alt="Source preview" className="h-full w-full rounded-lg object-contain" draggable={false} />
                {displayedOverlays.map((overlay) => (
                  <div
                    key={overlay.id}
                    className={`pointer-events-none absolute border-2 ${
                      overlay.isActive
                        ? "border-emerald-400 bg-emerald-400/15"
                        : "border-sky-400/80 bg-sky-400/10"
                    }`}
                    style={{
                      left: `${overlay.roi.x * 100}%`,
                      top: `${overlay.roi.y * 100}%`,
                      width: `${overlay.roi.width * 100}%`,
                      height: `${overlay.roi.height * 100}%`,
                    }}
                  >
                    <span
                      className={`absolute left-0 top-0 rounded-br-md px-1.5 py-0.5 text-[10px] font-medium ${
                        overlay.isActive ? "bg-emerald-400 text-zinc-950" : "bg-sky-400 text-zinc-950"
                      }`}
                    >
                      {overlay.label}
                    </span>
                  </div>
                ))}
                {replaceMode === "scene-mapping" && !activeSceneMappingId ? (
                  <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-lg border border-zinc-700/80 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
                    Select a subject slot first, then drag on the image to mark that person&apos;s ROI.
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Select one source image from the queue to preview.</p>
            )}
          </div>
        </div>

        <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-zinc-400">
            <span>
              Result
              {resultLabel ? ` - ${resultLabel}` : ""}
            </span>
            {resultImageBase64 ? (
              <a
                href={resultImageBase64}
                download={makeDownloadName(selectedSourceName, replaceMode)}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[11px] font-semibold normal-case tracking-normal text-zinc-200 transition hover:border-emerald-500 hover:text-emerald-300"
              >
                <Download size={12} />
                Download
              </a>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            {resultImageBase64 ? (
              <img src={resultImageBase64} alt="Replacement result" className="h-full w-full rounded-lg object-contain" />
            ) : (
              <p className="text-xs text-zinc-500">{resultPlaceholder}</p>
            )}
          </div>
          {candidates.length > 0 ? (
            <div className="border-t border-zinc-800 px-3 pb-3 pt-2">
              <p className="mb-2 text-[11px] uppercase tracking-[0.12em] text-zinc-500">Candidates</p>
              <div className="grid grid-cols-4 gap-2">
                {candidates.map((candidate, index) => {
                  const isSelected = index === selectedCandidateIndex;
                  return (
                    <button
                      type="button"
                      key={`${candidate.imageBase64.slice(0, 32)}-${index}`}
                      onClick={() => onSelectCandidate(index)}
                      className={`rounded-lg border p-1 text-left transition ${
                        isSelected
                          ? "border-emerald-500 bg-emerald-500/10"
                          : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
                      }`}
                    >
                      <img src={candidate.imageBase64} alt={`Candidate ${index + 1}`} className="h-16 w-full rounded object-cover" />
                      <div className="mt-1 text-[10px] text-zinc-400">
                        {candidate.score === null ? "Unscored" : `score ${candidate.score.toFixed(4)}`}
                      </div>
                      <div className="text-[10px] text-zinc-500">
                        {candidate.meta?.stage ?? "unknown"} / {candidate.meta?.selectedVariant ?? "n/a"}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
