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
  type StoryComicDraft,
  type StoryOutputMode,
  type StoryPlanDraft,
  type StoryPlanStatus,
  type StoryRoleDraft,
  type StorySceneDraft,
  type TargetPreviewOption,
  type TargetReplacementStatus,
  type UploadedSourceImage,
  type WorkbenchCandidate,
} from "@/components/ReplacerWorkbench";
import { useCharacterStore, type Character } from "@/hooks/useCharacterStore";

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

type ReplaceFailureAttempt = {
  status?: number;
};

type ReplaceFailureUpstreamError = {
  status?: number;
};

type ReplaceFailureRound = {
  attempts?: ReplaceFailureAttempt[];
  upstreamErrors?: ReplaceFailureUpstreamError[];
};

type ReplaceFailureDetails = {
  message?: string;
  failedRounds?: ReplaceFailureRound[];
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

type StoryPlanApiRole = {
  label?: string;
  description?: string;
};

type StoryPlanApiScene = {
  title?: string;
  narration?: string;
  imagePrompt?: string;
};

type StoryPlanResponse = {
  title?: string;
  synopsis?: string;
  visualStyle?: string;
  storyRoles?: StoryPlanApiRole[];
  scenes?: StoryPlanApiScene[];
  error?: string;
  details?: unknown;
};

type StoryPlanRequestPayload = {
  sourceImages: Array<{
    name: string;
    imageBase64: string;
  }>;
  storyDirection?: string;
};

type CharacterAppearanceResponse = {
  appearance?: string;
  error?: string;
  details?: unknown;
};

type CharacterAppearanceRequestPayload = {
  characterName: string;
  imageBase64: string;
};

type StorySceneRequestPayload = {
  storyTitle: string;
  synopsis: string;
  visualStyle: string;
  sceneTitle: string;
  sceneNarration: string;
  scenePrompt: string;
  storyDirection?: string;
  storyRoles: StoryRoleDraft[];
};

type StoryComicScenePayload = {
  title: string;
  narration: string;
  imagePrompt: string;
};

type StoryComicRequestPayload = {
  storyTitle: string;
  synopsis: string;
  visualStyle: string;
  storyDirection?: string;
  storyRoles: StoryRoleDraft[];
  scenes: StoryComicScenePayload[];
  panelCount: number;
  pageCapacity: number;
};

// The server may try multiple upstream payload variants before responding.
// Keep the client timeout comfortably above that path so we don't abort
// requests that are still progressing on the server.
const REQUEST_TIMEOUT_MS = 360000;
class ReplaceRequestTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplaceRequestTimeoutError";
    Object.setPrototypeOf(this, ReplaceRequestTimeoutError.prototype);
  }
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampText(value: unknown, maxLength: number, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function getFailureStatuses(details: unknown): number[] {
  if (!isRecord(details) || !Array.isArray(details.failedRounds)) {
    return [];
  }

  const statuses: number[] = [];

  for (const round of details.failedRounds as ReplaceFailureRound[]) {
    if (Array.isArray(round.upstreamErrors)) {
      for (const upstreamError of round.upstreamErrors) {
        const status = Number(upstreamError?.status);
        if (Number.isFinite(status)) {
          statuses.push(status);
        }
      }
    }

    if (Array.isArray(round.attempts)) {
      for (const attempt of round.attempts) {
        const status = Number(attempt?.status);
        if (Number.isFinite(status)) {
          statuses.push(status);
        }
      }
    }
  }

  return statuses;
}

function buildReplaceFailureMessage(response: Response, payload: ReplaceResponse): string {
  const baseMessage = payload.error ?? "Replacement request failed.";

  if (typeof payload.details === "string") {
    return [baseMessage, payload.details].filter(Boolean).join(" ");
  }

  const details = isRecord(payload.details) ? (payload.details as ReplaceFailureDetails) : null;
  const detailMessage = typeof details?.message === "string" ? details.message : null;
  const failureStatuses = getFailureStatuses(payload.details);

  if (failureStatuses.length > 0) {
    if (failureStatuses.some((status) => status === 401 || status === 403)) {
      return "Gateway authentication failed. Check the configured token and retry.";
    }

    if (failureStatuses.some((status) => status === 429)) {
      return "Gateway is rate limited right now. Wait a moment and retry.";
    }

    if (failureStatuses.every((status) => status === 408)) {
      return "Gateway timed out before it returned an image. Try again, reduce image size, or reduce mapped subjects.";
    }
  }

  if (response.status >= 500 && detailMessage) {
    return `${baseMessage} ${detailMessage}`;
  }

  return detailMessage ? `${baseMessage} ${detailMessage}` : baseMessage;
}

function buildApiFailureMessage(response: Response, payload: { error?: string; details?: unknown }, fallback: string): string {
  const baseMessage = payload.error ?? fallback;

  if (typeof payload.details === "string") {
    return [baseMessage, payload.details].filter(Boolean).join(" ");
  }

  const details = isRecord(payload.details) ? payload.details : null;
  const detailMessage = typeof details?.message === "string" ? details.message : null;

  if (response.status === 401 || response.status === 403) {
    return "Gateway authentication failed. Check the configured token and retry.";
  }

  if (response.status === 429) {
    return "Gateway is rate limited right now. Wait a moment and retry.";
  }

  if (response.status === 408) {
    return "Gateway timed out before it returned a complete response. Try again in a moment.";
  }

  return detailMessage ? `${baseMessage} ${detailMessage}` : baseMessage;
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
    return [];
  }

  if (Array.isArray(scoreRois)) {
    return scoreRois;
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

function createStoryScene(
  index: number,
  scene: Partial<Pick<StorySceneDraft, "title" | "narration" | "imagePrompt">> = {},
): StorySceneDraft {
  return {
    id: makeId(),
    title: scene.title?.trim() || `Scene ${index}`,
    narration: scene.narration?.trim() || "A key beat in the generated story.",
    imagePrompt: scene.imagePrompt?.trim() || "Generate a cinematic story illustration based on this scene.",
    status: "pending",
    error: null,
    candidates: [],
    selectedCandidateIndex: 0,
    resultImageBase64: null,
  };
}

function createStoryComicDraft(
  pageIndex: number,
  panelCount: number,
  sceneStartIndex: number,
  sceneEndIndex: number,
  overrides: Partial<Pick<StoryComicDraft, "title">> = {},
): StoryComicDraft {
  return {
    id: makeId(),
    title: overrides.title?.trim() || `Comic Page ${pageIndex} (${panelCount} Panels)`,
    pageIndex,
    panelCount,
    sceneStartIndex,
    sceneEndIndex,
    status: "pending",
    error: null,
    candidates: [],
    selectedCandidateIndex: 0,
    resultImageBase64: null,
  };
}

function getComicPanelCount(storyOutputMode: StoryOutputMode): number {
  return storyOutputMode === "comic-grid-4" ? 4 : 9;
}

function paginateSceneIndices(totalScenes: number, panelCapacity: number): Array<{
  pageIndex: number;
  panelCount: number;
  sceneStartIndex: number;
  sceneEndIndex: number;
}> {
  if (totalScenes <= 0) {
    return [];
  }

  const pageCount = Math.ceil(totalScenes / panelCapacity);
  const basePageSize = Math.floor(totalScenes / pageCount);
  const remainder = totalScenes % pageCount;
  const pages: Array<{
    pageIndex: number;
    panelCount: number;
    sceneStartIndex: number;
    sceneEndIndex: number;
  }> = [];

  let cursor = 0;
  for (let index = 0; index < pageCount; index += 1) {
    const panelCount = basePageSize + (index < remainder ? 1 : 0);
    pages.push({
      pageIndex: index + 1,
      panelCount,
      sceneStartIndex: cursor,
      sceneEndIndex: cursor + panelCount - 1,
    });
    cursor += panelCount;
  }

  return pages;
}

function buildStoryComicPages(scenes: StorySceneDraft[], storyOutputMode: StoryOutputMode): StoryComicDraft[] {
  const panelCapacity = getComicPanelCount(storyOutputMode);
  const pageSpecs = paginateSceneIndices(scenes.length, panelCapacity);

  return pageSpecs.map((pageSpec) =>
    createStoryComicDraft(
      pageSpec.pageIndex,
      pageSpec.panelCount,
      pageSpec.sceneStartIndex,
      pageSpec.sceneEndIndex,
      {
        title: `Comic Page ${pageSpec.pageIndex} (${pageSpec.panelCount} Panels)`,
      },
    ),
  );
}

function resetStoryComicPages(comicPages: StoryComicDraft[]): StoryComicDraft[] {
  return comicPages.map((comicPage) => ({
    ...comicPage,
    status: "pending",
    error: null,
    candidates: [],
    selectedCandidateIndex: 0,
    resultImageBase64: null,
  }));
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

function summarizeStoryBatchStatus(
  storyPlan: StoryPlanDraft | null,
  storyOutputMode: StoryOutputMode,
  isReplacing: boolean,
): { status: ReplacementStatus; detailText?: string } {
  if (!storyPlan) {
    return {
      status: isReplacing ? "processing" : "pending",
      detailText: "Story reference image",
    };
  }

  if (storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9") {
    const panelCount = getComicPanelCount(storyOutputMode);
    const totalComicPages = storyPlan.comicPages.length;
    const doneComicPages = storyPlan.comicPages.filter(
      (comicPage) => comicPage.status === "done" && comicPage.resultImageBase64,
    ).length;
    const failedComicPages = storyPlan.comicPages.filter((comicPage) => comicPage.status === "failed").length;
    const processingComicPages = storyPlan.comicPages.filter((comicPage) => comicPage.status === "processing").length;

    let status: ReplacementStatus = "pending";
    if (processingComicPages > 0 || isReplacing) {
      status = "processing";
    } else if (totalComicPages > 0 && doneComicPages === totalComicPages) {
      status = "done";
    } else if (failedComicPages === totalComicPages && totalComicPages > 0) {
      status = "failed";
    } else if (doneComicPages > 0 || failedComicPages > 0) {
      status = "partial";
    }

    return {
      status,
      detailText:
        storyPlan.scenes.length >= panelCount
          ? `${totalComicPages} comic page${totalComicPages === 1 ? "" : "s"} planned`
          : `Need at least ${panelCount} scenes for the comic page`,
    };
  }

  const totalScenes = storyPlan.scenes.length;
  const doneScenes = storyPlan.scenes.filter((scene) => scene.status === "done" && scene.resultImageBase64).length;
  const failedScenes = storyPlan.scenes.filter((scene) => scene.status === "failed").length;
  const processingScenes = storyPlan.scenes.filter((scene) => scene.status === "processing").length;

  let status: ReplacementStatus = "pending";
  if (processingScenes > 0 || isReplacing) {
    status = "processing";
  } else if (totalScenes > 0 && doneScenes === totalScenes) {
    status = "done";
  } else if (doneScenes > 0 || failedScenes > 0) {
    status = "partial";
  }

  const detailText =
    totalScenes > 0
      ? `${totalScenes} scenes drafted${doneScenes > 0 ? `, ${doneScenes} rendered` : ""}`
      : "Story reference image";

  return { status, detailText };
}

function buildSceneMappingRequestMappings(
  item: SourceBatchItem,
  characterMap: Map<string, Character>,
): SceneMappingRequestPayload[] | null {
  if (item.sceneMappings.length === 0) {
    return null;
  }

  const requestMappings: SceneMappingRequestPayload[] = [];

  for (const mapping of item.sceneMappings) {
    const targetCharacter = getCharacterById(characterMap, mapping.targetCharacterId);

    if (!mapping.roi || !targetCharacter) {
      return null;
    }

    requestMappings.push({
      label: mapping.label.trim() || "Subject",
      roi: mapping.roi,
      targetCharacterBase64: targetCharacter.imageBase64,
      targetCharacterName: targetCharacter.name,
      ...(mapping.notes.trim() ? { notes: mapping.notes.trim() } : {}),
    });
  }

  return requestMappings;
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
  sourceImageBase64: string | null,
  scoreRois: ScoreRoiInput,
): Promise<WorkbenchCandidate[]> {
  const payload = (await response.json()) as ReplaceResponse;

  if (!response.ok) {
    throw new Error(buildReplaceFailureMessage(response, payload));
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

  if (!sourceImageBase64) {
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

async function requestApiCandidates(
  endpoint: string,
  payload: Record<string, unknown>,
  sourceImageBase64: string | null,
  scoreRois: ScoreRoiInput,
): Promise<WorkbenchCandidate[]> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    return await parseReplaceResponse(response, sourceImageBase64, scoreRois);
  } catch (requestError) {
    if (requestError instanceof DOMException && requestError.name === "AbortError") {
      throw new ReplaceRequestTimeoutError(
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

async function requestReplaceCandidates(
  payload: ReplaceRequestPayload,
  scoreRois: ScoreRoiInput,
): Promise<WorkbenchCandidate[]> {
  return requestApiCandidates("/api/replace", payload, payload.sourceImageBase64, scoreRois);
}

async function requestStorySceneCandidates(payload: StorySceneRequestPayload): Promise<WorkbenchCandidate[]> {
  return requestApiCandidates("/api/story-scene", payload, null, null);
}

async function requestStoryComicCandidates(payload: StoryComicRequestPayload): Promise<WorkbenchCandidate[]> {
  return requestApiCandidates("/api/story-comic", payload, null, null);
}

async function requestCharacterAppearance(payload: CharacterAppearanceRequestPayload): Promise<string> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch("/api/character-appearance", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as CharacterAppearanceResponse;
    if (!response.ok) {
      throw new Error(buildApiFailureMessage(response, data, "Character appearance analysis failed."));
    }

    const appearance = clampText(
      data.appearance,
      320,
      `Use the exact visual identity of ${payload.characterName} from the uploaded portrait.`,
    );

    if (!appearance) {
      throw new Error("Character appearance analysis returned no usable description.");
    }

    return appearance;
  } catch (requestError) {
    if (requestError instanceof DOMException && requestError.name === "AbortError") {
      throw new ReplaceRequestTimeoutError(
        `Character appearance analysis timed out (${Math.floor(REQUEST_TIMEOUT_MS / 1000)}s). The gateway may be slow or unavailable.`,
      );
    }

    throw requestError;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

async function requestStoryPlan(
  payload: StoryPlanRequestPayload,
  storyOutputMode: StoryOutputMode,
): Promise<StoryPlanDraft> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const controller = new AbortController();
    timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const response = await fetch("/api/story-plan", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    const data = (await response.json()) as StoryPlanResponse;
    if (!response.ok) {
      throw new Error(buildApiFailureMessage(response, data, "Story analysis request failed."));
    }

    const scenes = Array.isArray(data.scenes)
      ? data.scenes.map((scene, index) =>
          createStoryScene(index + 1, {
            title: clampText(scene.title, 100, `Scene ${index + 1}`),
            narration: clampText(scene.narration, 300, "A key beat in the generated story."),
            imagePrompt: clampText(
              scene.imagePrompt,
              1200,
              "Generate a cinematic story illustration based on this scene.",
            ),
          }),
        )
      : [];

    if (scenes.length === 0) {
      throw new Error("Story analysis returned no usable scenes.");
    }

    return {
      title: clampText(data.title, 100, "Generated Story"),
      synopsis: clampText(
        data.synopsis,
        500,
        "A generated visual story built from the uploaded original images.",
      ),
      visualStyle: clampText(
        data.visualStyle,
        260,
        "Cinematic manga-inspired illustration with strong composition and scene continuity.",
      ),
      storyRoles:
        Array.isArray(data.storyRoles) && data.storyRoles.length > 0
          ? data.storyRoles.map((role, index) => ({
              id: makeId(),
              label: clampText(role.label, 60, `Role ${index + 1}`),
              description: clampText(role.description, 160, "Important story role inferred from the original images."),
              assignedCharacterId: null,
              assignedCharacterName: null,
              assignedCharacterImageBase64: null,
              assignedCharacterAppearance: null,
            }))
          : [
              {
                id: makeId(),
                label: "Lead Role",
                description: "Primary recurring role inferred from the uploaded original images.",
                assignedCharacterId: null,
                assignedCharacterName: null,
                assignedCharacterImageBase64: null,
                assignedCharacterAppearance: null,
              },
            ],
      scenes,
      comicPages: buildStoryComicPages(
        scenes,
        storyOutputMode === "comic-grid-9" ? "comic-grid-9" : "comic-grid-4",
      ),
    };
  } catch (requestError) {
    if (requestError instanceof DOMException && requestError.name === "AbortError") {
      throw new ReplaceRequestTimeoutError(
        `Story analysis timed out (${Math.floor(REQUEST_TIMEOUT_MS / 1000)}s). The gateway may be slow or unavailable.`,
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
  storyPlan: StoryPlanDraft | null,
  storyOutputMode: StoryOutputMode,
): Promise<void> {
  const [{ default: JSZip }, fileSaverModule] = await Promise.all([import("jszip"), import("file-saver")]);
  const saveAs =
    typeof fileSaverModule.saveAs === "function"
      ? fileSaverModule.saveAs
      : typeof (fileSaverModule.default as ((...args: unknown[]) => void) | undefined) === "function"
        ? (fileSaverModule.default as (blob: Blob, filename: string) => void)
        : typeof (fileSaverModule.default as { saveAs?: (blob: Blob, filename: string) => void } | undefined)?.saveAs ===
            "function"
          ? (fileSaverModule.default as { saveAs: (blob: Blob, filename: string) => void }).saveAs
          : null;

  if (!saveAs) {
    throw new Error("ZIP download is unavailable because the file saver module did not expose a save function.");
  }
  const zip = new JSZip();
  let exportIndex = 0;

  if (replaceMode === "story-batch") {
    if (!storyPlan) {
      throw new Error("No generated story scenes to download.");
    }

    const hasDoneComicPages = storyPlan.comicPages.some(
      (comicPage) => comicPage.status === "done" && Boolean(comicPage.resultImageBase64),
    );
    const hasDoneScenes = storyPlan.scenes.some((scene) => scene.status === "done" && Boolean(scene.resultImageBase64));
    const shouldExportComicPages =
      (storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9")
        ? hasDoneComicPages || !hasDoneScenes
        : hasDoneComicPages && !hasDoneScenes;

    if (shouldExportComicPages) {
      const panelCount = getComicPanelCount(storyOutputMode);
      for (const comicPage of storyPlan.comicPages) {
        if (comicPage.status !== "done" || !comicPage.resultImageBase64) {
          continue;
        }

        exportIndex += 1;
        const base64Data = comicPage.resultImageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
        const binaryData = atob(base64Data);
        const byteArray = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i += 1) {
          byteArray[i] = binaryData.charCodeAt(i);
        }

        const safeComicName =
          comicPage.title.replace(/[^a-z0-9\-_.]/gi, "_").slice(0, 60) || `${panelCount}-panel-comic`;
        zip.file(`${String(exportIndex).padStart(3, "0")}_${safeComicName}.png`, byteArray, {
          binary: true,
        });
      }
    } else {
      for (const scene of storyPlan.scenes) {
        if (scene.status !== "done" || !scene.resultImageBase64) {
          continue;
        }

        exportIndex += 1;
        const base64Data = scene.resultImageBase64.replace(/^data:image\/[a-z]+;base64,/, "");
        const binaryData = atob(base64Data);
        const byteArray = new Uint8Array(binaryData.length);
        for (let i = 0; i < binaryData.length; i += 1) {
          byteArray[i] = binaryData.charCodeAt(i);
        }

        const safeSceneName = scene.title.replace(/[^a-z0-9\-_.]/gi, "_").slice(0, 60) || "story-scene";
        zip.file(`${String(exportIndex).padStart(3, "0")}_${safeSceneName}.png`, byteArray, {
          binary: true,
        });
      }
    }
  } else if (replaceMode === "scene-mapping") {
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
  const [isReplacing, setIsReplacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ completed: number; total: number } | null>(null);
  const [storyPrompt, setStoryPrompt] = useState("");
  const [storyOutputMode, setStoryOutputMode] = useState<StoryOutputMode>("scene-frames");
  const [storyPlan, setStoryPlan] = useState<StoryPlanDraft | null>(null);
  const [storyPlanStatus, setStoryPlanStatus] = useState<StoryPlanStatus>("idle");
  const [selectedStorySceneId, setSelectedStorySceneId] = useState<string | null>(null);
  const [selectedStoryComicId, setSelectedStoryComicId] = useState<string | null>(null);

  const characterMap = useMemo(() => new Map(characters.map((character) => [character.id, character])), [characters]);

  const invalidateStoryPlan = () => {
    setStoryPlan(null);
    setSelectedStorySceneId(null);
    setSelectedStoryComicId(null);
    setStoryPlanStatus("idle");
  };

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

  useEffect(() => {
    setStoryPlan((prev) => {
      if (!prev) {
        return prev;
      }

      let changed = false;
      const nextRoles = prev.storyRoles.map((role) => {
        if (!role.assignedCharacterId) {
          return role;
        }

        const character = getCharacterById(characterMap, role.assignedCharacterId);
        if (!character) {
          changed = true;
          return {
            ...role,
            assignedCharacterId: null,
            assignedCharacterName: null,
            assignedCharacterImageBase64: null,
            assignedCharacterAppearance: null,
          };
        }

        if (
          role.assignedCharacterName !== character.name ||
          role.assignedCharacterImageBase64 !== character.imageBase64
        ) {
          changed = true;
          return {
            ...role,
            assignedCharacterName: character.name,
            assignedCharacterImageBase64: character.imageBase64,
            assignedCharacterAppearance: null,
          };
        }

        return role;
      });

      return changed ? { ...prev, storyRoles: nextRoles, comicPages: resetStoryComicPages(prev.comicPages) } : prev;
    });
  }, [characterMap]);

  useEffect(() => {
    if (storyOutputMode === "scene-frames") {
      return;
    }

    setStoryPlan((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        comicPages: buildStoryComicPages(prev.scenes, storyOutputMode),
      };
    });
  }, [storyOutputMode]);

  useEffect(() => {
    setSelectedStoryComicId((prev) => {
      if (!storyPlan || storyPlan.comicPages.length === 0) {
        return null;
      }

      return storyPlan.comicPages.some((comicPage) => comicPage.id === prev) ? prev : storyPlan.comicPages[0]?.id ?? null;
    });
  }, [storyPlan]);

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

  const mappedBatchReadyCount = useMemo(
    () => sourceItems.filter((item) => Boolean(buildSceneMappingRequestMappings(item, characterMap))).length,
    [characterMap, sourceItems],
  );

  const selectedStoryScene = useMemo(
    () => storyPlan?.scenes.find((scene) => scene.id === selectedStorySceneId) ?? storyPlan?.scenes[0] ?? null,
    [selectedStorySceneId, storyPlan],
  );

  const selectedStoryComic = useMemo(
    () => storyPlan?.comicPages.find((comicPage) => comicPage.id === selectedStoryComicId) ?? storyPlan?.comicPages[0] ?? null,
    [selectedStoryComicId, storyPlan],
  );

  const storyRoleReadyCount = useMemo(
    () => storyPlan?.storyRoles.filter((role) => Boolean(role.assignedCharacterId)).length ?? 0,
    [storyPlan],
  );

  const queueItems: SourceQueueDisplayItem[] = useMemo(
    () =>
      sourceItems.map((item) => {
        if (replaceMode === "story-batch") {
          const summary = summarizeStoryBatchStatus(storyPlan, storyOutputMode, isReplacing);
          return {
            id: item.id,
            name: item.name,
            sourceImageBase64: item.sourceImageBase64,
            resultImageBase64: null,
            extraPrompt: "",
            status: summary.status,
            error: null,
            detailText: summary.detailText,
          };
        }

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
    [activeTargetCharacters, characterMap, isReplacing, replaceMode, sourceItems, storyOutputMode, storyPlan],
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

    return [];
  }, [activeSceneMappingId, replaceMode, sceneMappings]);

  const currentResultImageBase64 =
    replaceMode === "story-batch"
      ? storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9"
        ? selectedStoryComic?.resultImageBase64 ?? null
        : selectedStoryScene?.resultImageBase64 ?? null
      : replaceMode === "scene-mapping"
      ? selectedSource?.sceneResult.resultImageBase64 ?? null
      : selectedTargetResult?.resultImageBase64 ?? null;
  const currentResultError =
    replaceMode === "story-batch"
      ? storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9"
        ? selectedStoryComic?.error ?? null
        : selectedStoryScene?.error ?? null
      : replaceMode === "scene-mapping"
        ? selectedSource?.sceneResult.error ?? null
        : selectedTargetResult?.error ?? null;
  const currentCandidates =
    replaceMode === "story-batch"
      ? storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9"
        ? selectedStoryComic?.candidates ?? []
        : selectedStoryScene?.candidates ?? []
      : replaceMode === "scene-mapping"
        ? selectedSource?.sceneResult.candidates ?? []
        : selectedTargetResult?.candidates ?? [];
  const currentSelectedCandidateIndex =
    replaceMode === "story-batch"
      ? storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9"
        ? selectedStoryComic?.selectedCandidateIndex ?? 0
        : selectedStoryScene?.selectedCandidateIndex ?? 0
      : replaceMode === "scene-mapping"
      ? selectedSource?.sceneResult.selectedCandidateIndex ?? 0
      : selectedTargetResult?.selectedCandidateIndex ?? 0;
  const currentResultLabel =
    replaceMode === "story-batch"
      ? storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9"
        ? selectedStoryComic?.title ?? storyPlan?.title ?? null
        : selectedStoryScene?.title ?? storyPlan?.title ?? null
      : replaceMode === "scene-mapping"
      ? selectedSource
        ? "Mapped Scene"
        : null
      : targetOptions.find((target) => target.id === selectedSourceActiveTargetId)?.name ?? null;
  const activeRoi = replaceMode === "scene-mapping" ? activeSceneMapping?.roi ?? null : null;
  const activeRoiLabel = replaceMode === "scene-mapping" ? activeSceneMapping?.label ?? null : null;
  const hasStoryZipResults =
    (storyPlan?.comicPages.some((comicPage) => comicPage.status === "done" && Boolean(comicPage.resultImageBase64)) ??
      false) ||
    (storyPlan?.scenes.some((scene) => scene.status === "done" && Boolean(scene.resultImageBase64)) ?? false);
  const hasSceneMappingZipResults = sourceItems.some(
    (item) => item.sceneResult.status === "done" && Boolean(item.sceneResult.resultImageBase64),
  );
  const hasGlobalZipResults = sourceItems.some((item) =>
    Object.values(item.targetResults).some(
      (targetResult) => targetResult.status === "done" && Boolean(targetResult.resultImageBase64),
    ),
  );
  const canDownloadZip =
    !isReplacing &&
    (replaceMode === "story-batch"
      ? hasStoryZipResults
      : replaceMode === "scene-mapping"
        ? hasSceneMappingZipResults
        : hasGlobalZipResults);

  const handleReplaceModeChange = (mode: ReplaceMode) => {
    setReplaceMode(mode);
    setError(null);
  };

  const handleStoryOutputModeChange = (mode: StoryOutputMode) => {
    setStoryOutputMode(mode);
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
    invalidateStoryPlan();
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
    invalidateStoryPlan();
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
    if (replaceMode === "story-batch") {
      setStoryPlan((prev) => {
        if (!prev) {
          return prev;
        }

        if (storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9") {
          const activeComicPage =
            prev.comicPages.find((comicPage) => comicPage.id === selectedStoryComicId) ?? prev.comicPages[0];
          const selectedCandidate = activeComicPage?.candidates[index];
          if (!selectedCandidate) {
            return prev;
          }

          return {
            ...prev,
            comicPages: prev.comicPages.map((comicPage) =>
              comicPage.id === activeComicPage.id
                ? {
                    ...comicPage,
                    selectedCandidateIndex: index,
                    resultImageBase64: selectedCandidate.imageBase64,
                  }
                : comicPage,
            ),
          };
        }

        if (!selectedStorySceneId) {
          return prev;
        }

        return {
          ...prev,
          scenes: prev.scenes.map((scene) => {
            if (scene.id !== selectedStorySceneId) {
              return scene;
            }

            const selectedCandidate = scene.candidates[index];
            if (!selectedCandidate) {
              return scene;
            }

            return {
              ...scene,
              selectedCandidateIndex: index,
              resultImageBase64: selectedCandidate.imageBase64,
            };
          }),
        };
      });
      return;
    }

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

  const handleStoryPlanTitleChange = (value: string) => {
    setStoryPlan((prev) => (prev ? { ...prev, title: value, comicPages: resetStoryComicPages(prev.comicPages) } : prev));
  };

  const handleStoryPlanSynopsisChange = (value: string) => {
    setStoryPlan((prev) => (prev ? { ...prev, synopsis: value, comicPages: resetStoryComicPages(prev.comicPages) } : prev));
  };

  const handleStoryPlanVisualStyleChange = (value: string) => {
    setStoryPlan((prev) => (prev ? { ...prev, visualStyle: value, comicPages: resetStoryComicPages(prev.comicPages) } : prev));
  };

  const handleStoryRoleCharacterChange = (roleId: string, characterId: string | null) => {
    setStoryPlan((prev) => {
      if (!prev) {
        return prev;
      }

      const assignedCharacter = getCharacterById(characterMap, characterId);

      return {
        ...prev,
        comicPages: resetStoryComicPages(prev.comicPages),
        storyRoles: prev.storyRoles.map((role) =>
          role.id === roleId
            ? {
                ...role,
                assignedCharacterId: characterId,
                assignedCharacterName: assignedCharacter?.name ?? null,
                assignedCharacterImageBase64: assignedCharacter?.imageBase64 ?? null,
                assignedCharacterAppearance: null,
              }
            : role,
        ),
      };
    });
  };

  const handleSelectStoryScene = (sceneId: string) => {
    setSelectedStorySceneId(sceneId);
  };

  const handleStorySceneTitleChange = (sceneId: string, value: string) => {
    setStoryPlan((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        comicPages: resetStoryComicPages(prev.comicPages),
        scenes: prev.scenes.map((scene) => (scene.id === sceneId ? { ...scene, title: value || "Scene" } : scene)),
      };
    });
  };

  const handleStorySceneNarrationChange = (sceneId: string, value: string) => {
    setStoryPlan((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        comicPages: resetStoryComicPages(prev.comicPages),
        scenes: prev.scenes.map((scene) => (scene.id === sceneId ? { ...scene, narration: value } : scene)),
      };
    });
  };

  const handleStoryScenePromptChange = (sceneId: string, value: string) => {
    setStoryPlan((prev) => {
      if (!prev) {
        return prev;
      }

      return {
        ...prev,
        comicPages: resetStoryComicPages(prev.comicPages),
        scenes: prev.scenes.map((scene) => (scene.id === sceneId ? { ...scene, imagePrompt: value } : scene)),
      };
    });
  };

  const prepareStoryPlanForGeneration = async (plan: StoryPlanDraft): Promise<StoryPlanDraft> => {
    const rolesNeedingAppearance = plan.storyRoles.filter(
      (role) =>
        Boolean(role.assignedCharacterId) &&
        Boolean(role.assignedCharacterName) &&
        Boolean(role.assignedCharacterImageBase64) &&
        !role.assignedCharacterAppearance,
    );

    if (rolesNeedingAppearance.length === 0) {
      return plan;
    }

    const resolvedAppearances = await Promise.all(
      rolesNeedingAppearance.map(async (role) => ({
        roleId: role.id,
        appearance: await requestCharacterAppearance({
          characterName: role.assignedCharacterName ?? role.label,
          imageBase64: role.assignedCharacterImageBase64 ?? "",
        }),
      })),
    );

    const appearanceMap = new Map(resolvedAppearances.map((entry) => [entry.roleId, entry.appearance]));
    const preparedStoryRoles = plan.storyRoles.map((role) =>
      appearanceMap.has(role.id)
        ? {
            ...role,
            assignedCharacterAppearance: appearanceMap.get(role.id) ?? role.assignedCharacterAppearance,
          }
        : role,
    );

    setStoryPlan((prev) =>
      prev
        ? {
            ...prev,
            storyRoles: prev.storyRoles.map((role) =>
              appearanceMap.has(role.id)
                ? {
                    ...role,
                    assignedCharacterAppearance: appearanceMap.get(role.id) ?? role.assignedCharacterAppearance,
                  }
                : role,
            ),
          }
        : prev,
    );

    return {
      ...plan,
      storyRoles: preparedStoryRoles,
    };
  };

  const executeStoryPlanAnalysis = async () => {
    if (sourceItems.length === 0) {
      setError("Please upload at least one reference image before generating a story.");
      return;
    }

    setIsReplacing(true);
    setError(null);
    setBatchProgress({ completed: 0, total: 1 });
    setStoryPlanStatus("processing");

    try {
      const nextStoryPlan = await requestStoryPlan({
        sourceImages: sourceItems.map((item) => ({
          name: item.name,
          imageBase64: item.sourceImageBase64,
        })),
        ...(storyPrompt.trim() ? { storyDirection: storyPrompt.trim() } : {}),
      }, storyOutputMode);

      setStoryPlan(nextStoryPlan);
      setSelectedStorySceneId(nextStoryPlan.scenes[0]?.id ?? null);
      setSelectedStoryComicId(nextStoryPlan.comicPages[0]?.id ?? null);
      setStoryPlanStatus("ready");
      setBatchProgress({ completed: 1, total: 1 });
      setError(null);
    } catch (requestError) {
      setStoryPlanStatus("failed");
      setError(requestError instanceof Error ? requestError.message : "Story analysis failed.");
    } finally {
      setIsReplacing(false);
      setBatchProgress((prev) => (prev ? { ...prev, completed: prev.total } : null));
    }
  };

  const executeStoryBatchGenerate = async () => {
    if (!storyPlan || storyPlan.scenes.length === 0) {
      setError("Analyze the uploaded original images first so the app can extract the existing story scenes.");
      return;
    }

    if (storyPlan.storyRoles.length > 0 && storyPlan.storyRoles.some((role) => !role.assignedCharacterId)) {
      setError("Assign one of your characters to every detected story role before rendering scenes.");
      return;
    }

    setIsReplacing(true);
    setError(null);

    let failedCount = 0;
    let completedCount = 0;
    let firstFailedSceneId: string | null = null;

    try {
      const preparedStoryPlan = await prepareStoryPlanForGeneration(storyPlan);

      setBatchProgress({ completed: 0, total: preparedStoryPlan.scenes.length });
      setStoryPlanStatus("ready");
      setStoryPlan((prev) =>
        prev
          ? {
              ...prev,
              storyRoles: preparedStoryPlan.storyRoles,
              comicPages: resetStoryComicPages(prev.comicPages),
              scenes: prev.scenes.map((scene) => ({
                ...scene,
                status: "pending",
                error: null,
                candidates: [],
                selectedCandidateIndex: 0,
                resultImageBase64: null,
              })),
            }
          : prev,
      );

      for (const scene of preparedStoryPlan.scenes) {
        setSelectedStorySceneId(scene.id);
        setStoryPlan((prev) =>
          prev
            ? {
                ...prev,
                scenes: prev.scenes.map((currentScene) =>
                  currentScene.id === scene.id ? { ...currentScene, status: "processing", error: null } : currentScene,
                ),
              }
            : prev,
        );

        try {
          let candidates: WorkbenchCandidate[] | null = null;
          let lastError: unknown = null;

          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              candidates = await requestStorySceneCandidates({
                storyTitle: preparedStoryPlan.title,
                synopsis: preparedStoryPlan.synopsis,
                visualStyle: preparedStoryPlan.visualStyle,
                sceneTitle: scene.title,
                sceneNarration: scene.narration,
                scenePrompt: scene.imagePrompt,
                storyRoles: preparedStoryPlan.storyRoles,
                ...(storyPrompt.trim() ? { storyDirection: storyPrompt.trim() } : {}),
              });
              break;
            } catch (attemptError) {
              lastError = attemptError;
              if (!(attemptError instanceof ReplaceRequestTimeoutError)) {
                break;
              }
            }
          }

          if (!candidates) {
            throw lastError ?? new Error("Story scene generation failed.");
          }

          setStoryPlan((prev) =>
            prev
              ? {
                  ...prev,
                  scenes: prev.scenes.map((currentScene) =>
                    currentScene.id === scene.id
                      ? {
                          ...currentScene,
                          status: "done",
                          error: null,
                          candidates,
                          selectedCandidateIndex: 0,
                          resultImageBase64: candidates[0]?.imageBase64 ?? null,
                        }
                      : currentScene,
                  ),
                }
              : prev,
          );
        } catch (requestError) {
          failedCount += 1;
          if (!firstFailedSceneId) {
            firstFailedSceneId = scene.id;
          }
          const message =
            requestError instanceof Error ? requestError.message : "Unexpected error while generating this story scene.";

          setStoryPlan((prev) =>
            prev
              ? {
                  ...prev,
                  scenes: prev.scenes.map((currentScene) =>
                    currentScene.id === scene.id
                      ? {
                          ...currentScene,
                          status: "failed",
                          error: message,
                          candidates: [],
                          selectedCandidateIndex: 0,
                          resultImageBase64: null,
                        }
                      : currentScene,
                  ),
                }
              : prev,
          );
        }

        completedCount += 1;
        setBatchProgress({ completed: completedCount, total: preparedStoryPlan.scenes.length });
      }
    } finally {
      if (firstFailedSceneId) {
        setSelectedStorySceneId(firstFailedSceneId);
      }
      setIsReplacing(false);
      setBatchProgress((prev) => (prev ? { ...prev, completed: prev.total } : null));
    }

    if (failedCount > 0) {
      setError(`${failedCount}/${storyPlan.scenes.length} story scene(s) failed. Select a scene to view details.`);
    } else {
      setError(null);
    }
  };

  const executeStoryComicGenerate = async () => {
    if (!storyPlan || storyPlan.scenes.length === 0) {
      setError("Analyze the uploaded original images first so the app can extract the existing story scenes.");
      return;
    }

    const pageCapacity = getComicPanelCount(storyOutputMode);

    if (storyPlan.storyRoles.length > 0 && storyPlan.storyRoles.some((role) => !role.assignedCharacterId)) {
      setError("Assign one of your characters to every detected story role before rendering the comic pages.");
      return;
    }

    setIsReplacing(true);
    setError(null);

    let failedCount = 0;
    let completedCount = 0;

    try {
      const preparedStoryPlan = await prepareStoryPlanForGeneration(storyPlan);
      const nextComicPages = buildStoryComicPages(preparedStoryPlan.scenes, storyOutputMode);

      if (nextComicPages.length === 0) {
        throw new Error("Story analysis returned no scenes that could be paginated into comic pages.");
      }

      setBatchProgress({ completed: 0, total: nextComicPages.length });
      setStoryPlanStatus("ready");
      setSelectedStoryComicId(nextComicPages[0]?.id ?? null);
      setStoryPlan((prev) =>
        prev
          ? {
              ...prev,
              storyRoles: preparedStoryPlan.storyRoles,
              comicPages: nextComicPages,
            }
          : prev,
      );

      for (const comicPage of nextComicPages) {
        const panelScenes = preparedStoryPlan.scenes.slice(comicPage.sceneStartIndex, comicPage.sceneEndIndex + 1);

        try {
          setSelectedStoryComicId(comicPage.id);
          setStoryPlan((prev) =>
            prev
              ? {
                  ...prev,
                  comicPages: prev.comicPages.map((currentComicPage) =>
                    currentComicPage.id === comicPage.id
                      ? {
                          ...currentComicPage,
                          status: "processing",
                          error: null,
                        }
                      : currentComicPage,
                  ),
                }
              : prev,
          );

          let candidates: WorkbenchCandidate[] | null = null;
          let lastError: unknown = null;

          for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
              candidates = await requestStoryComicCandidates({
                storyTitle: preparedStoryPlan.title,
                synopsis: preparedStoryPlan.synopsis,
                visualStyle: preparedStoryPlan.visualStyle,
                storyRoles: preparedStoryPlan.storyRoles,
                scenes: panelScenes.map((scene) => ({
                  title: scene.title,
                  narration: scene.narration,
                  imagePrompt: scene.imagePrompt,
                })),
                panelCount: comicPage.panelCount,
                pageCapacity,
                ...(storyPrompt.trim() ? { storyDirection: storyPrompt.trim() } : {}),
              });
              break;
            } catch (attemptError) {
              lastError = attemptError;
              if (!(attemptError instanceof ReplaceRequestTimeoutError)) {
                break;
              }
            }
          }

          if (!candidates) {
            throw lastError ?? new Error(`${comicPage.panelCount}-panel comic generation failed.`);
          }

          setStoryPlan((prev) =>
            prev
              ? {
                  ...prev,
                  comicPages: prev.comicPages.map((currentComicPage) =>
                    currentComicPage.id === comicPage.id
                      ? {
                          ...currentComicPage,
                          status: "done",
                          error: null,
                          candidates,
                          selectedCandidateIndex: 0,
                          resultImageBase64: candidates[0]?.imageBase64 ?? null,
                        }
                      : currentComicPage,
                  ),
                }
              : prev,
          );
        } catch (requestError) {
          failedCount += 1;
          const message =
            requestError instanceof Error
              ? requestError.message
              : `Unexpected error while generating comic page ${comicPage.pageIndex}.`;

          setStoryPlan((prev) =>
            prev
              ? {
                  ...prev,
                  comicPages: prev.comicPages.map((currentComicPage) =>
                    currentComicPage.id === comicPage.id
                      ? {
                          ...currentComicPage,
                          status: "failed",
                          error: message,
                          candidates: [],
                          selectedCandidateIndex: 0,
                          resultImageBase64: null,
                        }
                      : currentComicPage,
                  ),
                }
              : prev,
          );
        }

        completedCount += 1;
        setBatchProgress({ completed: completedCount, total: nextComicPages.length });
      }
      setError(failedCount > 0 ? `${failedCount}/${nextComicPages.length} comic page(s) failed. Select a page to view details.` : null);
    } catch (requestError) {
      const message =
        requestError instanceof Error ? requestError.message : "Unexpected error while generating the comic pages.";

      setStoryPlan((prev) =>
        prev
          ? {
              ...prev,
              comicPages: prev.comicPages.map((comicPage) => ({
                ...comicPage,
                status: "failed",
                error: message,
                candidates: [],
                selectedCandidateIndex: 0,
                resultImageBase64: null,
              })),
            }
          : prev,
      );
      setError(message);
    } finally {
      setIsReplacing(false);
      setBatchProgress((prev) => (prev ? { ...prev, completed: prev.total } : null));
    }
  };

  const handleSelectStoryComic = (comicPageId: string) => {
    setSelectedStoryComicId(comicPageId);
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
                  null,
                );
                break;
              } catch (attemptError) {
                lastError = attemptError;
                if (!(attemptError instanceof ReplaceRequestTimeoutError)) {
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
    if (sourceItems.length === 0) {
      setError("Please upload at least one source image.");
      return;
    }

    const queue = sourceItems
      .map((item) => {
        const requestMappings = buildSceneMappingRequestMappings(item, characterMap);
        if (!requestMappings) {
          return null;
        }

        return {
          id: item.id,
          sourceImageBase64: item.sourceImageBase64,
          extraPrompt: item.extraPrompt,
          requestMappings,
        };
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    if (queue.length === 0) {
      const hasAnyMappings = sourceItems.some((item) => item.sceneMappings.length > 0);
      setError(
        hasAnyMappings
          ? "Please complete the subject mappings for at least one image before running."
          : "Please add at least one subject mapping for at least one image.",
      );
      return;
    }

    const readyIds = new Set(queue.map((item) => item.id));
    const skippedCount = sourceItems.length - queue.length;

    setIsReplacing(true);
    setError(null);
    setBatchProgress({ completed: 0, total: queue.length });
    setSourceItems((prev) =>
      prev.map((item) =>
        readyIds.has(item.id)
          ? {
              ...item,
              sceneResult: createSceneResult(),
            }
          : item,
      ),
    );

    let failedCount = 0;
    let completedCount = 0;

    try {
      for (const current of queue) {
        setSelectedSourceId(current.id);
        setSourceItems((prev) =>
          prev.map((item) =>
            item.id === current.id
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
                  sourceImageBase64: current.sourceImageBase64,
                  subjectMappings: current.requestMappings,
                  candidateCount: 1,
                  enableRefinement: false,
                  ...(current.extraPrompt.trim() ? { extraPrompt: current.extraPrompt.trim() } : {}),
                },
                current.requestMappings.map((mapping) => mapping.roi),
              );
              break;
            } catch (attemptError) {
              lastError = attemptError;
              if (!(attemptError instanceof ReplaceRequestTimeoutError)) {
                break;
              }
            }
          }

          if (!candidates) {
            throw lastError ?? new Error("Mapped replace request failed.");
          }

          setSourceItems((prev) =>
            prev.map((item) =>
              item.id === current.id
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
        } catch (requestError) {
          failedCount += 1;
          const message =
            requestError instanceof Error ? requestError.message : "Unexpected error while replacing mapped subjects.";

          setSourceItems((prev) =>
            prev.map((item) =>
              item.id === current.id
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
        }

        completedCount += 1;
        setBatchProgress({ completed: completedCount, total: queue.length });
      }
      if (failedCount === 0 && skippedCount === 0) {
        setError(null);
      } else {
        const parts = [];
        if (failedCount > 0) {
          parts.push(`${failedCount}/${queue.length} mapped replacement(s) failed.`);
        }
        if (skippedCount > 0) {
          parts.push(`${skippedCount} image(s) were skipped because they did not have complete subject mappings.`);
        }
        parts.push("Select an image to view details.");
        setError(parts.join(" "));
      }
    } finally {
      setIsReplacing(false);
      setBatchProgress((prev) => (prev ? { ...prev, completed: prev.total } : null));
    }
  };

  const handleExecuteReplace = async () => {
    if (replaceMode === "story-batch") {
      if (storyPlan && storyPlan.scenes.length > 0) {
        if (storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9") {
          await executeStoryComicGenerate();
        } else {
          await executeStoryBatchGenerate();
        }
      } else {
        await executeStoryPlanAnalysis();
      }
      return;
    }

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
            selectionDisabledMessage={
              replaceMode === "story-batch"
                ? "Story Batch is in role-assignment mode. Add or manage characters here, then assign them to the detected story roles inside the workbench after analysis."
                : undefined
            }
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
            mappedBatchReadyCount={mappedBatchReadyCount}
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
            storyBatch={{
              prompt: storyPrompt,
              plan: storyPlan,
              status: storyPlanStatus,
              outputMode: storyOutputMode,
              selectedSceneId: selectedStorySceneId,
              selectedComicPageId: selectedStoryComicId,
              storyRoleReadyCount,
              onPromptChange: setStoryPrompt,
              onAnalyze: executeStoryPlanAnalysis,
              onGenerate:
                storyOutputMode === "comic-grid-4" || storyOutputMode === "comic-grid-9"
                  ? executeStoryComicGenerate
                  : executeStoryBatchGenerate,
              onOutputModeChange: handleStoryOutputModeChange,
              onSelectScene: handleSelectStoryScene,
              onSelectComicPage: handleSelectStoryComic,
              onPlanTitleChange: handleStoryPlanTitleChange,
              onPlanSynopsisChange: handleStoryPlanSynopsisChange,
              onPlanVisualStyleChange: handleStoryPlanVisualStyleChange,
              onStoryRoleCharacterChange: handleStoryRoleCharacterChange,
              onSceneTitleChange: handleStorySceneTitleChange,
              onSceneNarrationChange: handleStorySceneNarrationChange,
              onScenePromptChange: handleStoryScenePromptChange,
            }}
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
                      storyPlan,
                      storyOutputMode,
                    );
                  } catch (downloadError) {
                    setError(downloadError instanceof Error ? downloadError.message : "Failed to create ZIP file.");
                  }
                }}
                disabled={!canDownloadZip}
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
