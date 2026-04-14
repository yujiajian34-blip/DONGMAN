"use client";

import { ChangeEvent, MouseEvent, useMemo, useRef, useState } from "react";
import { Crop, Download, Loader2, Sparkles, Trash2, X } from "lucide-react";
import type { Character } from "@/hooks/useCharacterStore";

export type RoiRect = {
  x: number;
  y: number;
  width: number;
  height: number;
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
  status: "pending" | "processing" | "done" | "failed";
  error: string | null;
};

type ReplacerWorkbenchProps = {
  sourceItems: SourceQueueDisplayItem[];
  selectedSourceId: string | null;
  selectedSourceName: string | null;
  sourceImageBase64: string | null;
  resultImageBase64: string | null;
  selectedSourcePrompt: string;
  selectedSourceError: string | null;
  selectedCharacter: Character | null;
  isReplacing: boolean;
  error: string | null;
  roi: RoiRect | null;
  candidates: WorkbenchCandidate[];
  selectedCandidateIndex: number;
  batchProgress: { completed: number; total: number } | null;
  onSourceImagesUpload: (images: UploadedSourceImage[]) => void;
  onSelectSource: (id: string) => void;
  onRemoveSource: (id: string) => void;
  onExecuteReplace: () => void;
  onRoiChange: (roi: RoiRect | null) => void;
  onSelectCandidate: (index: number) => void;
  onSelectedSourcePromptChange: (value: string) => void;
  /** Optional actions to render to the left of the execute button */
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

function makeDownloadName(name: string | null): string {
  if (!name) {
    return "manga-replaced.png";
  }

  const normalized = name.replace(/\.[a-zA-Z0-9]+$/, "").replace(/\s+/g, "-");
  return `${normalized || "manga-image"}-replaced.png`;
}

function statusLabel(status: SourceQueueDisplayItem["status"]): string {
  if (status === "processing") {
    return "Processing";
  }
  if (status === "done") {
    return "Done";
  }
  if (status === "failed") {
    return "Failed";
  }
  return "Pending";
}

function statusClassName(status: SourceQueueDisplayItem["status"]): string {
  if (status === "processing") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-200";
  }
  if (status === "done") {
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-200";
  }
  if (status === "failed") {
    return "border-rose-500/40 bg-rose-500/10 text-rose-200";
  }
  return "border-zinc-700 bg-zinc-800/60 text-zinc-300";
}

export function ReplacerWorkbench({
  sourceItems,
  selectedSourceId,
  selectedSourceName,
  sourceImageBase64,
  resultImageBase64,
  selectedSourcePrompt,
  selectedSourceError,
  selectedCharacter,
  isReplacing,
  error,
  roi,
  candidates,
  selectedCandidateIndex,
  batchProgress,
  onSourceImagesUpload,
  onSelectSource,
  onRemoveSource,
  onExecuteReplace,
  onRoiChange,
  onSelectCandidate,
  onSelectedSourcePromptChange,
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
      onRoiChange(null);
      setDraftRoi(null);
      setRoiStart(null);
      setIsDrawingRoi(false);
      setUploadError(null);
      event.target.value = "";
    } catch (readError) {
      setUploadError(readError instanceof Error ? readError.message : "Failed to read source files.");
    }
  };

  const canRun = sourceItems.length > 0 && Boolean(selectedCharacter) && !isReplacing;
  const activeRoi = isDrawingRoi ? draftRoi : roi;

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
    if (!sourceImageBase64) {
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
      onRoiChange(null);
      return;
    }

    onRoiChange(draftRoi);
  };

  return (
    <section className="h-full rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-4 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-300">Replacement Workbench</h2>
          <p className="mt-1 text-xs text-zinc-500">
            Batch upload source images, then replace with one target character.
            {isReplacing ? " Gateway processing can take 30-70s per image." : ""}
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
            ? `Replacing ${batchProgress?.completed ?? 0}/${batchProgress?.total ?? sourceItems.length}`
            : `Execute Batch Replace (${sourceItems.length})`}
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
          <p className="text-[11px] text-zinc-500">Click an item to preview/edit ROI</p>
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
                  <span className="truncate text-xs text-zinc-200">{item.name}</span>
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
        {selectedCharacter ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
            Current reference: <span className="font-medium text-zinc-100">{selectedCharacter.name}</span>
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-500">
            Pick a target character from the library.
          </div>
        )}

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Crop size={12} />
            Drag on selected source to mark subject ROI
          </span>
        </div>

        {roi ? (
          <button
            type="button"
            onClick={() => onRoiChange(null)}
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
              ? "Example: Keep short orange hair, tired narrow eyes, masculine jawline, plain gray shirt."
              : "Select one source image first."
          }
          className="w-full resize-y rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      {error ? <p className="mb-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-xs text-rose-300">{error}</p> : null}
      {selectedSourceError ? (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
          Selected item error: {selectedSourceError}
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
                className="relative h-full w-full select-none"
                onMouseDown={beginRoiDraw}
                onMouseMove={continueRoiDraw}
                onMouseUp={finishRoiDraw}
                onMouseLeave={finishRoiDraw}
              >
                <img src={sourceImageBase64} alt="Source preview" className="h-full w-full rounded-lg object-contain" draggable={false} />
                {activeRoi ? (
                  <div
                    className="pointer-events-none absolute border-2 border-emerald-400 bg-emerald-400/15"
                    style={{
                      left: `${activeRoi.x * 100}%`,
                      top: `${activeRoi.y * 100}%`,
                      width: `${activeRoi.width * 100}%`,
                      height: `${activeRoi.height * 100}%`,
                    }}
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Select one source image from the queue to preview.</p>
            )}
          </div>
        </div>

        <div className="flex h-full flex-col rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2 text-xs font-medium uppercase tracking-[0.12em] text-zinc-400">
            <span>Result</span>
            {resultImageBase64 ? (
              <a
                href={resultImageBase64}
                download={makeDownloadName(selectedSourceName)}
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
              <p className="text-xs text-zinc-500">
                {selectedItem?.status === "processing" ? "Generating..." : "Generated result appears here."}
              </p>
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

