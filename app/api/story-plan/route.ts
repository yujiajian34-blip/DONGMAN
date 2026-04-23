import { NextResponse } from "next/server";
import {
  RequestValidationError,
  generateStructuredJson,
  normalizeImageBase64,
  sanitizeLongText,
  sanitizeShortText,
  type NormalizedImage,
} from "@/app/api/_lib/gemini";

type StoryImageInput = {
  name?: string;
  imageBase64?: string;
};

type StoryPlanRequestBody = {
  sourceImages?: StoryImageInput[];
  storyDirection?: string;
};

type StoryRole = {
  label: string;
  description: string;
};

type StoryScene = {
  title: string;
  narration: string;
  imagePrompt: string;
};

function getRequiredSceneCount(sourceImageCount: number): number {
  return sourceImageCount;
}

function normalizeSourceImages(rawImages: unknown): Array<{ name: string; image: NormalizedImage }> {
  if (!Array.isArray(rawImages) || rawImages.length === 0) {
    throw new RequestValidationError("Please upload at least one reference image for story analysis.");
  }

  return rawImages.map((rawImage, index) => {
    if (!rawImage || typeof rawImage !== "object") {
      throw new RequestValidationError(`Reference image ${index + 1} is invalid.`);
    }

    const candidate = rawImage as StoryImageInput;
    const imageBase64 = sanitizeLongText(candidate.imageBase64, 4_000_000);
    if (!imageBase64) {
      throw new RequestValidationError(`Reference image ${index + 1} is missing image data.`);
    }

    return {
      name: sanitizeShortText(candidate.name, 80) ?? `Reference ${index + 1}`,
      image: normalizeImageBase64(imageBase64),
    };
  });
}

function normalizeStoryRoles(rawRoles: unknown): StoryRole[] {
  const sourceRoles = Array.isArray(rawRoles) ? rawRoles : [];
  const roles = sourceRoles
    .map((rawRole, index) => {
      if (!rawRole || typeof rawRole !== "object") {
        return null;
      }

      const record = rawRole as Record<string, unknown>;
      const label = sanitizeShortText(record.label, 60) ?? `Role ${index + 1}`;
      const description =
        sanitizeShortText(record.description, 160) ??
        "Important recurring role inferred from the uploaded original images.";

      return {
        label,
        description,
      };
    })
    .filter((role): role is StoryRole => Boolean(role));

  if (roles.length > 0) {
    return roles.slice(0, 6);
  }

  return [
    {
      label: "Lead Role",
      description: "Primary recurring role inferred from the uploaded original images.",
    },
  ];
}

function normalizeScenes(rawScenes: unknown, requestedSceneCount: number): StoryScene[] {
  if (!Array.isArray(rawScenes)) {
    throw new RequestValidationError("Story analysis returned no scenes.");
  }

  const scenes = rawScenes
    .map((rawScene, index) => {
      if (!rawScene || typeof rawScene !== "object") {
        return null;
      }

      const record = rawScene as Record<string, unknown>;
      const title = sanitizeShortText(record.title, 80) ?? `Scene ${index + 1}`;
      const narration = sanitizeLongText(record.narration, 260) ?? "A key beat in the generated story.";
      const imagePrompt = sanitizeLongText(record.imagePrompt, 900);

      if (!imagePrompt) {
        return null;
      }

      return {
        title,
        narration,
        imagePrompt,
      };
    })
    .filter((scene): scene is StoryScene => Boolean(scene));

  if (scenes.length === 0) {
    throw new RequestValidationError("Story analysis returned no usable scene prompts.");
  }

  if (scenes.length < requestedSceneCount) {
    throw new RequestValidationError(
      `Story analysis must return exactly ${requestedSceneCount} scenes to match the uploaded original images in order.`,
    );
  }

  return scenes.slice(0, requestedSceneCount);
}

function buildStoryPlanPrompt(
  sourceImages: Array<{ name: string }>,
  requestedSceneCount: number,
  storyDirection: string | null,
): string {
  const sourceLines = sourceImages
    .map((image, index) => `${index + 1}. ${image.name} is an original story image that must be analyzed in sequence.`)
    .join("\n");
  const directionBlock = storyDirection
    ? `\nUSER ANALYSIS DIRECTION:\n${storyDirection}\nThis direction may clarify the analysis focus, but it must not rewrite, extend, replace, or alter the original plot shown in the uploaded images.\n`
    : "";

  return `You are a senior visual storyteller and storyboard writer.

Analyze the uploaded original images only and extract the exact existing plot they already depict.

OUTPUT RULES:
- Return strict JSON only.
- Do not wrap the JSON in markdown.
- Do not include reasoning or extra commentary.
- Use English for every field.
- Produce exactly ${requestedSceneCount} scenes.
- Treat the uploaded images as the source truth for the plot.
- Keep the original story order exactly the same as the uploaded image order.
- Do not rewrite, embellish, optimize, continue, reinterpret, or extend the plot.
- Do not add new events, new motivations, new transitions, or extra story beats that are not already present.
- Each returned scene must correspond to one uploaded original image in the same order.
- Keep the story visually and narratively faithful to the uploaded original images.
- Infer the recurring story roles from the uploaded original images.
- Use stable role labels consistently across all scene prompts, for example "Lead Role", "Friend", "Antagonist", or "Role 1".
- Each imagePrompt must faithfully restage the same story beat from the corresponding uploaded image without altering the underlying plot.
- Each imagePrompt should describe scene composition, lighting, environment, character placement, expressions, and the observed art direction from the corresponding original image.
- Preserve the original pacing, framing intent, and emotional progression shown by the uploaded image sequence.

JSON SCHEMA:
{
  "title": "string",
  "synopsis": "string",
  "visualStyle": "string",
  "storyRoles": [
    {
      "label": "string",
      "description": "string"
    }
  ],
  "scenes": [
    {
      "title": "string",
      "narration": "string",
      "imagePrompt": "string"
    }
  ]
}

 ORIGINAL STORY IMAGES:
${sourceLines}
${directionBlock}
The uploaded images after this prompt are ordered as follows:
- ${sourceImages.length} original image(s), in the same order as listed above.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StoryPlanRequestBody;
    const sourceImages = normalizeSourceImages(body.sourceImages);
    const storyDirection = sanitizeLongText(body.storyDirection, 1200);
    const requestedSceneCount = getRequiredSceneCount(sourceImages.length);
    const prompt = buildStoryPlanPrompt(sourceImages, requestedSceneCount, storyDirection);
    const payload = await generateStructuredJson(prompt, sourceImages.map((image) => image.image));

    const title = sanitizeShortText(payload.title, 100) ?? "Extracted Story";
    const synopsis =
      sanitizeLongText(payload.synopsis, 500) ??
      "A scene-by-scene extraction of the existing plot shown in the uploaded original images.";
    const visualStyle =
      sanitizeLongText(payload.visualStyle, 260) ??
      "Visual style extracted directly from the uploaded original images.";
    const storyRoles = normalizeStoryRoles(payload.storyRoles);
    const scenes = normalizeScenes(payload.scenes, requestedSceneCount);

    return NextResponse.json(
      {
        title,
        synopsis,
        visualStyle,
        storyRoles,
        scenes,
      },
      { status: 200 },
    );
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return NextResponse.json(
        {
          error: error.message,
        },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        error: "Story planning failed.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
