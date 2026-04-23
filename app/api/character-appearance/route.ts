import { NextResponse } from "next/server";
import {
  RequestValidationError,
  generateStructuredJson,
  normalizeImageBase64,
  sanitizeLongText,
  sanitizeShortText,
} from "@/app/api/_lib/gemini";

type CharacterAppearanceRequestBody = {
  characterName?: string;
  imageBase64?: string;
};

function buildAppearancePrompt(characterName: string): string {
  return `You are preparing a character reference for story image generation.

Analyze the uploaded character portrait and describe only the stable visual identity of the character.

OUTPUT RULES:
- Return strict JSON only.
- Do not wrap the JSON in markdown.
- Do not include reasoning or extra commentary.
- Use English.
- Focus on fixed appearance traits that should stay consistent across scenes.
- Mention face shape, hair, age impression, body build, skin tone if visible, signature clothing, colors, accessories, and overall vibe.
- Do not mention image quality, background, framing, or camera angle unless the costume or accessory depends on it.
- Keep the description concise but specific enough for image generation.

JSON SCHEMA:
{
  "appearance": "string"
}

Character name: ${characterName}`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CharacterAppearanceRequestBody;
    const characterName = sanitizeShortText(body.characterName, 80) ?? "Character";
    const imageBase64 = sanitizeLongText(body.imageBase64, 4_000_000);

    if (!imageBase64) {
      throw new RequestValidationError("Character image is required.");
    }

    const payload = await generateStructuredJson(buildAppearancePrompt(characterName), [normalizeImageBase64(imageBase64)]);
    const appearance =
      sanitizeLongText(payload.appearance, 320) ??
      `Use the exact visual identity of ${characterName}, including the same face, hairstyle, outfit, and silhouette from the uploaded portrait.`;

    return NextResponse.json(
      {
        appearance,
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
        error: "Character appearance analysis failed.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
