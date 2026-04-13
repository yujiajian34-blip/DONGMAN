"use client";

import { useMemo, useState } from "react";
import { CharacterLibrary } from "@/components/CharacterLibrary";
import {
  ReplacerWorkbench,
  type RoiRect,
  type SourceQueueDisplayItem,
  type UploadedSourceImage,
  type WorkbenchCandidate,
} from "@/components/ReplacerWorkbench";
import { useCharacterStore } from "@/hooks/useCharacterStore";

type ApiCandidate = {
  imageBase64: string;
  meta?: {
    selectedVariant?: string;
    stage?: "initial" | "refined";
  };
};

type ReplaceResponse = {
  imageBase64?: string;
  candidates?: ApiCandidate[];
  error?: string;
  details?: unknown;
};

type SourceBatchItem = SourceQueueDisplayItem & {
  candidates: WorkbenchCandidate[];
  selectedCandidateIndex: number;
};

const REQUEST_TIMEOUT_MS = 90000;

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeImageDataUrl(value: string): string {
  return value.startsWith("data:image/") ? value : `data:image/png;base64,${value}`;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image for scoring."));
    image.src = dataUrl;
  });
}

function computeAverageSaturation(data: Uint8ClampedArray): number {
  let total = 0;
  let count = 0;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] / 255;
    const g = data[index + 1] / 255;
    const b = data[index + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    total += saturation;
    count += 1;
  }

  return count === 0 ? 0 : total / count;
}

async function calculateCandidateScore(
  sourceImageBase64: string,
  resultImageBase64: string,
  roi: RoiRect | null,
): Promise<number> {
  const [sourceImage, resultImage] = await Promise.all([loadImage(sourceImageBase64), loadImage(resultImageBase64)]);

  const baseWidth = Math.min(sourceImage.naturalWidth, resultImage.naturalWidth);
  const baseHeight = Math.min(sourceImage.naturalHeight, resultImage.naturalHeight);
  if (baseWidth <= 0 || baseHeight <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  const maxEdge = 768;
  const scale = Math.min(1, maxEdge / Math.max(baseWidth, baseHeight));
  const width = Math.max(1, Math.round(baseWidth * scale));
  const height = Math.max(1, Math.round(baseHeight * scale));

  const sourceCanvas = document.createElement("canvas");
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  const sourceCtx = sourceCanvas.getContext("2d", { willReadFrequently: true });

  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = width;
  resultCanvas.height = height;
  const resultCtx = resultCanvas.getContext("2d", { willReadFrequently: true });

  if (!sourceCtx || !resultCtx) {
    return Number.POSITIVE_INFINITY;
  }

  sourceCtx.drawImage(sourceImage, 0, 0, width, height);
  resultCtx.drawImage(resultImage, 0, 0, width, height);

  const sourceData = sourceCtx.getImageData(0, 0, width, height).data;
  const resultData = resultCtx.getImageData(0, 0, width, height).data;

  const effectiveRoi = roi ?? { x: 0.22, y: 0.1, width: 0.56, height: 0.82 };
  const roiLeft = clamp01(effectiveRoi.x) * width;
  const roiTop = clamp01(effectiveRoi.y) * height;
  const roiRight = clamp01(effectiveRoi.x + effectiveRoi.width) * width;
  const roiBottom = clamp01(effectiveRoi.y + effectiveRoi.height) * height;

  const step = 4;
  let outsideDiff = 0;
  let outsideCount = 0;
  let globalDiff = 0;
  let globalCount = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const insideRoi = x >= roiLeft && x <= roiRight && y >= roiTop && y <= roiBottom;
      const index = (y * width + x) * 4;
      const pixelDiff =
        Math.abs(sourceData[index] - resultData[index]) +
        Math.abs(sourceData[index + 1] - resultData[index + 1]) +
        Math.abs(sourceData[index + 2] - resultData[index + 2]);

      globalDiff += pixelDiff;
      globalCount += 1;

      if (!insideRoi) {
        outsideDiff += pixelDiff;
        outsideCount += 1;
      }
    }
  }

  if (outsideCount === 0 || globalCount === 0) {
    return Number.POSITIVE_INFINITY;
  }

  const outsideNormalized = outsideDiff / (outsideCount * 3 * 255);
  const globalNormalized = globalDiff / (globalCount * 3 * 255);
  const sourceSaturation = computeAverageSaturation(sourceData);
  const resultSaturation = computeAverageSaturation(resultData);
  const saturationPenalty = Math.abs(sourceSaturation - resultSaturation);

  return outsideNormalized * 0.75 + globalNormalized * 0.2 + saturationPenalty * 0.05;
}

async function requestReplaceCandidates(
  sourceImageBase64: string,
  targetCharacterBase64: string,
  roi: RoiRect | null,
): Promise<WorkbenchCandidate[]> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch("/api/replace", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({
        sourceImageBase64,
        targetCharacterBase64,
        candidateCount: 1,
        enableRefinement: false,
      }),
    });

    const payload = (await response.json()) as ReplaceResponse;

    if (!response.ok) {
      const detailsText =
        typeof payload.details === "string" ? payload.details : payload.details ? JSON.stringify(payload.details) : null;
      throw new Error([payload.error ?? "Replacement request failed.", detailsText].filter(Boolean).join(" "));
    }

    const apiCandidates: ApiCandidate[] =
      payload.candidates && payload.candidates.length > 0
        ? payload.candidates
        : payload.imageBase64
          ? [{ imageBase64: payload.imageBase64 }]
          : [];

    if (apiCandidates.length === 0) {
      throw new Error("No candidates returned by replace API.");
    }

    const normalizedCandidates: WorkbenchCandidate[] = apiCandidates.map((candidate) => ({
      imageBase64: normalizeImageDataUrl(candidate.imageBase64),
      score: null,
      meta: {
        selectedVariant: candidate.meta?.selectedVariant,
        stage: candidate.meta?.stage,
      },
    }));

    if (normalizedCandidates.length === 1) {
      return normalizedCandidates;
    }

    const scoredCandidates = await Promise.all(
      normalizedCandidates.map(async (candidate) => {
        try {
          const score = await calculateCandidateScore(sourceImageBase64, candidate.imageBase64, roi);
          return { ...candidate, score };
        } catch {
          return { ...candidate, score: Number.POSITIVE_INFINITY };
        }
      }),
    );

    scoredCandidates.sort(
      (left, right) => (left.score ?? Number.POSITIVE_INFINITY) - (right.score ?? Number.POSITIVE_INFINITY),
    );

    return scoredCandidates;
  } catch (requestError) {
    if (requestError instanceof DOMException && requestError.name === "AbortError") {
      throw new Error(
        `Replace request timed out (${Math.floor(REQUEST_TIMEOUT_MS / 1000)}s). The gateway may be slow or unavailable.`,
      );
    }
    throw requestError;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export default function HomePage() {
  const { addCharacter, removeCharacter, getCharacters, storageWarning } = useCharacterStore();
  const characters = getCharacters();

  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [sourceItems, setSourceItems] = useState<SourceBatchItem[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [roi, setRoi] = useState<RoiRect | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(null);

  const selectedCharacter = useMemo(
    () => characters.find((character) => character.id === selectedCharacterId) ?? null,
    [characters, selectedCharacterId],
  );

  const selectedSource = useMemo(
    () => sourceItems.find((sourceItem) => sourceItem.id === selectedSourceId) ?? null,
    [sourceItems, selectedSourceId],
  );

  const queueItems: SourceQueueDisplayItem[] = useMemo(
    () =>
      sourceItems.map((item) => ({
        id: item.id,
        name: item.name,
        sourceImageBase64: item.sourceImageBase64,
        resultImageBase64: item.resultImageBase64,
        status: item.status,
        error: item.error,
      })),
    [sourceItems],
  );

  const handleAddCharacter = (name: string, imageBase64: string) => {
    const character = addCharacter(name, imageBase64);
    setSelectedCharacterId(character.id);
  };

  const handleRemoveCharacter = (id: string) => {
    removeCharacter(id);
    if (selectedCharacterId === id) {
      setSelectedCharacterId(null);
    }
  };

  const handleSourceImagesUpload = (images: UploadedSourceImage[]) => {
    if (images.length === 0) {
      return;
    }

    const newItems: SourceBatchItem[] = images.map((image) => ({
      id: makeId(),
      name: image.name,
      sourceImageBase64: image.imageBase64,
      resultImageBase64: null,
      status: "pending",
      error: null,
      candidates: [],
      selectedCandidateIndex: 0,
    }));

    setSourceItems((prev) => [...newItems, ...prev]);
    setSelectedSourceId(newItems[0].id);
    setError(null);
  };

  const handleSelectSource = (id: string) => {
    setSelectedSourceId(id);
  };

  const handleRemoveSource = (id: string) => {
    if (isReplacing) {
      return;
    }

    setSourceItems((prev) => {
      const next = prev.filter((item) => item.id !== id);
      if (selectedSourceId === id) {
        setSelectedSourceId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleSelectCandidate = (index: number) => {
    if (!selectedSourceId) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) => {
        if (item.id !== selectedSourceId) {
          return item;
        }

        const selectedCandidate = item.candidates[index];
        if (!selectedCandidate) {
          return item;
        }

        return {
          ...item,
          selectedCandidateIndex: index,
          resultImageBase64: selectedCandidate.imageBase64,
        };
      }),
    );
  };

  const handleExecuteReplace = async () => {
    if (sourceItems.length === 0) {
      setError("Please upload at least one source image.");
      return;
    }

    if (!selectedCharacter) {
      setError("Please select a target character.");
      return;
    }

    const queue = sourceItems.map((item) => ({
      id: item.id,
      sourceImageBase64: item.sourceImageBase64,
    }));
    const targetCharacterBase64 = selectedCharacter.imageBase64;
    const activeRoi = roi;

    setIsReplacing(true);
    setError(null);
    setBatchProgress({ completed: 0, total: queue.length });

    let failedCount = 0;

    try {
      for (let index = 0; index < queue.length; index += 1) {
        const current = queue[index];
        if (!current) {
          continue;
        }

        setSelectedSourceId(current.id);
        setBatchProgress({ completed: index, total: queue.length });

        setSourceItems((prev) =>
          prev.map((item) =>
            item.id === current.id
              ? {
                  ...item,
                  status: "processing",
                  error: null,
                }
              : item,
          ),
        );

        try {
          const candidates = await requestReplaceCandidates(
            current.sourceImageBase64,
            targetCharacterBase64,
            activeRoi,
          );

          setSourceItems((prev) =>
            prev.map((item) =>
              item.id === current.id
                ? {
                    ...item,
                    status: "done",
                    error: null,
                    candidates,
                    selectedCandidateIndex: 0,
                    resultImageBase64: candidates[0]?.imageBase64 ?? null,
                  }
                : item,
            ),
          );
        } catch (requestError) {
          failedCount += 1;
          const message =
            requestError instanceof Error ? requestError.message : "Unexpected error while replacing this image.";

          setSourceItems((prev) =>
            prev.map((item) =>
              item.id === current.id
                ? {
                    ...item,
                    status: "failed",
                    error: message,
                  }
                : item,
            ),
          );
        }

        setBatchProgress({ completed: index + 1, total: queue.length });
      }
    } finally {
      setIsReplacing(false);
      setBatchProgress((prev) => (prev ? { ...prev, completed: prev.total } : null));
    }

    if (failedCount > 0) {
      setError(`${failedCount}/${queue.length} image(s) failed. Select an item in the queue to view details.`);
    } else {
      setError(null);
    }
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#1f2937_0%,_#09090b_55%)] px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:h-[calc(100vh-3rem)] lg:flex-row">
        <div className="lg:w-1/4">
          <CharacterLibrary
            characters={characters}
            selectedCharacterId={selectedCharacterId}
            storageWarning={storageWarning}
            onSelectCharacter={setSelectedCharacterId}
            onAddCharacter={handleAddCharacter}
            onRemoveCharacter={handleRemoveCharacter}
          />
        </div>

        <div className="lg:w-3/4">
          <ReplacerWorkbench
            sourceItems={queueItems}
            selectedSourceId={selectedSourceId}
            selectedSourceName={selectedSource?.name ?? null}
            sourceImageBase64={selectedSource?.sourceImageBase64 ?? null}
            resultImageBase64={selectedSource?.resultImageBase64 ?? null}
            selectedSourceError={selectedSource?.error ?? null}
            selectedCharacter={selectedCharacter}
            isReplacing={isReplacing}
            error={error}
            roi={roi}
            candidates={selectedSource?.candidates ?? []}
            selectedCandidateIndex={selectedSource?.selectedCandidateIndex ?? 0}
            batchProgress={batchProgress}
            onSourceImagesUpload={handleSourceImagesUpload}
            onSelectSource={handleSelectSource}
            onRemoveSource={handleRemoveSource}
            onExecuteReplace={handleExecuteReplace}
            onRoiChange={setRoi}
            onSelectCandidate={handleSelectCandidate}
          />
        </div>
      </div>
    </main>
  );
}
