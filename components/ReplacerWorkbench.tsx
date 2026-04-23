"use client";

import { ChangeEvent, MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { Crop, Download, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { Character } from "@/hooks/useCharacterStore";

export type ReplaceMode = "global-targets" | "scene-mapping" | "story-batch";
export type ReplacementStatus = "pending" | "processing" | "done" | "failed" | "partial";
export type TargetReplacementStatus = Exclude<ReplacementStatus, "partial">;
export type StoryPlanStatus = "idle" | "processing" | "ready" | "failed";
export type StoryOutputMode = "scene-frames" | "comic-grid-4" | "comic-grid-9";

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

export type StoryRoleDraft = {
  id: string;
  label: string;
  description: string;
  assignedCharacterId: string | null;
  assignedCharacterName: string | null;
  assignedCharacterImageBase64: string | null;
  assignedCharacterAppearance: string | null;
};

export type StorySceneDraft = {
  id: string;
  title: string;
  narration: string;
  imagePrompt: string;
  status: TargetReplacementStatus;
  error: string | null;
  candidates: WorkbenchCandidate[];
  selectedCandidateIndex: number;
  resultImageBase64: string | null;
};

export type StoryComicDraft = {
  id: string;
  title: string;
  pageIndex: number;
  panelCount: number;
  sceneStartIndex: number;
  sceneEndIndex: number;
  status: TargetReplacementStatus;
  error: string | null;
  candidates: WorkbenchCandidate[];
  selectedCandidateIndex: number;
  resultImageBase64: string | null;
};

export type StoryPlanDraft = {
  title: string;
  synopsis: string;
  visualStyle: string;
  storyRoles: StoryRoleDraft[];
  scenes: StorySceneDraft[];
  comicPages: StoryComicDraft[];
};

type StoryBatchConfig = {
  prompt: string;
  plan: StoryPlanDraft | null;
  status: StoryPlanStatus;
  outputMode: StoryOutputMode;
  selectedSceneId: string | null;
  selectedComicPageId: string | null;
  storyRoleReadyCount: number;
  onPromptChange: (value: string) => void;
  onAnalyze: () => void;
  onGenerate: () => void;
  onOutputModeChange: (mode: StoryOutputMode) => void;
  onSelectScene: (id: string) => void;
  onSelectComicPage: (id: string) => void;
  onPlanTitleChange: (value: string) => void;
  onPlanSynopsisChange: (value: string) => void;
  onPlanVisualStyleChange: (value: string) => void;
  onStoryRoleCharacterChange: (roleId: string, characterId: string | null) => void;
  onSceneTitleChange: (id: string, value: string) => void;
  onSceneNarrationChange: (id: string, value: string) => void;
  onScenePromptChange: (id: string, value: string) => void;
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
  mappedBatchReadyCount: number;
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
  storyBatch: StoryBatchConfig;
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
    if (replaceMode === "scene-mapping") {
      return "manga-scene-mapped.png";
    }
    if (replaceMode === "story-batch") {
      return "story-scene.png";
    }
    return "manga-replaced.png";
  }

  const normalized = name.replace(/\.[a-zA-Z0-9]+$/, "").replace(/\s+/g, "-");

  if (replaceMode === "scene-mapping") {
    return `${normalized || "manga-image"}-scene-mapped.png`;
  }
  if (replaceMode === "story-batch") {
    return `${normalized || "story-scene"}-story-scene.png`;
  }

  return `${normalized || "manga-image"}-replaced.png`;
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

function getComicPanelCount(storyOutputMode: StoryOutputMode): number {
  return storyOutputMode === "comic-grid-4" ? 4 : 9;
}

function getComicModeLabel(storyOutputMode: StoryOutputMode): string {
  return storyOutputMode === "comic-grid-4" ? "4-panel comic" : "9-panel comic";
}

function buildResultPlaceholder(
  replaceMode: ReplaceMode,
  storyOutputMode: StoryOutputMode,
  activeTargetOption: TargetPreviewOption | null,
  sceneMappings: SceneMappingDraft[],
  storyPlan: StoryPlanDraft | null,
  selectedStoryScene: StorySceneDraft | null,
  selectedStoryComic: StoryComicDraft | null,
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

  if (replaceMode === "scene-mapping") {
    if (sceneMappings.length === 0) {
      return "Add one or more subject mappings, then draw each ROI on the source image.";
    }

    return "Assign every subject to a target character and run mapped replace.";
  }

  if (!storyPlan) {
    return "Analyze the uploaded original images to extract the existing plot scene by scene.";
  }

  if (storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9") {
    const comicModeLabel = getComicModeLabel(storyOutputMode);

    if (selectedStoryComic?.status === "processing") {
      return "Generating...";
    }

    if (selectedStoryComic?.status === "failed") {
      return `This ${comicModeLabel} page failed. Review the error above or retry.`;
    }

    if (!selectedStoryComic) {
      return `Generate automatically paginated hand-drawn ${comicModeLabel} pages from the extracted scenes.`;
    }

    return `Preview ${selectedStoryComic.title}, covering scenes ${selectedStoryComic.sceneStartIndex + 1}-${selectedStoryComic.sceneEndIndex + 1} in order.`;
  }

  if (!selectedStoryScene) {
    return "Select a scene from the storyboard to preview or render it.";
  }

  if (selectedStoryScene.status === "processing") {
    return "Generating...";
  }

  if (selectedStoryScene.status === "failed") {
    return "This story scene failed. Review the error above or retry.";
  }

  return "Render story scenes from the extracted plot using your assigned characters.";
}

function buildWorkbenchSummary(replaceMode: ReplaceMode): string {
  if (replaceMode === "global-targets") {
    return "Batch upload single-person source images, then replace each image with one or more selected target characters.";
  }

  if (replaceMode === "scene-mapping") {
    return "Configure subject mappings per image, then batch replace every fully mapped image in the queue.";
  }

  return "Analyze uploaded original images, extract the existing plot without changing it, then render those scenes with your selected character library.";
}

function buildQueueHint(replaceMode: ReplaceMode): string {
  if (replaceMode === "global-targets") {
    return "Click an item to preview it and edit its prompt";
  }

  if (replaceMode === "scene-mapping") {
    return "Click an item to configure subject mappings";
  }

  return "Upload the original story images in order so the existing plot can be extracted faithfully";
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
  mappedBatchReadyCount,
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
  storyBatch,
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

  const selectedStoryScene = useMemo(() => {
    if (!storyBatch.plan || storyBatch.plan.scenes.length === 0) {
      return null;
    }

    return storyBatch.plan.scenes.find((scene) => scene.id === storyBatch.selectedSceneId) ?? storyBatch.plan.scenes[0];
  }, [storyBatch.plan, storyBatch.selectedSceneId]);

  const selectedStoryComic = useMemo(() => {
    if (!storyBatch.plan || storyBatch.plan.comicPages.length === 0) {
      return null;
    }

    return (
      storyBatch.plan.comicPages.find((comicPage) => comicPage.id === storyBatch.selectedComicPageId) ??
      storyBatch.plan.comicPages[0]
    );
  }, [storyBatch.plan, storyBatch.selectedComicPageId]);

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

  const storyRoleSummaryLabel = useMemo(() => {
    if (!storyBatch.plan || storyBatch.plan.storyRoles.length === 0) {
      return null;
    }

    return `${storyBatch.storyRoleReadyCount}/${storyBatch.plan.storyRoles.length} roles assigned`;
  }, [storyBatch.plan, storyBatch.storyRoleReadyCount]);

  const configuredSceneMappings = useMemo(
    () => sceneMappings.filter((mapping) => Boolean(mapping.roi) && Boolean(mapping.targetCharacterId)).length,
    [sceneMappings],
  );

  const storySceneCount = storyBatch.plan?.scenes.length ?? 0;
  const plannedComicPageCount = storyBatch.plan?.comicPages.length ?? 0;
  const storyHasPlan = Boolean(storyBatch.plan && storyBatch.plan.scenes.length > 0);
  const canRenderComicGrid =
    (storyBatch.outputMode === "comic-grid-4" || storyBatch.outputMode === "comic-grid-9") && plannedComicPageCount > 0;
  const plannedReplaceCount =
    replaceMode === "global-targets"
      ? sourceItems.length * Math.max(globalSelectedCharacters.length, 1)
      : replaceMode === "scene-mapping"
        ? mappedBatchReadyCount
        : storyHasPlan
          ? storyBatch.outputMode === "comic-grid-4" || storyBatch.outputMode === "comic-grid-9"
            ? plannedComicPageCount
            : storySceneCount
          : sourceItems.length;
  const canRun =
    replaceMode === "global-targets"
      ? sourceItems.length > 0 && globalSelectedCharacters.length > 0 && !isReplacing
      : replaceMode === "scene-mapping"
        ? mappedBatchReadyCount > 0 && !isReplacing
        : sourceItems.length > 0 &&
          !isReplacing &&
          ((storyBatch.outputMode !== "comic-grid-4" && storyBatch.outputMode !== "comic-grid-9") ||
            !storyHasPlan ||
            canRenderComicGrid);
  const canDrawRoi = Boolean(sourceImageBase64) && replaceMode === "scene-mapping" && Boolean(activeSceneMappingId);

  useEffect(() => {
    if (canDrawRoi) {
      return;
    }

    setIsDrawingRoi(false);
    setRoiStart(null);
    setDraftRoi(null);
  }, [canDrawRoi]);

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

  const resultPlaceholder = buildResultPlaceholder(
    replaceMode,
    storyBatch.outputMode,
    activeTargetOption,
    sceneMappings,
    storyBatch.plan,
    selectedStoryScene,
    selectedStoryComic,
  );

  const primaryActionLabel = useMemo(() => {
    if (isReplacing) {
      return `Processing ${batchProgress?.completed ?? 0}/${batchProgress?.total ?? plannedReplaceCount}`;
    }

    if (replaceMode === "global-targets") {
      return globalSelectedCharacters.length > 1
        ? `Execute Single Subject Batch (${sourceItems.length} x ${globalSelectedCharacters.length})`
        : `Execute Single Subject Batch (${sourceItems.length})`;
    }

    if (replaceMode === "scene-mapping") {
      return mappedBatchReadyCount > 1 ? `Execute Mapped Batch (${mappedBatchReadyCount})` : "Execute Mapped Replace";
    }

    if (storyHasPlan) {
      if (storyBatch.outputMode === "comic-grid-4") {
        return plannedComicPageCount > 1 ? `Generate 4-Panel Pages (${plannedComicPageCount})` : "Generate 4-Panel Page";
      }

      if (storyBatch.outputMode === "comic-grid-9") {
        return plannedComicPageCount > 1 ? `Generate 9-Panel Pages (${plannedComicPageCount})` : "Generate 9-Panel Page";
      }

      return storySceneCount > 1 ? `Generate Story Batch (${storySceneCount})` : "Generate Story Image";
    }

    return `Analyze Existing Plot (${sourceItems.length})`;
  }, [
    batchProgress,
    globalSelectedCharacters.length,
    isReplacing,
    mappedBatchReadyCount,
    plannedReplaceCount,
    replaceMode,
    sourceItems.length,
    storyBatch.outputMode,
    storyHasPlan,
    plannedComicPageCount,
    storySceneCount,
  ]);

  return (
    <section className="h-full rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-4 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-300">Replacement Workbench</h2>
          <p className="mt-1 text-xs text-zinc-500">
            {buildWorkbenchSummary(replaceMode)}
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
          {primaryActionLabel}
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
          Single Subject Batch
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
        <button
          type="button"
          onClick={() => onReplaceModeChange("story-batch")}
          disabled={isReplacing}
          className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
            replaceMode === "story-batch" ? "bg-emerald-500 text-zinc-950" : "text-zinc-300 hover:bg-zinc-800"
          } disabled:cursor-not-allowed disabled:opacity-60`}
        >
          Story Batch
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
          <p className="text-[11px] text-zinc-500">{buildQueueHint(replaceMode)}</p>
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
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-zinc-200">{item.name}</span>
                    {item.detailText ? <span className="block text-[10px] text-zinc-500">{item.detailText}</span> : null}
                  </span>
                </button>

                <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusClassName(item.status)}`}>
                  {statusLabel(item.status)}
                </span>

                {item.extraPrompt.trim() && replaceMode !== "story-batch" ? (
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
              {globalSelectedCharacters.length === 1 ? "Selected reference: " : "Selected targets: "}
              <span className="font-medium text-zinc-100">{globalTargetLabel}</span>
            </div>
          ) : (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-500">
              Pick at least one target character from the library.
            </div>
          )
        ) : replaceMode === "scene-mapping" ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
            Subject mappings ready:{" "}
            <span className="font-medium text-zinc-100">
              {configuredSceneMappings}/{sceneMappings.length}
            </span>
          </div>
        ) : storyBatch.plan ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
            Story roles: <span className="font-medium text-zinc-100">{storyRoleSummaryLabel}</span>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-500">
            Analyze the uploaded original images first, then assign your own characters to the detected story roles.
          </div>
        )}

        {replaceMode === "global-targets" ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
            Single Subject Batch assumes each source image contains one main person. No ROI is needed.
          </div>
        ) : replaceMode === "scene-mapping" ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
            <span className="inline-flex items-center gap-1">
              <Crop size={12} />
              Select a subject slot, then drag on source to mark that person
            </span>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
            {storyHasPlan
              ? storyBatch.outputMode === "comic-grid-4" || storyBatch.outputMode === "comic-grid-9"
                ? `${plannedComicPageCount} comic page${plannedComicPageCount === 1 ? "" : "s"} planned from ${storySceneCount} extracted scene${storySceneCount === 1 ? "" : "s"}`
                : `Storyboard ready: ${storySceneCount} scene${storySceneCount === 1 ? "" : "s"}`
              : "Upload references, then analyze them into a storyboard draft."}
          </div>
        )}

        {replaceMode === "scene-mapping" && activeRoi ? (
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
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">
            {replaceMode === "story-batch" ? "Story Direction" : "Prompt For Selected Source"}
          </p>
          <p className="text-[11px] text-zinc-500">
            {replaceMode === "story-batch" ? storyBatch.prompt.length : selectedSourcePrompt.length}/
            {replaceMode === "story-batch" ? 1200 : 600}
          </p>
        </div>
        <textarea
          value={replaceMode === "story-batch" ? storyBatch.prompt : selectedSourcePrompt}
          onChange={(event) =>
            replaceMode === "story-batch"
              ? storyBatch.onPromptChange(event.target.value.slice(0, 1200))
              : onSelectedSourcePromptChange(event.target.value.slice(0, 600))
          }
          disabled={replaceMode === "story-batch" ? isReplacing : !selectedItem || isReplacing}
          rows={3}
          placeholder={
            replaceMode === "story-batch"
              ? "Example: Turn these references into a quiet romance short story with rain, misunderstandings, and a rooftop confession. Keep a clean manga frame style."
              : selectedItem
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
                      isActive ? "border-emerald-500/70 bg-emerald-500/10" : "border-zinc-800 bg-zinc-900/70"
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
                        onChange={(event) => onSceneMappingTargetCharacterChange(mapping.id, event.target.value || null)}
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
                      <span
                        className={`rounded-full border px-2 py-0.5 ${
                          mapping.roi
                            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400"
                        }`}
                      >
                        {mapping.roi ? "ROI set" : "ROI missing"}
                      </span>
                      <span
                        className={`rounded-full border px-2 py-0.5 ${
                          mapping.targetCharacterId
                            ? "border-sky-500/40 bg-sky-500/10 text-sky-200"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400"
                        }`}
                      >
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

      {replaceMode === "story-batch" ? (
        <div className="mb-3 rounded-xl border border-zinc-800 bg-zinc-900/70 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-zinc-300">Story Plan</p>
              <p className="mt-1 text-[11px] text-zinc-500">
                Analyze your uploaded original images in order, extract the existing plot exactly as shown, then render those same scenes with your assigned characters.
              </p>
              <div className="mt-2 inline-flex rounded-lg border border-zinc-800 bg-zinc-950/80 p-1">
                <button
                  type="button"
                  onClick={() => storyBatch.onOutputModeChange("scene-frames")}
                  disabled={isReplacing}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition ${
                    storyBatch.outputMode === "scene-frames"
                      ? "bg-emerald-500 text-zinc-950"
                      : "text-zinc-300 hover:bg-zinc-800"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  Scene Frames
                </button>
                <button
                  type="button"
                  onClick={() => storyBatch.onOutputModeChange("comic-grid-4")}
                  disabled={isReplacing}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition ${
                    storyBatch.outputMode === "comic-grid-4"
                      ? "bg-emerald-500 text-zinc-950"
                      : "text-zinc-300 hover:bg-zinc-800"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  4-Panel Comic
                </button>
                <button
                  type="button"
                  onClick={() => storyBatch.onOutputModeChange("comic-grid-9")}
                  disabled={isReplacing}
                  className={`rounded-md px-3 py-1.5 text-[11px] font-medium transition ${
                    storyBatch.outputMode === "comic-grid-9"
                      ? "bg-emerald-500 text-zinc-950"
                      : "text-zinc-300 hover:bg-zinc-800"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  9-Panel Comic
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={storyBatch.onAnalyze}
                disabled={sourceItems.length === 0 || isReplacing}
                className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-emerald-500 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {storyBatch.status === "processing" && !storyHasPlan ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {storyHasPlan ? "Reanalyze Original Plot" : "Analyze Original Plot"}
              </button>
              <button
                type="button"
                onClick={storyBatch.onGenerate}
                disabled={
                  !storyHasPlan ||
                  isReplacing ||
                  ((storyBatch.outputMode === "comic-grid-4" || storyBatch.outputMode === "comic-grid-9") &&
                    !canRenderComicGrid)
                }
                className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
              >
                {isReplacing && storyHasPlan ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                {storyBatch.outputMode === "comic-grid-4"
                  ? "Render 4-Panel Pages"
                  : storyBatch.outputMode === "comic-grid-9"
                    ? "Render 9-Panel Pages"
                    : "Render Scenes"}
              </button>
            </div>
          </div>

          {sourceItems.length === 0 ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-xs text-zinc-500">
              Upload at least one original story image to analyze the existing plot.
            </p>
          ) : !storyBatch.plan ? (
            <p className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-3 text-xs text-zinc-500">
              Analyze the uploaded original images to extract the existing title, synopsis, story roles, and one faithful scene prompt per image.
            </p>
          ) : (
            <div className="space-y-3">
              {storyBatch.outputMode === "comic-grid-4" || storyBatch.outputMode === "comic-grid-9" ? (
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
                  Auto-pagination mode. The app keeps the extracted scene order and splits all scenes into balanced{" "}
                  {storyBatch.outputMode === "comic-grid-4" ? "up-to-4-panel" : "up-to-9-panel"} comic pages.
                  {canRenderComicGrid
                    ? " Short final pages can use fewer panels when that keeps pacing cleaner."
                    : " Analyze at least one original story image to enable this mode."}
                </div>
              ) : null}

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Story Title</div>
                  <input
                    type="text"
                    value={storyBatch.plan.title}
                    onChange={(event) => storyBatch.onPlanTitleChange(event.target.value.slice(0, 100))}
                    disabled={isReplacing}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
                <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Visual Style</div>
                  <textarea
                    value={storyBatch.plan.visualStyle}
                    onChange={(event) => storyBatch.onPlanVisualStyleChange(event.target.value.slice(0, 260))}
                    disabled={isReplacing}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>
              </div>

              <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Synopsis</div>
                <textarea
                  value={storyBatch.plan.synopsis}
                  onChange={(event) => storyBatch.onPlanSynopsisChange(event.target.value.slice(0, 500))}
                  disabled={isReplacing}
                  rows={3}
                  className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>

              <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Story Roles</div>
                <div className="grid gap-2 md:grid-cols-2">
                  {storyBatch.plan.storyRoles.map((role) => (
                    <div key={role.id} className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-3">
                      <div className="text-xs font-medium text-zinc-100">{role.label}</div>
                      <div className="mt-1 text-[11px] text-zinc-400">{role.description}</div>
                      <select
                        value={role.assignedCharacterId ?? ""}
                        onChange={(event) => storyBatch.onStoryRoleCharacterChange(role.id, event.target.value || null)}
                        disabled={isReplacing}
                        className="mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">Assign character</option>
                        {availableCharacters.map((character) => (
                          <option key={character.id} value={character.id}>
                            {character.name}
                          </option>
                        ))}
                      </select>
                      {role.assignedCharacterImageBase64 ? (
                        <div className="mt-2 flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-2">
                          <img
                            src={role.assignedCharacterImageBase64}
                            alt={role.assignedCharacterName ?? "Assigned character"}
                            className="h-9 w-9 rounded border border-zinc-700 object-cover"
                          />
                          <span className="min-w-0 text-xs text-zinc-300">
                            <span className="block truncate font-medium text-zinc-100">
                              {role.assignedCharacterName}
                            </span>
                            <span className="block text-[11px] text-zinc-500">Used for this story role</span>
                          </span>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              {(storyBatch.outputMode === "comic-grid-4" || storyBatch.outputMode === "comic-grid-9") &&
              storyBatch.plan.comicPages.length > 0 ? (
                <div className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
                  <div className="text-[11px] uppercase tracking-[0.12em] text-zinc-500">Comic Pages</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {storyBatch.plan.comicPages.map((comicPage) => {
                      const isSelected = selectedStoryComic?.id === comicPage.id;
                      return (
                        <button
                          key={comicPage.id}
                          type="button"
                          onClick={() => storyBatch.onSelectComicPage(comicPage.id)}
                          disabled={isReplacing}
                          className={`rounded-lg border p-3 text-left transition ${
                            isSelected
                              ? "border-emerald-500/70 bg-emerald-500/10"
                              : "border-zinc-800 bg-zinc-900/80 hover:border-zinc-700"
                          } disabled:cursor-not-allowed disabled:opacity-60`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="text-xs font-medium text-zinc-100">{comicPage.title}</div>
                              <div className="mt-1 text-[11px] text-zinc-400">
                                Scenes {comicPage.sceneStartIndex + 1}-{comicPage.sceneEndIndex + 1} / {comicPage.panelCount} panel
                                {comicPage.panelCount === 1 ? "" : "s"}
                              </div>
                            </div>
                            <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusClassName(comicPage.status)}`}>
                              {statusLabel(comicPage.status)}
                            </span>
                          </div>
                          {comicPage.resultImageBase64 ? (
                            <img
                              src={comicPage.resultImageBase64}
                              alt={comicPage.title}
                              className="mt-2 h-14 w-full rounded border border-zinc-700 object-cover"
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                {(storyBatch.outputMode === "comic-grid-4" || storyBatch.outputMode === "comic-grid-9") &&
                storyBatch.plan.comicPages.length > 1 ? (
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-[11px] text-zinc-400">
                    Scenes stay in the original order and are automatically balanced across {storyBatch.plan.comicPages.length} comic
                    {" "}page{storyBatch.plan.comicPages.length === 1 ? "" : "s"}.
                  </div>
                ) : null}
                {storyBatch.plan.scenes.map((scene, index) => {
                  const isSelected = selectedStoryScene?.id === scene.id;

                  return (
                    <div
                      key={scene.id}
                      className={`rounded-xl border p-3 transition ${
                        isSelected ? "border-emerald-500/70 bg-emerald-500/10" : "border-zinc-800 bg-zinc-900/70"
                      }`}
                    >
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => storyBatch.onSelectScene(scene.id)}
                            className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                              isSelected
                                ? "bg-emerald-500 text-zinc-950"
                                : "border border-zinc-700 bg-zinc-900 text-zinc-200 hover:border-zinc-500"
                            }`}
                          >
                            {isSelected ? "Previewing" : "Preview Scene"}
                          </button>
                          <span className="text-[11px] text-zinc-500">Scene {index + 1}</span>
                          <span className={`rounded px-1.5 py-0.5 text-[10px] ${statusClassName(scene.status)}`}>
                            {statusLabel(scene.status)}
                          </span>
                        </div>
                        {scene.resultImageBase64 ? (
                          <img
                            src={scene.resultImageBase64}
                            alt={scene.title}
                            className="h-10 w-10 rounded border border-zinc-700 object-cover"
                          />
                        ) : null}
                      </div>

                      <div className="grid gap-2 lg:grid-cols-2">
                        <input
                          type="text"
                          value={scene.title}
                          onChange={(event) => storyBatch.onSceneTitleChange(scene.id, event.target.value.slice(0, 100))}
                          disabled={isReplacing}
                          placeholder="Scene title"
                          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                        <textarea
                          value={scene.narration}
                          onChange={(event) =>
                            storyBatch.onSceneNarrationChange(scene.id, event.target.value.slice(0, 300))
                          }
                          disabled={isReplacing}
                          rows={2}
                          placeholder="Story beat"
                          className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </div>

                      <textarea
                        value={scene.imagePrompt}
                        onChange={(event) => storyBatch.onScenePromptChange(scene.id, event.target.value.slice(0, 1200))}
                        disabled={isReplacing}
                        rows={4}
                        placeholder="Scene image prompt"
                        className="mt-2 w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                      />
                    </div>
                  );
                })}
              </div>
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
                    isActive ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
                  }`}
                >
                  <img
                    src={target.imageBase64}
                    alt={target.name}
                    className="h-9 w-9 rounded border border-zinc-700 object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-zinc-100">{target.name}</span>
                    <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] ${statusClassName(target.status)}`}>
                      {statusLabel(target.status)}
                    </span>
                  </span>
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
                      overlay.isActive ? "border-emerald-400 bg-emerald-400/15" : "border-sky-400/80 bg-sky-400/10"
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
                {replaceMode === "story-batch" ? (
                  <div className="pointer-events-none absolute inset-x-4 bottom-4 rounded-lg border border-zinc-700/80 bg-zinc-950/80 px-3 py-2 text-xs text-zinc-300">
                    This original image is used to extract the exact existing scene, pacing, and framing without changing the plot.
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                {replaceMode === "story-batch"
                  ? "Select one uploaded reference image from the queue to preview it."
                  : "Select one source image from the queue to preview."}
              </p>
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
                download={makeDownloadName(
                  replaceMode === "story-batch"
                    ? storyBatch.outputMode === "comic-grid-4" || storyBatch.outputMode === "comic-grid-9"
                      ? selectedStoryComic?.title ?? null
                      : selectedStoryScene?.title ?? null
                    : selectedSourceName,
                  replaceMode,
                )}
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
                        isSelected ? "border-emerald-500 bg-emerald-500/10" : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
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
