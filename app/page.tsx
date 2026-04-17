"use client";

import { useEffect, useMemo, useState } from "react";
import { CharacterLibrary } from "@/components/CharacterLibrary";
import {
  ReplacerWorkbench,
  type ReplaceMode,
  type ReplacementStatus,
  type RoiOverlay,
  type RoiRect,
  type SceneMappingDraft,
  type SourceQueueDisplayItem,
  type TargetPreviewOption,
  type TargetReplacementStatus,
  type UploadedSourceImage,
  type WorkbenchCandidate,
} from "@/components/ReplacerWorkbench";
import { useCharacterStore, type Character } from "@/hooks/useCharacterStore";
import JSZip from "jszip";
import { saveAs } from "file-saver";

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

type CharacterSelectionMode = "single" | "multi";
type ScoreRoiInput = RoiRect | RoiRect[] | null;

type SceneMappingRequestPayload = {
  label: string;
  roi: RoiRect;
  targetCharacterBase64: string;
  targetCharacterName: string;
  notes?: string;
};

type ReplaceRequestPayload =
  | {
      sourceImageBase64: string;
      targetCharacterBase64: string;
      candidateCount: number;
      enableRefinement: boolean;
      extraPrompt?: string;
    }
  | {
      sourceImageBase64: string;
      subjectMappings: SceneMappingRequestPayload[];
      candidateCount: number;
      enableRefinement: boolean;
      extraPrompt?: string;
    };

type SourceTargetResult = {
  targetCharacterId: string;
  targetCharacterName: string;
  status: TargetReplacementStatus;
  error: string | null;
  candidates: WorkbenchCandidate[];
  selectedCandidateIndex: number;
  resultImageBase64: string | null;
};

type SceneMappingSlot = {
  id: string;
  label: string;
  targetCharacterId: string | null;
  roi: RoiRect | null;
  notes: string;
};

type SceneReplaceResult = {
  status: TargetReplacementStatus;
  error: string | null;
  candidates: WorkbenchCandidate[];
  selectedCandidateIndex: number;
  resultImageBase64: string | null;
};

type SourceBatchItem = {
  id: string;
  name: string;
  sourceImageBase64: string;
  extraPrompt: string;
  targetResults: Record<string, SourceTargetResult>;
  activeTargetCharacterId: string | null;
  sceneMappings: SceneMappingSlot[];
  activeSceneMappingId: string | null;
  sceneResult: SceneReplaceResult;
};

const REQUEST_TIMEOUT_MS = 90000;
const DEFAULT_SCORE_ROI: RoiRect = { x: 0.22, y: 0.1, width: 0.56, height: 0.82 };

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

function getCharacterById(
  characterMap: Map<string, Character>,
  characterId: string | null | undefined,
): Character | null {
  if (!characterId) {
    return null;
  }

  return characterMap.get(characterId) ?? null;
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

function normalizeScoreRois(scoreRois: ScoreRoiInput): RoiRect[] {
  if (!scoreRois) {
    return [DEFAULT_SCORE_ROI];
  }

  if (Array.isArray(scoreRois)) {
    return scoreRois.length > 0 ? scoreRois : [DEFAULT_SCORE_ROI];
  }

  return [scoreRois];
}

async function calculateCandidateScore(
  sourceImageBase64: string,
  resultImageBase64: string,
  scoreRois: ScoreRoiInput,
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
  const roiBounds = normalizeScoreRois(scoreRois).map((roi) => ({
    left: clamp01(roi.x) * width,
    top: clamp01(roi.y) * height,
    right: clamp01(roi.x + roi.width) * width,
    bottom: clamp01(roi.y + roi.height) * height,
  }));

  const step = 4;
  let outsideDiff = 0;
  let outsideCount = 0;
  let globalDiff = 0;
  let globalCount = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const insideRoi = roiBounds.some(
        (bounds) => x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom,
      );
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

function createSceneResult(overrides: Partial<SceneReplaceResult> = {}): SceneReplaceResult {
  return {
    status: "pending",
    error: null,
    candidates: [],
    selectedCandidateIndex: 0,
    resultImageBase64: null,
    ...overrides,
  };
}

function createTargetResult(
  targetCharacterId: string,
  targetCharacterName: string,
  overrides: Partial<SourceTargetResult> = {},
): SourceTargetResult {
  return {
    targetCharacterId,
    targetCharacterName,
    status: "pending",
    error: null,
    candidates: [],
    selectedCandidateIndex: 0,
    resultImageBase64: null,
    ...overrides,
  };
}

function createSceneMappingSlot(index: number, preferredTargetCharacterId: string | null = null): SceneMappingSlot {
  return {
    id: makeId(),
    label: `Subject ${index}`,
    targetCharacterId: preferredTargetCharacterId,
    roi: null,
    notes: "",
  };
}

function getRelevantTargetCharacters(
  selectionMode: CharacterSelectionMode,
  selectedCharacters: Character[],
): Character[] {
  return selectionMode === "single" ? selectedCharacters.slice(0, 1) : selectedCharacters;
}

function syncSourceItemTargets(item: SourceBatchItem, targets: Character[]): SourceBatchItem {
  if (targets.length === 0) {
    if (Object.keys(item.targetResults).length === 0 && item.activeTargetCharacterId === null) {
      return item;
    }

    return {
      ...item,
      targetResults: {},
      activeTargetCharacterId: null,
    };
  }

  let changed = false;
  const nextTargetResults: Record<string, SourceTargetResult> = {};

  for (const target of targets) {
    const existing = item.targetResults[target.id];
    if (existing) {
      const nextExisting =
        existing.targetCharacterName === target.name
          ? existing
          : {
              ...existing,
              targetCharacterName: target.name,
            };
      if (nextExisting !== existing) {
        changed = true;
      }
      nextTargetResults[target.id] = nextExisting;
    } else {
      changed = true;
      nextTargetResults[target.id] = createTargetResult(target.id, target.name);
    }
  }

  if (Object.keys(item.targetResults).length !== targets.length) {
    changed = true;
  }

  const nextActiveTargetId =
    item.activeTargetCharacterId && nextTargetResults[item.activeTargetCharacterId]
      ? item.activeTargetCharacterId
      : targets[0]?.id ?? null;

  if (!changed && nextActiveTargetId === item.activeTargetCharacterId) {
    return item;
  }

  return {
    ...item,
    targetResults: nextTargetResults,
    activeTargetCharacterId: nextActiveTargetId,
  };
}

function syncSceneMappingsWithCharacters(
  item: SourceBatchItem,
  characterMap: Map<string, Character>,
): SourceBatchItem {
  let changed = false;

  const nextSceneMappings = item.sceneMappings.map((mapping) => {
    if (mapping.targetCharacterId && !characterMap.has(mapping.targetCharacterId)) {
      changed = true;
      return {
        ...mapping,
        targetCharacterId: null,
      };
    }

    return mapping;
  });

  const nextActiveSceneMappingId =
    item.activeSceneMappingId && nextSceneMappings.some((mapping) => mapping.id === item.activeSceneMappingId)
      ? item.activeSceneMappingId
      : nextSceneMappings[0]?.id ?? null;

  if (!changed && nextActiveSceneMappingId === item.activeSceneMappingId) {
    return item;
  }

  return {
    ...item,
    sceneMappings: nextSceneMappings,
    activeSceneMappingId: nextActiveSceneMappingId,
  };
}

function resolveActiveTargetId(item: SourceBatchItem | null, targets: Character[]): string | null {
  if (!item) {
    return targets[0]?.id ?? null;
  }

  if (item.activeTargetCharacterId && item.targetResults[item.activeTargetCharacterId]) {
    return item.activeTargetCharacterId;
  }

  for (const target of targets) {
    if (item.targetResults[target.id]) {
      return target.id;
    }
  }

  return targets[0]?.id ?? null;
}

function resolveActiveSceneMappingId(item: SourceBatchItem | null): string | null {
  if (!item) {
    return null;
  }

  if (item.activeSceneMappingId && item.sceneMappings.some((mapping) => mapping.id === item.activeSceneMappingId)) {
    return item.activeSceneMappingId;
  }

  return item.sceneMappings[0]?.id ?? null;
}

function summarizeGlobalSourceStatus(
  item: SourceBatchItem,
  targets: Character[],
): { status: ReplacementStatus; detailText?: string } {
  if (targets.length === 0) {
    return { status: "pending" };
  }

  let pending = 0;
  let processing = 0;
  let done = 0;
  let failed = 0;

  for (const target of targets) {
    const status = item.targetResults[target.id]?.status ?? "pending";
    if (status === "processing") {
      processing += 1;
    } else if (status === "done") {
      done += 1;
    } else if (status === "failed") {
      failed += 1;
    } else {
      pending += 1;
    }
  }

  const detailParts = [`${done}/${targets.length} done`];
  if (processing > 0) {
    detailParts.push(`${processing} processing`);
  }
  if (failed > 0) {
    detailParts.push(`${failed} failed`);
  }

  let status: ReplacementStatus = "pending";

  if (processing > 0) {
    status = "processing";
  } else if (done === targets.length) {
    status = "done";
  } else if (failed === targets.length) {
    status = "failed";
  } else if (done > 0 || failed > 0) {
    status = "partial";
  } else if (pending > 0) {
    status = "pending";
  }

  return {
    status,
    detailText: targets.length > 1 ? detailParts.join(", ") : undefined,
  };
}

function summarizeSceneSourceStatus(
  item: SourceBatchItem,
  characterMap: Map<string, Character>,
): { status: ReplacementStatus; detailText?: string } {
  const totalMappings = item.sceneMappings.length;
  const configuredMappings = item.sceneMappings.filter(
    (mapping) => Boolean(mapping.roi) && Boolean(getCharacterById(characterMap, mapping.targetCharacterId)),
  ).length;

  return {
    status: item.sceneResult.status,
    detailText:
      totalMappings > 0 ? `${configuredMappings}/${totalMappings} subjects mapped` : "No subject mappings yet",
  };
}

function createSourceBatchItem(image: UploadedSourceImage, targets: Character[]): SourceBatchItem {
  return syncSourceItemTargets(
    {
      id: makeId(),
      name: image.name,
      sourceImageBase64: image.imageBase64,
      extraPrompt: "",
      targetResults: {},
      activeTargetCharacterId: targets[0]?.id ?? null,
      sceneMappings: [],
      activeSceneMappingId: null,
      sceneResult: createSceneResult(),
    },
    targets,
  );
}

async function parseReplaceResponse(
  response: Response,
  sourceImageBase64: string,
  scoreRois: ScoreRoiInput,
): Promise<WorkbenchCandidate[]> {
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
        const score = await calculateCandidateScore(sourceImageBase64, candidate.imageBase64, scoreRois);
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
}

async function requestReplaceCandidates(
  payload: ReplaceRequestPayload,
  scoreRois: ScoreRoiInput,
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
      body: JSON.stringify(payload),
    });

    return await parseReplaceResponse(response, payload.sourceImageBase64, scoreRois);
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

async function downloadResultsAsZip(
  sourceItems: SourceBatchItem[],
  replaceMode: ReplaceMode,
  targetCount: number,
  zipFilename: string,
): Promise<void> {
  const zip = new JSZip();
  let exportIndex = 0;

  if (replaceMode === "scene-mapping") {
    for (const item of sourceItems) {
      if (item.sceneResult.status !== "done" || !item.sceneResult.resultImageBase64) {
        continue;
      }

      exportIndex += 1;
      const base64Data = item.sceneResult.resultImageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
      const binaryData = atob(base64Data);
      const byteArray = new Uint8Array(binaryData.length);
      for (let i = 0; i < binaryData.length; i += 1) {
        byteArray[i] = binaryData.charCodeAt(i);
      }

      const safeSourceName = item.name.replace(/[^a-z0-9\-_.]/gi, "_").slice(0, 50) || "manga-image";
      zip.file(`${String(exportIndex).padStart(3, "0")}_${safeSourceName}__scene_mapped.png`, byteArray, {
        binary: true,
      });
    }
  } else {
    for (const item of sourceItems) {
      for (const targetResult of Object.values(item.targetResults)) {
        if (targetResult.status !== "done" || !targetResult.resultImageBase64) {
          continue;
        }

        exportIndex += 1;
        const base64Data = targetResult.resultImageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
        const binaryData = atob(base64Data);
        const byteArray = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i += 1) {
          byteArray[i] = binaryData.charCodeAt(i);
        }

        const safeSourceName = item.name.replace(/[^a-z0-9\-_.]/gi, "_").slice(0, 50) || "manga-image";
        const safeTargetName =
          targetResult.targetCharacterName.replace(/[^a-z0-9\-_.]/gi, "_").slice(0, 40) || "target";
        const filename =
          targetCount > 1
            ? `${String(exportIndex).padStart(3, "0")}_${safeSourceName}__${safeTargetName}.png`
            : `${String(exportIndex).padStart(3, "0")}_${safeSourceName}.png`;

        zip.file(filename, byteArray, { binary: true });
      }
    }
  }

  if (exportIndex === 0) {
    throw new Error("No completed images to download.");
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  saveAs(blob, zipFilename);
}

export default function HomePage() {
  const { addCharacter, removeCharacter, getCharacters, storageWarning } = useCharacterStore();
  const characters = getCharacters();

  const [replaceMode, setReplaceMode] = useState<ReplaceMode>("global-targets");
  const [characterSelectionMode, setCharacterSelectionMode] = useState<CharacterSelectionMode>("single");
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [sourceItems, setSourceItems] = useState<SourceBatchItem[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [globalRoi, setGlobalRoi] = useState<RoiRect | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(null);

  const characterMap = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);

  useEffect(() => {
    setSelectedCharacterIds((prev) => {
      const next = prev.filter((id) => characterMap.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [characterMap]);

  useEffect(() => {
    setSourceItems((prev) => {
      const next = prev.map((item) => syncSceneMappingsWithCharacters(item, characterMap));
      const changed = next.some((item, index) => item !== prev[index]);
      return changed ? next : prev;
    });
  }, [characterMap]);

  const selectedCharacters = useMemo(
    () =>
      selectedCharacterIds
        .map((id) => getCharacterById(characterMap, id))
        .filter((character): character is Character => Boolean(character)),
    [characterMap, selectedCharacterIds],
  );

  const activeTargetCharacters = useMemo(
    () => getRelevantTargetCharacters(characterSelectionMode, selectedCharacters),
    [characterSelectionMode, selectedCharacters],
  );

  useEffect(() => {
    setSourceItems((prev) => {
      const next = prev.map((item) => syncSourceItemTargets(item, activeTargetCharacters));
      const changed = next.some((item, index) => item !== prev[index]);
      return changed ? next : prev;
    });
  }, [activeTargetCharacters]);

  const selectedSource = useMemo(
    () => sourceItems.find((sourceItem) => sourceItem.id === selectedSourceId) ?? null,
    [sourceItems, selectedSourceId],
  );

  const selectedSourceActiveTargetId = useMemo(
    () => resolveActiveTargetId(selectedSource, activeTargetCharacters),
    [activeTargetCharacters, selectedSource],
  );

  const selectedTargetResult = useMemo(() => {
    if (!selectedSource || !selectedSourceActiveTargetId) {
      return null;
    }

    return selectedSource.targetResults[selectedSourceActiveTargetId] ?? null;
  }, [selectedSource, selectedSourceActiveTargetId]);

  const activeSceneMappingId = useMemo(() => resolveActiveSceneMappingId(selectedSource), [selectedSource]);

  const sceneMappings = useMemo<SceneMappingDraft[]>(
    () =>
      (selectedSource?.sceneMappings ?? []).map((mapping) => {
        const targetCharacter = getCharacterById(characterMap, mapping.targetCharacterId);

        return {
          id: mapping.id,
          label: mapping.label,
          targetCharacterId: mapping.targetCharacterId,
          targetCharacterName: targetCharacter?.name ?? null,
          targetCharacterImageBase64: targetCharacter?.imageBase64 ?? null,
          roi: mapping.roi,
          notes: mapping.notes,
        };
      }),
    [characterMap, selectedSource],
  );

  const activeSceneMapping = useMemo(
    () => sceneMappings.find((mapping) => mapping.id === activeSceneMappingId) ?? null,
    [activeSceneMappingId, sceneMappings],
  );

  const queueItems: SourceQueueDisplayItem[] = useMemo(
    () =>
      sourceItems.map((item) => {
        if (replaceMode === "scene-mapping") {
          const summary = summarizeSceneSourceStatus(item, characterMap);
          return {
            id: item.id,
            name: item.name,
            sourceImageBase64: item.sourceImageBase64,
            resultImageBase64: item.sceneResult.resultImageBase64,
            extraPrompt: item.extraPrompt,
            status: summary.status,
            error: item.sceneResult.error,
            detailText: summary.detailText,
          };
        }

        const activeTargetId = resolveActiveTargetId(item, activeTargetCharacters);
        const activeTargetResult = activeTargetId ? item.targetResults[activeTargetId] ?? null : null;
        const summary = summarizeGlobalSourceStatus(item, activeTargetCharacters);

        return {
          id: item.id,
          name: item.name,
          sourceImageBase64: item.sourceImageBase64,
          resultImageBase64: activeTargetResult?.resultImageBase64 ?? null,
          extraPrompt: item.extraPrompt,
          status: summary.status,
          error: activeTargetResult?.error ?? null,
          detailText: summary.detailText,
        };
      }),
    [activeTargetCharacters, characterMap, replaceMode, sourceItems],
  );

  const targetOptions = useMemo<TargetPreviewOption[]>(
    () =>
      activeTargetCharacters.map((target) => {
        const targetResult = selectedSource?.targetResults[target.id] ?? null;

        return {
          id: target.id,
          name: target.name,
          imageBase64: target.imageBase64,
          status: targetResult?.status ?? "pending",
          error: targetResult?.error ?? null,
        };
      }),
    [activeTargetCharacters, selectedSource],
  );

  const roiOverlays = useMemo<RoiOverlay[]>(() => {
    if (replaceMode === "scene-mapping") {
      return sceneMappings
        .filter((mapping) => mapping.roi)
        .map((mapping) => ({
          id: mapping.id,
          label: mapping.label,
          roi: mapping.roi as RoiRect,
          isActive: mapping.id === activeSceneMappingId,
        }));
    }

    return globalRoi
      ? [
          {
            id: "global-roi",
            label: "Target ROI",
            roi: globalRoi,
            isActive: true,
          },
        ]
      : [];
  }, [activeSceneMappingId, globalRoi, replaceMode, sceneMappings]);

  const currentResultImageBase64 =
    replaceMode === "scene-mapping"
      ? selectedSource?.sceneResult.resultImageBase64 ?? null
      : selectedTargetResult?.resultImageBase64 ?? null;
  const currentResultError =
    replaceMode === "scene-mapping" ? selectedSource?.sceneResult.error ?? null : selectedTargetResult?.error ?? null;
  const currentCandidates =
    replaceMode === "scene-mapping" ? selectedSource?.sceneResult.candidates ?? [] : selectedTargetResult?.candidates ?? [];
  const currentSelectedCandidateIndex =
    replaceMode === "scene-mapping"
      ? selectedSource?.sceneResult.selectedCandidateIndex ?? 0
      : selectedTargetResult?.selectedCandidateIndex ?? 0;
  const currentResultLabel =
    replaceMode === "scene-mapping"
      ? selectedSource
        ? "Mapped Scene"
        : null
      : targetOptions.find((target) => target.id === selectedSourceActiveTargetId)?.name ?? null;
  const activeRoi =
    replaceMode === "scene-mapping" ? activeSceneMapping?.roi ?? null : globalRoi;
  const activeRoiLabel =
    replaceMode === "scene-mapping" ? activeSceneMapping?.label ?? null : "Target ROI";

  const handleReplaceModeChange = (mode: ReplaceMode) => {
    setReplaceMode(mode);
    setError(null);
  };

  const handleSelectionModeChange = (mode: CharacterSelectionMode) => {
    setCharacterSelectionMode(mode);
    setSelectedCharacterIds((prev) => {
      if (mode === "single") {
        return prev[0] ? [prev[0]] : [];
      }

      return prev;
    });
    setError(null);
  };

  const handleToggleCharacterSelection = (id: string) => {
    setSelectedCharacterIds((prev) => {
      if (characterSelectionMode === "single") {
        return [id];
      }

      return prev.includes(id) ? prev.filter((existingId) => existingId !== id) : [...prev, id];
    });
    setError(null);
  };

  const handleAddCharacter = async (name: string, imageBase64: string) => {
    const character = await addCharacter(name, imageBase64);

    setSelectedCharacterIds((prev) => {
      if (characterSelectionMode === "single") {
        return [character.id];
      }

      return prev.includes(character.id) ? prev : [...prev, character.id];
    });
  };

  const handleRemoveCharacter = (id: string) => {
    removeCharacter(id);
    setSelectedCharacterIds((prev) => prev.filter((existingId) => existingId !== id));
  };

  const handleSourceImagesUpload = (images: UploadedSourceImage[]) => {
    if (images.length === 0) {
      return;
    }

    const newItems: SourceBatchItem[] = images.map((image) => createSourceBatchItem(image, activeTargetCharacters));

    setSourceItems((prev) => [...newItems, ...prev]);
    setSelectedSourceId(newItems[0]?.id ?? null);
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

  const handleActiveTargetCharacterChange = (id: string) => {
    if (!selectedSourceId) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === selectedSourceId
          ? {
              ...item,
              activeTargetCharacterId: id,
            }
          : item,
      ),
    );
  };

  const handleAddSceneMapping = () => {
    if (!selectedSourceId) {
      return;
    }

    const preferredTargetCharacterId = characters[0]?.id ?? null;

    setSourceItems((prev) =>
      prev.map((item) => {
        if (item.id !== selectedSourceId) {
          return item;
        }

        const nextMapping = createSceneMappingSlot(item.sceneMappings.length + 1, preferredTargetCharacterId);

        return {
          ...item,
          sceneMappings: [...item.sceneMappings, nextMapping],
          activeSceneMappingId: nextMapping.id,
        };
      }),
    );
  };

  const handleRemoveSceneMapping = (mappingId: string) => {
    if (!selectedSourceId) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) => {
        if (item.id !== selectedSourceId) {
          return item;
        }

        const nextMappings = item.sceneMappings.filter((mapping) => mapping.id !== mappingId);
        const nextActiveSceneMappingId =
          item.activeSceneMappingId && nextMappings.some((mapping) => mapping.id === item.activeSceneMappingId)
            ? item.activeSceneMappingId
            : nextMappings[0]?.id ?? null;

        return {
          ...item,
          sceneMappings: nextMappings,
          activeSceneMappingId: nextActiveSceneMappingId,
        };
      }),
    );
  };

  const handleActiveSceneMappingChange = (mappingId: string) => {
    if (!selectedSourceId) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === selectedSourceId
          ? {
              ...item,
              activeSceneMappingId: mappingId,
            }
          : item,
      ),
    );
  };

  const handleSceneMappingLabelChange = (mappingId: string, value: string) => {
    if (!selectedSourceId || isReplacing) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === selectedSourceId
          ? {
              ...item,
              sceneMappings: item.sceneMappings.map((mapping) =>
                mapping.id === mappingId
                  ? {
                      ...mapping,
                      label: value || "Subject",
                    }
                  : mapping,
              ),
            }
          : item,
      ),
    );
  };

  const handleSceneMappingTargetCharacterChange = (mappingId: string, targetCharacterId: string | null) => {
    if (!selectedSourceId || isReplacing) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === selectedSourceId
          ? {
              ...item,
              sceneMappings: item.sceneMappings.map((mapping) =>
                mapping.id === mappingId
                  ? {
                      ...mapping,
                      targetCharacterId,
                    }
                  : mapping,
              ),
            }
          : item,
      ),
    );
  };

  const handleSceneMappingNotesChange = (mappingId: string, value: string) => {
    if (!selectedSourceId || isReplacing) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === selectedSourceId
          ? {
              ...item,
              sceneMappings: item.sceneMappings.map((mapping) =>
                mapping.id === mappingId
                  ? {
                      ...mapping,
                      notes: value,
                    }
                  : mapping,
              ),
            }
          : item,
      ),
    );
  };

  const handleActiveRoiChange = (nextRoi: RoiRect | null) => {
    if (replaceMode === "global-targets") {
      setGlobalRoi(nextRoi);
      return;
    }

    if (!selectedSourceId || !activeSceneMappingId) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === selectedSourceId
          ? {
              ...item,
              sceneMappings: item.sceneMappings.map((mapping) =>
                mapping.id === activeSceneMappingId
                  ? {
                      ...mapping,
                      roi: nextRoi,
                    }
                  : mapping,
              ),
            }
          : item,
      ),
    );
  };

  const handleClearActiveRoi = () => {
    if (replaceMode === "global-targets") {
      setGlobalRoi(null);
      return;
    }

    if (!selectedSourceId || !activeSceneMappingId) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === selectedSourceId
          ? {
              ...item,
              sceneMappings: item.sceneMappings.map((mapping) =>
                mapping.id === activeSceneMappingId
                  ? {
                      ...mapping,
                      roi: null,
                    }
                  : mapping,
              ),
            }
          : item,
      ),
    );
  };

  const handleSelectCandidate = (index: number) => {
    if (!selectedSourceId) {
      return;
    }

    if (replaceMode === "scene-mapping") {
      setSourceItems((prev) =>
        prev.map((item) => {
          if (item.id !== selectedSourceId) {
            return item;
          }

          const selectedCandidate = item.sceneResult.candidates[index];
          if (!selectedCandidate) {
            return item;
          }

          return {
            ...item,
            sceneResult: {
              ...item.sceneResult,
              selectedCandidateIndex: index,
              resultImageBase64: selectedCandidate.imageBase64,
            },
          };
        }),
      );
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) => {
        if (item.id !== selectedSourceId) {
          return item;
        }

        const activeTargetId = resolveActiveTargetId(item, activeTargetCharacters);
        if (!activeTargetId) {
          return item;
        }

        const targetResult = item.targetResults[activeTargetId];
        const selectedCandidate = targetResult?.candidates[index];

        if (!targetResult || !selectedCandidate) {
          return item;
        }

        return {
          ...item,
          targetResults: {
            ...item.targetResults,
            [activeTargetId]: {
              ...targetResult,
              selectedCandidateIndex: index,
              resultImageBase64: selectedCandidate.imageBase64,
            },
          },
        };
      }),
    );
  };

  const handleSelectedSourcePromptChange = (value: string) => {
    if (!selectedSourceId || isReplacing) {
      return;
    }

    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === selectedSourceId
          ? {
              ...item,
              extraPrompt: value,
            }
          : item,
      ),
    );
  };

  const executeGlobalReplace = async () => {
    if (sourceItems.length === 0) {
      setError("Please upload at least one source image.");
      return;
    }

    if (activeTargetCharacters.length === 0) {
      setError(
        characterSelectionMode === "multi"
          ? "Please select at least one target character."
          : "Please select a target character.",
      );
      return;
    }

    const queue = sourceItems.map((item) => ({
      id: item.id,
      sourceImageBase64: item.sourceImageBase64,
      extraPrompt: item.extraPrompt,
    }));
    const targets = activeTargetCharacters.map((target) => ({
      id: target.id,
      name: target.name,
      imageBase64: target.imageBase64,
    }));
    const totalTasks = queue.length * targets.length;

    setIsReplacing(true);
    setError(null);
    setBatchProgress({ completed: 0, total: totalTasks });
    setSourceItems((prev) =>
      prev.map((item) => ({
        ...item,
        targetResults: Object.fromEntries(
          targets.map((target) => [target.id, createTargetResult(target.id, target.name)]),
        ) as Record<string, SourceTargetResult>,
        activeTargetCharacterId: targets[0]?.id ?? null,
      })),
    );

    let failedCount = 0;
    let completedCount = 0;

    try {
      for (const current of queue) {
        setSelectedSourceId(current.id);

        for (const target of targets) {
          setSourceItems((prev) =>
            prev.map((item) =>
              item.id === current.id
                ? {
                    ...item,
                    activeTargetCharacterId: target.id,
                    targetResults: {
                      ...item.targetResults,
                      [target.id]: createTargetResult(target.id, target.name, {
                        status: "processing",
                      }),
                    },
                  }
                : item,
            ),
          );

          try {
            let candidates: WorkbenchCandidate[] | null = null;
            let lastError: unknown = null;

            for (let attempt = 0; attempt < 2; attempt += 1) {
              try {
                candidates = await requestReplaceCandidates(
                  {
                    sourceImageBase64: current.sourceImageBase64,
                    targetCharacterBase64: target.imageBase64,
                    candidateCount: 1,
                    enableRefinement: false,
                    ...(current.extraPrompt.trim() ? { extraPrompt: current.extraPrompt.trim() } : {}),
                  },
                  globalRoi,
                );
                break;
              } catch (attemptError) {
                lastError = attemptError;
                const message = attemptError instanceof Error ? attemptError.message : "";
                if (!message.toLowerCase().includes("timed out")) {
                  break;
                }
              }
            }

            if (!candidates) {
              throw lastError ?? new Error("Replacement request failed.");
            }

            setSourceItems((prev) =>
              prev.map((item) =>
                item.id === current.id
                  ? {
                      ...item,
                      activeTargetCharacterId: target.id,
                      targetResults: {
                        ...item.targetResults,
                        [target.id]: createTargetResult(target.id, target.name, {
                          status: "done",
                          candidates,
                          selectedCandidateIndex: 0,
                          resultImageBase64: candidates[0]?.imageBase64 ?? null,
                        }),
                      },
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
                      activeTargetCharacterId: target.id,
                      targetResults: {
                        ...item.targetResults,
                        [target.id]: createTargetResult(target.id, target.name, {
                          status: "failed",
                          error: message,
                        }),
                      },
                    }
                  : item,
              ),
            );
          }

          completedCount += 1;
          setBatchProgress({ completed: completedCount, total: totalTasks });
        }
      }
    } finally {
      setIsReplacing(false);
      setBatchProgress((prev) => (prev ? { ...prev, completed: prev.total } : null));
    }

    if (failedCount > 0) {
      setError(`${failedCount}/${totalTasks} replacement(s) failed. Select an image and target to view details.`);
    } else {
      setError(null);
    }
  };

  const executeSceneMappingReplace = async () => {
    if (!selectedSource) {
      setError("Please select one source image first.");
      return;
    }

    if (selectedSource.sceneMappings.length === 0) {
      setError("Please add at least one subject mapping for this image.");
      return;
    }

    const resolvedMappings = selectedSource.sceneMappings.map((mapping) => {
      return {
        mapping,
        targetCharacter: getCharacterById(characterMap, mapping.targetCharacterId),
      };
    });

    const incompleteMappings = resolvedMappings.filter(
      ({ mapping, targetCharacter }) => !mapping.roi || !targetCharacter,
    );

    if (incompleteMappings.length > 0) {
      setError("Please complete every subject mapping with both a target character and an ROI before running.");
      return;
    }

    const requestMappings: SceneMappingRequestPayload[] = resolvedMappings.map(({ mapping, targetCharacter }) => ({
      label: mapping.label.trim() || "Subject",
      roi: mapping.roi as RoiRect,
      targetCharacterBase64: targetCharacter!.imageBase64,
      targetCharacterName: targetCharacter!.name,
      ...(mapping.notes.trim() ? { notes: mapping.notes.trim() } : {}),
    }));

    setIsReplacing(true);
    setError(null);
    setBatchProgress({ completed: 0, total: 1 });
    setSourceItems((prev) =>
      prev.map((item) =>
        item.id === selectedSource.id
          ? {
              ...item,
              sceneResult: createSceneResult({
                status: "processing",
              }),
            }
          : item,
      ),
    );

    try {
      let candidates: WorkbenchCandidate[] | null = null;
      let lastError: unknown = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          candidates = await requestReplaceCandidates(
            {
              sourceImageBase64: selectedSource.sourceImageBase64,
              subjectMappings: requestMappings,
              candidateCount: 1,
              enableRefinement: false,
              ...(selectedSource.extraPrompt.trim() ? { extraPrompt: selectedSource.extraPrompt.trim() } : {}),
            },
            requestMappings.map((mapping) => mapping.roi),
          );
          break;
        } catch (attemptError) {
          lastError = attemptError;
          const message = attemptError instanceof Error ? attemptError.message : "";
          if (!message.toLowerCase().includes("timed out")) {
            break;
          }
        }
      }

      if (!candidates) {
        throw lastError ?? new Error("Mapped replace request failed.");
      }

      setSourceItems((prev) =>
        prev.map((item) =>
          item.id === selectedSource.id
            ? {
                ...item,
                sceneResult: createSceneResult({
                  status: "done",
                  candidates,
                  selectedCandidateIndex: 0,
                  resultImageBase64: candidates[0]?.imageBase64 ?? null,
                }),
              }
            : item,
        ),
      );
      setError(null);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Unexpected error while replacing mapped subjects.";

      setSourceItems((prev) =>
        prev.map((item) =>
          item.id === selectedSource.id
            ? {
                ...item,
                sceneResult: createSceneResult({
                  status: "failed",
                  error: message,
                }),
              }
            : item,
        ),
      );
      setError(message);
    } finally {
      setIsReplacing(false);
      setBatchProgress({ completed: 1, total: 1 });
    }
  };

  const handleExecuteReplace = async () => {
    if (replaceMode === "scene-mapping") {
      await executeSceneMappingReplace();
      return;
    }

    await executeGlobalReplace();
  };

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#1f2937_0%,_#09090b_55%)] px-4 py-6 text-zinc-100 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:h-[calc(100vh-3rem)] lg:flex-row">
        <div className="lg:w-1/4">
          <CharacterLibrary
            characters={characters}
            selectionMode={characterSelectionMode}
            selectedCharacterIds={selectedCharacterIds}
            storageWarning={storageWarning}
            isBusy={isReplacing}
            selectionEnabled={replaceMode === "global-targets"}
            onSelectionModeChange={handleSelectionModeChange}
            onToggleCharacterSelection={handleToggleCharacterSelection}
            onAddCharacter={handleAddCharacter}
            onRemoveCharacter={handleRemoveCharacter}
          />
        </div>

        <div className="lg:w-3/4">
          <ReplacerWorkbench
            replaceMode={replaceMode}
            onReplaceModeChange={handleReplaceModeChange}
            sourceItems={queueItems}
            selectedSourceId={selectedSourceId}
            selectedSourceName={selectedSource?.name ?? null}
            sourceImageBase64={selectedSource?.sourceImageBase64 ?? null}
            resultImageBase64={currentResultImageBase64}
            resultLabel={currentResultLabel}
            selectedSourcePrompt={selectedSource?.extraPrompt ?? ""}
            selectedResultError={currentResultError}
            globalSelectedCharacters={activeTargetCharacters}
            targetOptions={targetOptions}
            activeTargetCharacterId={selectedSourceActiveTargetId}
            availableCharacters={characters}
            sceneMappings={sceneMappings}
            activeSceneMappingId={activeSceneMappingId}
            roiOverlays={roiOverlays}
            activeRoi={activeRoi}
            activeRoiLabel={activeRoiLabel}
            isReplacing={isReplacing}
            error={error}
            candidates={currentCandidates}
            selectedCandidateIndex={currentSelectedCandidateIndex}
            batchProgress={batchProgress}
            onSourceImagesUpload={handleSourceImagesUpload}
            onSelectSource={handleSelectSource}
            onRemoveSource={handleRemoveSource}
            onExecuteReplace={handleExecuteReplace}
            onActiveRoiChange={handleActiveRoiChange}
            onClearActiveRoi={handleClearActiveRoi}
            onSelectCandidate={handleSelectCandidate}
            onSelectedSourcePromptChange={handleSelectedSourcePromptChange}
            onActiveTargetCharacterChange={handleActiveTargetCharacterChange}
            onAddSceneMapping={handleAddSceneMapping}
            onRemoveSceneMapping={handleRemoveSceneMapping}
            onActiveSceneMappingChange={handleActiveSceneMappingChange}
            onSceneMappingLabelChange={handleSceneMappingLabelChange}
            onSceneMappingTargetCharacterChange={handleSceneMappingTargetCharacterChange}
            onSceneMappingNotesChange={handleSceneMappingNotesChange}
            extraActionsLeft={
              <button
                type="button"
                onClick={async () => {
                  try {
                    await downloadResultsAsZip(
                      sourceItems,
                      replaceMode,
                      activeTargetCharacters.length,
                      `manga-replaced-${new Date().toISOString().slice(0, 10)}.zip`,
                    );
                  } catch (downloadError) {
                    setError(downloadError instanceof Error ? downloadError.message : "Failed to create ZIP file.");
                  }
                }}
                disabled={
                  (replaceMode === "scene-mapping"
                    ? sourceItems.every(
                        (item) => item.sceneResult.status !== "done" || !item.sceneResult.resultImageBase64,
                      )
                    : sourceItems.every((item) =>
                        Object.values(item.targetResults).every(
                          (targetResult) => targetResult.status !== "done" || !targetResult.resultImageBase64,
                        ),
                      )) || isReplacing
                }
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" x2="12" y1="15" y2="3" />
                </svg>
                下载 ZIP
              </button>
            }
          />
        </div>
      </div>
    </main>
  );
}
