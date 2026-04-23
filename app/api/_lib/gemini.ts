type GatewayResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
  json: unknown;
};

type GenerateContentPart = {
  text?: string;
  thought?: boolean;
};

type GenerateContentCandidate = {
  content?: {
    parts?: GenerateContentPart[];
  };
};

type GenerateContentResponse = {
  candidates?: GenerateContentCandidate[];
};

export class RequestValidationError extends Error {}

type PostJsonOptions = {
  timeoutMs?: number;
};

type ImageGenerationOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
};

export type NormalizedImage = {
  mimeType: string;
  data: string;
};

const GENERATE_CONTENT_URL =
  "http://aigw.primeinnos.com/marketing_center_gemini/v1/projects/gemini-flat260304-2/locations/global/publishers/google/models/gemini-3.1-flash-image-preview:generateContent";
const IMAGE_GENERATIONS_URL = "http://aigw.primeinnos.com/marketing_center_gemini/v1/images/generations";
const GEMINI_MODEL = "gemini-3.1-flash-image-preview";
const GATEWAY_TOKEN = process.env.GEMINI_GATEWAY_TOKEN ?? "tk-P0L4myF72gCLmGdpa9jJpqoRvgKWDy68";
const GATEWAY_TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS ?? 70000);
const REFERENCE_IMAGE_GATEWAY_TIMEOUT_MS = Number(process.env.REFERENCE_IMAGE_GATEWAY_TIMEOUT_MS ?? 180000);
const STORY_COMIC_GATEWAY_TIMEOUT_MS = Number(process.env.STORY_COMIC_GATEWAY_TIMEOUT_MS ?? 240000);

export function sanitizeShortText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return null;
  }

  return normalized.slice(0, maxLength);
}

export function sanitizeLongText(value: unknown, maxLength: number): string | null {
  return sanitizeShortText(value, maxLength);
}

export function normalizeImageBase64(rawBase64: string): NormalizedImage {
  const value = rawBase64.trim();
  const compact = value.replace(/\s/g, "");

  if (!compact) {
    throw new RequestValidationError("Image payload is empty.");
  }

  if (compact.startsWith("data:")) {
    const commaIndex = compact.indexOf(",");
    if (commaIndex <= 5 || commaIndex >= compact.length - 1) {
      throw new RequestValidationError("Malformed data URL image payload.");
    }

    const header = compact.slice(5, commaIndex);
    const data = compact.slice(commaIndex + 1);
    const semicolonIndex = header.indexOf(";");
    const mimeType = semicolonIndex === -1 ? header : header.slice(0, semicolonIndex);

    if (mimeType.toLowerCase() === "image/svg+xml") {
      throw new RequestValidationError("SVG images are not supported by the gateway. Please upload PNG, JPG, or WEBP images.");
    }

    return {
      mimeType: mimeType.startsWith("image/") ? mimeType : "image/png",
      data,
    };
  }

  return {
    mimeType: "image/png",
    data: compact,
  };
}

async function postJson(
  url: string,
  payload: Record<string, unknown>,
  options: PostJsonOptions = {},
): Promise<GatewayResponse> {
  const timeoutMs = Math.max(1_000, Number(options.timeoutMs ?? GATEWAY_TIMEOUT_MS));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${GATEWAY_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await response.text();
    let json: unknown = null;

    try {
      json = text ? (JSON.parse(text) as unknown) : null;
    } catch {
      json = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      text,
      json,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
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

function extractModelText(payload: unknown): string {
  const response = payload as GenerateContentResponse | null;
  const parts = response?.candidates?.[0]?.content?.parts ?? [];

  return parts
    .filter((part) => typeof part.text === "string" && part.thought !== true)
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("");
}

function extractJsonText(text: string): string {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
  if (fencedMatch?.[1]) {
    return fencedMatch[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1).trim();
  }

  return text.trim();
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
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const queue: unknown[] = [payload];
  const visited = new Set<object>();
  const priorityKeys = ["b64_json", "imageBase64", "base64", "image", "data"];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null) {
      continue;
    }

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (trimmed.startsWith("data:image/")) {
        return trimmed;
      }

      const compact = trimmed.replace(/\s/g, "");
      if (looksLikeBase64(compact)) {
        return compact;
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

function buildGatewayErrorMessage(response: GatewayResponse, fallback: string): string {
  if (response.status === 401 || response.status === 403) {
    return "Gateway authentication failed. Check the configured token and retry.";
  }

  if (response.status === 408) {
    return "Gateway timed out before a complete response was returned.";
  }

  if (response.status === 429) {
    return "Gateway is rate limited right now. Wait a moment and retry.";
  }

  const snippet = response.text.slice(0, 240).trim();
  return snippet ? `${fallback} ${snippet}` : fallback;
}

export async function generateStructuredJson(
  prompt: string,
  images: NormalizedImage[],
): Promise<Record<string, unknown>> {
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          ...images.map((image) => ({
            inlineData: {
              mimeType: image.mimeType,
              data: image.data,
            },
          })),
        ],
      },
    ],
    generationConfig: {
      temperature: 0.35,
      responseMimeType: "application/json",
    },
  };

  const response = await postJson(GENERATE_CONTENT_URL, payload);
  if (!response.ok) {
    throw new Error(buildGatewayErrorMessage(response, "Story analysis request failed."));
  }

  const modelText = extractModelText(response.json) || response.text;
  const jsonText = extractJsonText(modelText);

  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Structured response was not a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `Failed to parse structured story response. ${error.message}`
        : "Failed to parse structured story response.",
    );
  }
}

export async function generateImageFromPrompt(
  prompt: string,
  options: ImageGenerationOptions = {},
): Promise<string> {
  const payload = {
    model: GEMINI_MODEL,
    prompt,
  };

  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 1));
  let lastFailureMessage = "Story image generation failed.";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await postJson(IMAGE_GENERATIONS_URL, payload, { timeoutMs: options.timeoutMs });
    if (!response.ok) {
      lastFailureMessage = buildGatewayErrorMessage(response, "Story image generation failed.");
      continue;
    }

    const imageBase64 = extractBase64Image(response.json) ?? extractBase64FromText(response.text);
    if (!imageBase64) {
      lastFailureMessage = "Story image generation returned no image.";
      continue;
    }

    return imageBase64.startsWith("data:image/") ? imageBase64 : `data:image/png;base64,${imageBase64}`;
  }

  throw new Error(lastFailureMessage);
}

export async function generateImageFromPromptWithReferences(
  prompt: string,
  images: NormalizedImage[],
  options: ImageGenerationOptions = {},
): Promise<string> {
  if (images.length === 0) {
    return generateImageFromPrompt(prompt, options);
  }

  const payloadVariants: Array<Record<string, unknown>> = [
    {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...images.map((image) => ({
              inlineData: {
                mimeType: image.mimeType,
                data: image.data,
              },
            })),
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseModalities: ["IMAGE"],
      },
    },
    {
      contents: [
        {
          role: "user",
          parts: [
            { text: prompt },
            ...images.map((image) => ({
              inline_data: {
                mime_type: image.mimeType,
                data: image.data,
              },
            })),
          ],
        },
      ],
      generation_config: {
        temperature: 0.2,
        response_modalities: ["IMAGE"],
      },
    },
  ];

  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? 1));
  const timeoutMs = options.timeoutMs ?? REFERENCE_IMAGE_GATEWAY_TIMEOUT_MS;
  let lastFailureMessage = "Story image generation failed.";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    for (const payload of payloadVariants) {
      const response = await postJson(GENERATE_CONTENT_URL, payload, { timeoutMs });
      if (!response.ok) {
        lastFailureMessage = buildGatewayErrorMessage(response, "Story image generation failed.");
        continue;
      }

      const imageBase64 = extractBase64Image(response.json) ?? extractBase64FromText(response.text);
      if (!imageBase64) {
        lastFailureMessage = "Story image generation returned no image.";
        continue;
      }

      return imageBase64.startsWith("data:image/") ? imageBase64 : `data:image/png;base64,${imageBase64}`;
    }
  }

  throw new Error(lastFailureMessage);
}

export function getStoryComicGatewayTimeoutMs(): number {
  return STORY_COMIC_GATEWAY_TIMEOUT_MS;
}
