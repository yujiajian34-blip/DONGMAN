import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

type ReplaceRequestBody = {
  sourceImageBase64?: string;
  targetCharacterBase64?: string;
  candidateCount?: number;
  enableRefinement?: boolean;
};

type NormalizedImage = {
  mimeType: string;
  data: string;
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

const GATEWAY_URL =
  "http://aigw.primeinnos.com/marketing_center_gemini/v1/projects/gemini-flat260304-2/locations/global/publishers/google/models/gemini-3.1-flash-image-preview:generateContent";
const GATEWAY_TOKEN = process.env.GEMINI_GATEWAY_TOKEN ?? "tk-P0L4myF72gCLmGdpa9jJpqoRvgKWDy68";
const DEBUG_ENABLED = process.env.REPLACE_DEBUG === "1";
const GATEWAY_TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS ?? 70000);

const SYSTEM_PROMPT_BASE = `
You are an expert manga illustrator.
Task: edit Image 1 (Context) by replacing ONLY the main character with the character identity from Image 2 (Reference).

STRICT CONSTRAINTS:
1) Only replace the main subject in Image 1.
2) Keep background, composition, camera angle, perspective, framing, panel layout, and object positions unchanged.
3) Keep the exact same manga style: line weight, line quality, screentone/shading, contrast, and rendering style.
4) Preserve all speech bubbles, text boxes, existing text content, and their positions exactly as in Image 1.
5) Do not add new text, do not remove text, do not translate text.
6) Do not redesign the scene. If uncertain, copy Image 1 exactly and change only the main character.
`;

function normalizeImageBase64(rawBase64: string): NormalizedImage {
  const value = rawBase64.trim();
  const dataUrlMatch = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);

  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1],
      data: dataUrlMatch[2].replace(/\s/g, ""),
    };
  }

  return {
    mimeType: "image/png",
    data: value.replace(/\s/g, ""),
  };
}

function hashBase64(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function createPayloadVariants(prompt: string, images: NormalizedImage[]): GatewayPayloadVariant[] {
  const [sourceImage, targetImage, draftImage] = images;

  if (!sourceImage || !targetImage) {
    return [];
  }

  const promptPartsCamel = [
    { text: prompt },
    {
      inlineData: {
        mimeType: sourceImage.mimeType,
        data: sourceImage.data,
      },
    },
    {
      inlineData: {
        mimeType: targetImage.mimeType,
        data: targetImage.data,
      },
    },
  ];

  const promptPartsSnake = [
    { text: prompt },
    {
      inline_data: {
        mime_type: sourceImage.mimeType,
        data: sourceImage.data,
      },
    },
    {
      inline_data: {
        mime_type: targetImage.mimeType,
        data: targetImage.data,
      },
    },
  ];

  if (draftImage) {
    promptPartsCamel.push({
      inlineData: {
        mimeType: draftImage.mimeType,
        data: draftImage.data,
      },
    });
    promptPartsSnake.push({
      inline_data: {
        mime_type: draftImage.mimeType,
        data: draftImage.data,
      },
    });
  }

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

function extractBase64Image(payload: unknown): string | null {
  if (!payload) {
    return null;
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("data:image/")) {
      return trimmed;
    }

    const cleaned = trimmed.replace(/\s/g, "");
    return looksLikeBase64(cleaned) ? cleaned : null;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      const found = extractBase64Image(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const priorityKeys = [
      "b64_json",
      "imageBase64",
      "base64",
      "image",
      "inlineData",
      "inline_data",
      "data",
    ];

    for (const key of priorityKeys) {
      if (key in record) {
        const found = extractBase64Image(record[key]);
        if (found) {
          return found;
        }
      }
    }

    for (const value of Object.values(record)) {
      const found = extractBase64Image(value);
      if (found) {
        return found;
      }
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
    const attempt = await callGatewayWithHardTimeout(variant.payload);
    const imageBase64 = attempt.ok ? extractBase64Image(attempt.json) : null;
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
    const { sourceImageBase64, targetCharacterBase64 } = body;

    if (!sourceImageBase64 || !targetCharacterBase64) {
      return NextResponse.json(
        {
          error: "sourceImageBase64 and targetCharacterBase64 are required.",
        },
        { status: 400 },
      );
    }

    const sourceImage = normalizeImageBase64(sourceImageBase64);
    const targetImage = normalizeImageBase64(targetCharacterBase64);
    const requestedCandidateCount = 1;
    const enableRefinement = false;

    const inputDebug = {
      source: {
        mimeType: sourceImage.mimeType,
        length: sourceImage.data.length,
        hash16: hashBase64(sourceImage.data),
      },
      target: {
        mimeType: targetImage.mimeType,
        length: targetImage.data.length,
        hash16: hashBase64(targetImage.data),
      },
    };

    const candidates: GeneratedCandidate[] = [];
    const failedRounds: Array<{
      round: number;
      message: string;
      attempts: AttemptSummary[];
      upstreamErrors: Array<{ variant: string; status: number; statusText: string; snippet: string }>;
    }> = [];

    for (let i = 0; i < requestedCandidateCount; i += 1) {
      const prompt = `${SYSTEM_PROMPT_BASE}\nValid candidate index: ${i + 1}.`;
      const initialResult = await generateOneCandidate(prompt, [sourceImage, targetImage], "initial");
      const initial = initialResult.candidate;
      if (initial) {
        candidates.push(initial);

        if (enableRefinement) {
          const draftAsImage = normalizeImageBase64(initial.imageBase64);
          const refinePrompt = `
${SYSTEM_PROMPT_BASE}
Additional instruction:
- Image 3 is a draft output.
- Correct Image 3 so that all background, composition, and text placement match Image 1 as closely as possible.
- Keep only the character replacement intent from Image 2.
`;
          const refinedResult = await generateOneCandidate(
            refinePrompt,
            [sourceImage, targetImage, draftAsImage],
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
        requestedCandidateCount,
        enableRefinement,
        generatedCandidateCount: candidates.length,
        failedRounds,
      },
      ...(DEBUG_ENABLED ? { debug: { input: inputDebug } } : {}),
    };

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Internal server error.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
