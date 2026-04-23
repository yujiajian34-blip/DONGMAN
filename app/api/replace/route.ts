import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

type RoiRect = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type SubjectMappingRequest = {
  label?: string;
  targetCharacterBase64?: string;
  targetCharacterName?: string;
  notes?: string;
  roi?: RoiRect | null;
};

type ReplaceRequestBody = {
  sourceImageBase64?: string;
  targetCharacterBase64?: string;
  subjectMappings?: SubjectMappingRequest[];
  candidateCount?: number;
  enableRefinement?: boolean;
  extraPrompt?: string;
};

type NormalizedImage = {
  mimeType: string;
  data: string;
};

type NormalizedSubjectMapping = {
  label: string;
  targetCharacterName: string | null;
  notes: string | null;
  roi: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  referenceImage: NormalizedImage;
};

type GatewayPayloadVariant = {
  name: string;
  payload: Record<string, unknown>;
};

type GatewayAttemptResult = {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
  json: unknown;
};

type AttemptSummary = {
  name: string;
  status: number;
  ok: boolean;
  hasImage: boolean;
};

type GeneratedCandidate = {
  imageBase64: string;
  selectedVariant: string;
  attempts: AttemptSummary[];
  stage: "initial" | "refined";
};

type GenerateCandidateResult = {
  candidate: GeneratedCandidate | null;
  attempts: AttemptSummary[];
  upstreamErrors: Array<{ variant: string; status: number; statusText: string; snippet: string }>;
};

class RequestValidationError extends Error {}

const GATEWAY_URL =
  "http://aigw.primeinnos.com/marketing_center_gemini/v1/projects/gemini-flat260304-2/locations/global/publishers/google/models/gemini-3.1-flash-image-preview:generateContent";
const GATEWAY_TOKEN = process.env.GEMINI_GATEWAY_TOKEN ?? "tk-P0L4myF72gCLmGdpa9jJpqoRvgKWDy68";
const DEBUG_ENABLED = process.env.REPLACE_DEBUG === "1";
const GATEWAY_TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS ?? 70000);
const MAX_SUBJECT_MAPPINGS = 4;

const SINGLE_SUBJECT_PROMPT_BASE = `
You are an expert manga illustrator.
Task: edit Image 1 (Context) by replacing ONLY the main character with the character identity from Image 2 (Reference).

STRICT CONSTRAINTS:
1) Only replace the main subject in Image 1.
2) Keep background, composition, camera angle, perspective, framing, panel layout, and object positions unchanged.
3) Keep the exact same manga style: line weight, line quality, screentone/shading, contrast, and rendering style.
4) Preserve all speech bubbles and text boxes in the exact same positions and sizes as in Image 1.
5) All visible text must be rewritten in natural English only. If source text is not English, translate it to concise natural English.
6) Do not redesign the scene. If uncertain, copy Image 1 exactly and change only the main character.
`;

const MULTI_SUBJECT_PROMPT_BASE = `
You are an expert manga illustrator.
Task: edit Image 1 (Context) by replacing MULTIPLE distinct characters according to the numbered subject mappings below.

STRICT CONSTRAINTS:
1) Only edit the characters inside the listed ROIs in Image 1.
2) Use each numbered reference image only for its matching subject mapping.
3) Keep every other character, background element, camera angle, perspective, framing, panel layout, and object position unchanged.
4) Keep the exact same manga style: line weight, line quality, screentone/shading, contrast, and rendering style.
5) Preserve all speech bubbles and text boxes in the exact same positions and sizes as in Image 1.
6) Keep each replacement character in the same pose, scale, direction, and placement as the original person inside that ROI.
7) If uncertain, make the smallest possible local edit inside the listed ROI and leave everything else untouched.
`;

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function formatPercent(value: number): string {
  return `${(clamp01(value) * 100).toFixed(1)}%`;
}

function sanitizeExtraPrompt(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 600);
}

function sanitizeShortText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

function sanitizeLabel(value: unknown, fallback: string): string {
  return sanitizeShortText(value, 40) ?? fallback;
}

function buildSingleReplacePrompt(roundIndex: number, extraPrompt: string | null): string {
  const extraBlock = extraPrompt
    ? `
USER SUPPLEMENTAL CHARACTER DIRECTIVES (must NOT violate STRICT CONSTRAINTS):
${extraPrompt}
`
    : "";

  return `${SINGLE_SUBJECT_PROMPT_BASE}
${extraBlock}
Valid candidate index: ${roundIndex}.`;
}

function buildSceneMappingPrompt(
  roundIndex: number,
  subjectMappings: NormalizedSubjectMapping[],
  extraPrompt: string | null,
): string {
  const mappingBlock = subjectMappings
    .map((mapping, index) => {
      const referenceNumber = index + 2;
      const notesBlock = mapping.notes ? ` Notes: ${mapping.notes}` : "";
      const nameBlock = mapping.targetCharacterName ? ` (${mapping.targetCharacterName})` : "";

      return `${index + 1}. Subject label: ${mapping.label}. Replace the person inside ROI x=${formatPercent(mapping.roi.x)}, y=${formatPercent(mapping.roi.y)}, width=${formatPercent(mapping.roi.width)}, height=${formatPercent(mapping.roi.height)} in Image 1 using Image ${referenceNumber}${nameBlock}.${notesBlock}`;
    })
    .join("\n");

  const extraBlock = extraPrompt
    ? `
USER SUPPLEMENTAL DIRECTIVES (must NOT violate STRICT CONSTRAINTS):
${extraPrompt}
`
    : "";

  return `${MULTI_SUBJECT_PROMPT_BASE}

ROI coordinates are normalized to Image 1, where x/y are the top-left corner and width/height are the box size.

SUBJECT MAPPINGS:
${mappingBlock}
${extraBlock}
Valid candidate index: ${roundIndex}.`;
}

function normalizeImageBase64(rawBase64: string): NormalizedImage {
  const value = rawBase64.trim();
  const compact = value.replace(/\s/g, "");

  if (!compact) {
    throw new RequestValidationError("Image payload is empty.");
  }

  if (compact.startsWith("data:")) {
    const commaIndex = compact.indexOf(",");
    if (commaIndex > 5 && commaIndex < compact.length - 1) {
      const header = compact.slice(5, commaIndex);
      const data = compact.slice(commaIndex + 1);
      const headerLower = header.toLowerCase();
      const semicolonIndex = header.indexOf(";");
      const mimeType = semicolonIndex === -1 ? header : header.slice(0, semicolonIndex);
      const isImageMime = mimeType.startsWith("image/");
      const isBase64DataUrl = headerLower.includes(";base64");

      if (mimeType.toLowerCase() === "image/svg+xml") {
        throw new RequestValidationError("SVG images are not supported by the gateway. Please upload PNG, JPG, or WEBP images.");
      }

      if (isImageMime && isBase64DataUrl) {
        return {
          mimeType,
          data,
        };
      }

      return {
        mimeType: "image/png",
        data,
      };
    }

    throw new RequestValidationError("Malformed data URL image payload.");
  }

  return {
    mimeType: "image/png",
    data: compact,
  };
}

function normalizeRoiRect(rawRoi: unknown, index: number): NormalizedSubjectMapping["roi"] {
  if (!rawRoi || typeof rawRoi !== "object") {
    throw new RequestValidationError(`Subject mapping ${index + 1} is missing an ROI.`);
  }

  const roi = rawRoi as RoiRect;
  const x = Number(roi.x);
  const y = Number(roi.y);
  const width = Number(roi.width);
  const height = Number(roi.height);

  if (![x, y, width, height].every((value) => Number.isFinite(value))) {
    throw new RequestValidationError(`Subject mapping ${index + 1} has an invalid ROI.`);
  }

  const normalized = {
    x: clamp01(x),
    y: clamp01(y),
    width: clamp01(width),
    height: clamp01(height),
  };

  if (normalized.width <= 0 || normalized.height <= 0) {
    throw new RequestValidationError(`Subject mapping ${index + 1} has an empty ROI.`);
  }

  return normalized;
}

function normalizeSubjectMappings(rawMappings: unknown): NormalizedSubjectMapping[] {
  if (!Array.isArray(rawMappings)) {
    return [];
  }

  if (rawMappings.length === 0) {
    return [];
  }

  if (rawMappings.length > MAX_SUBJECT_MAPPINGS) {
    throw new RequestValidationError(`Up to ${MAX_SUBJECT_MAPPINGS} subject mappings are supported per request.`);
  }

  return rawMappings.map((rawMapping, index) => {
    if (!rawMapping || typeof rawMapping !== "object") {
      throw new RequestValidationError(`Subject mapping ${index + 1} is invalid.`);
    }

    const mapping = rawMapping as SubjectMappingRequest;
    if (typeof mapping.targetCharacterBase64 !== "string" || !mapping.targetCharacterBase64.trim()) {
      throw new RequestValidationError(`Subject mapping ${index + 1} is missing a target character reference image.`);
    }

    return {
      label: sanitizeLabel(mapping.label, `Subject ${index + 1}`),
      targetCharacterName: sanitizeShortText(mapping.targetCharacterName, 80),
      notes: sanitizeShortText(mapping.notes, 240),
      roi: normalizeRoiRect(mapping.roi, index),
      referenceImage: normalizeImageBase64(mapping.targetCharacterBase64),
    };
  });
}

function hashBase64(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function createPayloadVariants(prompt: string, images: NormalizedImage[]): GatewayPayloadVariant[] {
  if (images.length < 2) {
    return [];
  }

  const promptPartsCamel = [
    { text: prompt },
    ...images.map((image) => ({
      inlineData: {
        mimeType: image.mimeType,
        data: image.data,
      },
    })),
  ];

  const promptPartsSnake = [
    { text: prompt },
    ...images.map((image) => ({
      inline_data: {
        mime_type: image.mimeType,
        data: image.data,
      },
    })),
  ];

  return [
    {
      name: "generateContent_camelCase",
      payload: {
        contents: [
          {
            role: "user",
            parts: promptPartsCamel,
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseModalities: ["IMAGE"],
        },
      },
    },
    {
      name: "generateContent_snake_case",
      payload: {
        contents: [
          {
            role: "user",
            parts: promptPartsSnake,
          },
        ],
        generation_config: {
          temperature: 0.2,
          response_modalities: ["IMAGE"],
        },
      },
    },
  ];
}

async function callGatewayWithHardTimeout(payload: Record<string, unknown>): Promise<GatewayAttemptResult> {
  const timeoutResult: GatewayAttemptResult = {
    ok: false,
    status: 408,
    statusText: "Gateway hard timeout",
    text: "",
    json: null,
  };

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<GatewayAttemptResult>((resolve) => {
    timeoutId = setTimeout(() => resolve(timeoutResult), GATEWAY_TIMEOUT_MS + 500);
  });

  const result = await Promise.race([callGateway(payload), timeoutPromise]);
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
  return result;
}

async function callGateway(payload: Record<string, unknown>): Promise<GatewayAttemptResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);

  try {
    const upstreamResponse = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${GATEWAY_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const upstreamText = await upstreamResponse.text();
    let upstreamJson: unknown = null;

    try {
      upstreamJson = upstreamText ? (JSON.parse(upstreamText) as unknown) : null;
    } catch {
      upstreamJson = null;
    }

    return {
      ok: upstreamResponse.ok,
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      text: upstreamText,
      json: upstreamJson,
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        status: 408,
        statusText: "Gateway timeout",
        text: "",
        json: null,
      };
    }

    return {
      ok: false,
      status: 500,
      statusText: "Gateway request exception",
      text: error instanceof Error ? error.message : "Unknown gateway error",
      json: null,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function looksLikeBase64(value: string): boolean {
  if (value.length < 200) {
    return false;
  }

  return /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function extractBase64FromText(text: string): string | null {
  if (!text) {
    return null;
  }

  const dataUrlMatch = text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]{200,}/);
  if (dataUrlMatch) {
    return dataUrlMatch[0];
  }

  const keyPatterns = [
    /"b64_json"\s*:\s*"([A-Za-z0-9+/=]{200,})"/,
    /"imageBase64"\s*:\s*"([A-Za-z0-9+/=]{200,})"/,
    /"base64"\s*:\s*"([A-Za-z0-9+/=]{200,})"/,
    /"data"\s*:\s*"([A-Za-z0-9+/=]{200,})"/,
  ];

  for (const pattern of keyPatterns) {
    const match = text.match(pattern);
    if (match?.[1] && looksLikeBase64(match[1])) {
      return match[1];
    }
  }

  return null;
}

function extractBase64Image(payload: unknown): string | null {
  if (!payload) {
    return null;
  }

  const queue: unknown[] = [payload];
  const visited = new Set<object>();
  const priorityKeys = [
    "b64_json",
    "imageBase64",
    "base64",
    "image",
    "inlineData",
    "inline_data",
    "data",
  ];
  const MAX_VISITED_NODES = 20000;

  let visitedNodes = 0;

  while (queue.length > 0) {
    if (visitedNodes > MAX_VISITED_NODES) {
      return null;
    }

    const current = queue.shift();
    if (current == null) {
      continue;
    }

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (trimmed.startsWith("data:image/")) {
        return trimmed;
      }

      const cleaned = trimmed.replace(/\s/g, "");
      if (looksLikeBase64(cleaned)) {
        return cleaned;
      }
      continue;
    }

    if (typeof current !== "object") {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);
    visitedNodes += 1;

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    const record = current as Record<string, unknown>;

    for (const key of priorityKeys) {
      if (key in record) {
        queue.unshift(record[key]);
      }
    }

    for (const value of Object.values(record)) {
      queue.push(value);
    }
  }

  return null;
}

async function generateOneCandidate(
  prompt: string,
  images: NormalizedImage[],
  stage: "initial" | "refined",
): Promise<GenerateCandidateResult> {
  const payloadVariants = createPayloadVariants(prompt, images);
  const attempts: AttemptSummary[] = [];
  const upstreamErrors: Array<{ variant: string; status: number; statusText: string; snippet: string }> = [];

  for (const variant of payloadVariants) {
    try {
      const attempt = await callGatewayWithHardTimeout(variant.payload);
      let imageBase64: string | null = null;

      if (attempt.ok) {
        imageBase64 = extractBase64FromText(attempt.text);

        if (!imageBase64) {
          try {
            imageBase64 = extractBase64Image(attempt.json);
          } catch (extractError) {
            upstreamErrors.push({
              variant: `${variant.name}:extract`,
              status: 500,
              statusText: "Image extraction failed",
              snippet: extractError instanceof Error ? extractError.message.slice(0, 280) : "Unknown extraction error",
            });
          }
        }
      }

      const hasImage = Boolean(imageBase64);

      attempts.push({
        name: variant.name,
        status: attempt.status,
        ok: attempt.ok,
        hasImage,
      });

      if (!attempt.ok) {
        upstreamErrors.push({
          variant: variant.name,
          status: attempt.status,
          statusText: attempt.statusText,
          snippet: attempt.text.slice(0, 280),
        });
      }

      if (!hasImage) {
        continue;
      }

      const normalizedResult = imageBase64!.startsWith("data:image/")
        ? imageBase64!
        : `data:image/png;base64,${imageBase64}`;

      return {
        candidate: {
          imageBase64: normalizedResult,
          selectedVariant: variant.name,
          attempts,
          stage,
        },
        attempts,
        upstreamErrors,
      };
    } catch (variantError) {
      attempts.push({
        name: variant.name,
        status: 500,
        ok: false,
        hasImage: false,
      });
      upstreamErrors.push({
        variant: `${variant.name}:unexpected`,
        status: 500,
        statusText: "Unexpected candidate generation error",
        snippet: variantError instanceof Error ? variantError.message.slice(0, 280) : "Unknown error",
      });
    }
  }

  return {
    candidate: null,
    attempts,
    upstreamErrors,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ReplaceRequestBody;
    const { sourceImageBase64 } = body;

    if (!sourceImageBase64) {
      return NextResponse.json(
        {
          error: "sourceImageBase64 is required.",
        },
        { status: 400 },
      );
    }

    const sourceImage = normalizeImageBase64(sourceImageBase64);
    const extraPrompt = sanitizeExtraPrompt(body.extraPrompt);
    const requestedCandidateCount = 1;
    const enableRefinement = false;
    const subjectMappings = normalizeSubjectMappings(body.subjectMappings);
    const isSceneMappingMode = subjectMappings.length > 0;

    if (!isSceneMappingMode && !body.targetCharacterBase64) {
      return NextResponse.json(
        {
          error: "targetCharacterBase64 is required when subjectMappings are not provided.",
        },
        { status: 400 },
      );
    }

    const targetImage = !isSceneMappingMode ? normalizeImageBase64(body.targetCharacterBase64 as string) : null;

    const inputDebug = isSceneMappingMode
      ? {
          source: {
            mimeType: sourceImage.mimeType,
            length: sourceImage.data.length,
            hash16: hashBase64(sourceImage.data),
          },
          subjectMappings: subjectMappings.map((mapping, index) => ({
            index: index + 1,
            label: mapping.label,
            targetCharacterName: mapping.targetCharacterName,
            roi: mapping.roi,
            reference: {
              mimeType: mapping.referenceImage.mimeType,
              length: mapping.referenceImage.data.length,
              hash16: hashBase64(mapping.referenceImage.data),
            },
          })),
          extraPromptLength: extraPrompt?.length ?? 0,
        }
      : {
          source: {
            mimeType: sourceImage.mimeType,
            length: sourceImage.data.length,
            hash16: hashBase64(sourceImage.data),
          },
          target: {
            mimeType: (targetImage as NormalizedImage).mimeType,
            length: (targetImage as NormalizedImage).data.length,
            hash16: hashBase64((targetImage as NormalizedImage).data),
          },
          extraPromptLength: extraPrompt?.length ?? 0,
        };

    const candidates: GeneratedCandidate[] = [];
    const failedRounds: Array<{
      round: number;
      message: string;
      attempts: AttemptSummary[];
      upstreamErrors: Array<{ variant: string; status: number; statusText: string; snippet: string }>;
    }> = [];

    for (let i = 0; i < requestedCandidateCount; i += 1) {
      const prompt = isSceneMappingMode
        ? buildSceneMappingPrompt(i + 1, subjectMappings, extraPrompt)
        : buildSingleReplacePrompt(i + 1, extraPrompt);
      const promptImages = isSceneMappingMode
        ? [sourceImage, ...subjectMappings.map((mapping) => mapping.referenceImage)]
        : [sourceImage, targetImage as NormalizedImage];

      const initialResult = await generateOneCandidate(prompt, promptImages, "initial");
      const initial = initialResult.candidate;

      if (initial) {
        candidates.push(initial);

        if (enableRefinement && !isSceneMappingMode) {
          const draftAsImage = normalizeImageBase64(initial.imageBase64);
          const refinePrompt = `
${SINGLE_SUBJECT_PROMPT_BASE}
Additional instruction:
- Image 3 is a draft output.
- Correct Image 3 so that all background, composition, and text placement match Image 1 as closely as possible.
- Keep only the character replacement intent from Image 2.
`;
          const refinedResult = await generateOneCandidate(
            refinePrompt,
            [sourceImage, targetImage as NormalizedImage, draftAsImage],
            "refined",
          );
          const refined = refinedResult.candidate;
          if (refined) {
            candidates.push(refined);
          } else {
            failedRounds.push({
              round: i + 1,
              message: "Refinement failed to return a valid image.",
              attempts: refinedResult.attempts,
              upstreamErrors: refinedResult.upstreamErrors,
            });
          }
        }
      } else {
        failedRounds.push({
          round: i + 1,
          message: "No valid image returned for this round.",
          attempts: initialResult.attempts,
          upstreamErrors: initialResult.upstreamErrors,
        });
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json(
        {
          error: "Gemini gateway request failed.",
          details: {
            message: "All candidate rounds failed or returned no image.",
            failedRounds,
            input: DEBUG_ENABLED ? inputDebug : undefined,
          },
        },
        { status: 502 },
      );
    }

    const payload = {
      imageBase64: candidates[0].imageBase64,
      candidates: candidates.map((candidate, index) => ({
        index,
        imageBase64: candidate.imageBase64,
        meta: {
          stage: candidate.stage,
          selectedVariant: candidate.selectedVariant,
          attempts: candidate.attempts,
        },
      })),
      meta: {
        mode: isSceneMappingMode ? "scene-mapping" : "single-target",
        requestedCandidateCount,
        enableRefinement,
        generatedCandidateCount: candidates.length,
        failedRounds,
      },
      ...(DEBUG_ENABLED ? { debug: { input: inputDebug } } : {}),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 400 },
      );
    }

    console.error("[/api/replace] Internal error:", error);
    return NextResponse.json(
      {
        error: "Internal server error.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
