import { NextResponse } from "next/server";
import {
  RequestValidationError,
  generateImageFromPromptWithReferences,
  normalizeImageBase64,
  sanitizeLongText,
  sanitizeShortText,
  type NormalizedImage,
} from "@/app/api/_lib/gemini";

type StoryRoleInput = {
  label?: string;
  description?: string;
  assignedCharacterName?: string;
  assignedCharacterAppearance?: string;
  assignedCharacterImageBase64?: string;
};

type StorySceneRequestBody = {
  storyTitle?: string;
  synopsis?: string;
  visualStyle?: string;
  sceneTitle?: string;
  sceneNarration?: string;
  scenePrompt?: string;
  storyDirection?: string;
  storyRoles?: StoryRoleInput[];
};

type StoryRole = {
  label: string;
  description: string;
  assignedCharacterName: string;
  assignedCharacterAppearance: string;
  assignedCharacterImage: NormalizedImage;
};

function normalizeStoryRoles(rawRoles: unknown): StoryRole[] {
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    throw new RequestValidationError("Please assign at least one story role before generating story images.");
  }

  const roles = rawRoles
    .map((rawRole, index) => {
      if (!rawRole || typeof rawRole !== "object") {
        return null;
      }

      const record = rawRole as StoryRoleInput;
      const label = sanitizeShortText(record.label, 60);
      const assignedCharacterName = sanitizeShortText(record.assignedCharacterName, 60);
      if (!label || !assignedCharacterName) {
        return null;
      }

      return {
        label,
        description: sanitizeShortText(record.description, 160) ?? `Important story role ${index + 1}.`,
        assignedCharacterName,
        assignedCharacterAppearance:
          sanitizeLongText(record.assignedCharacterAppearance, 280) ??
          `Use the exact visual identity from the uploaded reference portrait for ${assignedCharacterName}.`,
        assignedCharacterImage: normalizeImageBase64(
          sanitizeLongText(record.assignedCharacterImageBase64, 4_000_000) ??
            (() => {
              throw new RequestValidationError(
                `Assigned character reference image is missing for role "${label}".`,
              );
            })(),
        ),
      };
    })
    .filter((role): role is StoryRole => Boolean(role));

  if (roles.length === 0) {
    throw new RequestValidationError("Please provide at least one usable assigned story role.");
  }

  return roles;
}

function buildSceneGenerationPrompt(body: StorySceneRequestBody, storyRoles: StoryRole[]): string {
  const storyTitle = sanitizeShortText(body.storyTitle, 100) ?? "Generated Story";
  const synopsis = sanitizeLongText(body.synopsis, 500) ?? "A storyboard-driven sequence generated from reference images.";
  const visualStyle =
    sanitizeLongText(body.visualStyle, 260) ??
    "Cinematic manga-inspired illustration with strong composition and consistent character designs.";
  const sceneTitle = sanitizeShortText(body.sceneTitle, 100);
  const sceneNarration = sanitizeLongText(body.sceneNarration, 300);
  const scenePrompt = sanitizeLongText(body.scenePrompt, 1_200);
  const storyDirection = sanitizeLongText(body.storyDirection, 1_200);

  if (!scenePrompt) {
    throw new RequestValidationError("scenePrompt is required.");
  }

  const roleBlock = storyRoles
    .map(
      (role, index) =>
        `${index + 1}. Story role "${role.label}" is played by ${role.assignedCharacterName}. Role description: ${role.description}. Character appearance requirement: ${role.assignedCharacterAppearance}. Reference image order: Image ${index + 1}.`,
    )
    .join("\n");

  const directionBlock = storyDirection ? `\nADDITIONAL USER DIRECTION:\n${storyDirection}\n` : "";
  const sceneTitleBlock = sceneTitle ? `\nSCENE TITLE:\n${sceneTitle}\n` : "";
  const sceneNarrationBlock = sceneNarration ? `\nSCENE BEAT:\n${sceneNarration}\n` : "";

  return `Create a single finished illustration for a story scene.

GLOBAL STORY CONTEXT:
Story title: ${storyTitle}
Synopsis: ${synopsis}
Visual style: ${visualStyle}

ROLE TO CHARACTER ASSIGNMENTS:
${roleBlock}
${sceneTitleBlock}${sceneNarrationBlock}
PRIMARY SCENE PROMPT:
${scenePrompt}
${directionBlock}
REFERENCE IMAGE ORDER:
- The role reference portraits are attached after this prompt in the same order as listed in ROLE TO CHARACTER ASSIGNMENTS.

IMAGE REQUIREMENTS:
- Output one complete frame only.
- Preserve the scene beat, composition, and emotional progression described in the prompt.
- Replace each story role mentioned in the prompt with the assigned character above.
- Use the attached role reference portraits as the primary source of truth for each character's face, hair, outfit, body type, and visual identity.
- Keep character identities consistent across scenes.
- Match the visual style described above.
- Make the composition clean, readable, and story-forward.
- Avoid text overlays, speech bubbles, watermarks, split panels, and UI elements unless the prompt explicitly asks for them.
- Emphasize expressive poses, clear staging, and cinematic lighting.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StorySceneRequestBody;
    const storyRoles = normalizeStoryRoles(body.storyRoles);
    const prompt = buildSceneGenerationPrompt(body, storyRoles);
    const imageBase64 = await generateImageFromPromptWithReferences(
      prompt,
      storyRoles.map((role) => role.assignedCharacterImage),
      {
        maxAttempts: 2,
      },
    );

    return NextResponse.json(
      {
        imageBase64,
        candidates: [
          {
            imageBase64,
            meta: {
              stage: "initial",
              selectedVariant: "images.generations",
            },
          },
        ],
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
        error: "Story scene generation failed.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
