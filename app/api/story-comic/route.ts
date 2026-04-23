import { NextResponse } from "next/server";
import {
  RequestValidationError,
  generateImageFromPromptWithReferences,
  getStoryComicGatewayTimeoutMs,
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

type StoryComicSceneInput = {
  title?: string;
  narration?: string;
  imagePrompt?: string;
};

type StoryComicRequestBody = {
  storyTitle?: string;
  synopsis?: string;
  visualStyle?: string;
  storyDirection?: string;
  storyRoles?: StoryRoleInput[];
  scenes?: StoryComicSceneInput[];
  panelCount?: number;
  pageCapacity?: number;
};

type StoryRole = {
  label: string;
  description: string;
  assignedCharacterName: string;
  assignedCharacterAppearance: string;
  assignedCharacterImage: NormalizedImage;
};

type StoryComicScene = {
  title: string;
  narration: string;
  imagePrompt: string;
};

function normalizeStoryRoles(rawRoles: unknown): StoryRole[] {
  if (!Array.isArray(rawRoles) || rawRoles.length === 0) {
    throw new RequestValidationError("Please assign at least one story role before generating the comic page.");
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
          sanitizeLongText(record.assignedCharacterAppearance, 320) ??
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

function normalizePageCapacity(rawPageCapacity: unknown): 4 | 9 {
  return Number(rawPageCapacity) === 9 ? 9 : 4;
}

function normalizePanelCount(rawPanelCount: unknown, pageCapacity: number): number {
  const panelCount = Number(rawPanelCount);
  if (Number.isInteger(panelCount) && panelCount >= 1 && panelCount <= pageCapacity) {
    return panelCount;
  }

  return pageCapacity;
}

function normalizeScenes(rawScenes: unknown, panelCount: number): StoryComicScene[] {
  if (!Array.isArray(rawScenes) || rawScenes.length < panelCount) {
    throw new RequestValidationError(
      `Please provide at least ${panelCount} extracted scenes before generating this comic page.`,
    );
  }

  const scenes = rawScenes
    .map((rawScene, index) => {
      if (!rawScene || typeof rawScene !== "object") {
        return null;
      }

      const record = rawScene as StoryComicSceneInput;
      const imagePrompt = sanitizeLongText(record.imagePrompt, 1_200);
      if (!imagePrompt) {
        return null;
      }

      return {
        title: sanitizeShortText(record.title, 100) ?? `Scene ${index + 1}`,
        narration: sanitizeLongText(record.narration, 320) ?? "A key beat in the extracted story.",
        imagePrompt,
      };
    })
    .filter((scene): scene is StoryComicScene => Boolean(scene));

  if (scenes.length < panelCount) {
    throw new RequestValidationError(`This comic page needs ${panelCount} usable extracted scenes.`);
  }

  return scenes.slice(0, panelCount);
}

function getPanelLayoutRequirement(panelCount: number, pageCapacity: number): {
  layoutText: string;
  panelLayoutRequirement: string;
  panelOrderRequirement: string;
} {
  if (pageCapacity === 4 && panelCount === 4) {
    return {
      layoutText: "strict 2x2 four-panel layout",
      panelLayoutRequirement: "- Use exactly 4 clearly separated panels arranged in a 2x2 grid.",
      panelOrderRequirement:
        "- Panel 1 must correspond to Scene 1, Panel 2 to Scene 2, Panel 3 to Scene 3, and Panel 4 to Scene 4.",
    };
  }

  if (pageCapacity === 9 && panelCount === 9) {
    return {
      layoutText: "strict 3x3 nine-panel layout",
      panelLayoutRequirement: "- Use exactly 9 clearly separated panels arranged in a 3x3 grid.",
      panelOrderRequirement:
        "- Panel 1 must correspond to Scene 1, Panel 2 to Scene 2, and continue in order through Panel 9.",
    };
  }

  const layoutText =
    pageCapacity === 4
      ? `balanced comic page with exactly ${panelCount} panels`
      : `balanced multi-panel comic page with exactly ${panelCount} panels`;
  const panelLayoutRequirement =
    panelCount <= 2
      ? `- Use exactly ${panelCount} clearly separated panels in a simple readable split layout.`
      : panelCount <= 4
        ? `- Use exactly ${panelCount} clearly separated panels in a balanced compact comic layout.`
        : `- Use exactly ${panelCount} clearly separated panels in a balanced multi-row comic layout.`;

  return {
    layoutText,
    panelLayoutRequirement,
    panelOrderRequirement: `- Panel 1 must correspond to Scene 1, Panel 2 to Scene 2, and continue in order through Panel ${panelCount}.`,
  };
}

function buildComicPrompt(
  body: StoryComicRequestBody,
  storyRoles: StoryRole[],
  scenes: StoryComicScene[],
  panelCount: number,
  pageCapacity: number,
): string {
  const storyTitle = sanitizeShortText(body.storyTitle, 100) ?? "Extracted Story";
  const synopsis = sanitizeLongText(body.synopsis, 500) ?? "A scene-by-scene extraction of the original plot.";
  const visualStyle =
    sanitizeLongText(body.visualStyle, 260) ??
    "Hand-drawn manga page with strong continuity, expressive acting, and clean panel composition.";
  const storyDirection = sanitizeLongText(body.storyDirection, 1_200);

  const roleBlock = storyRoles
    .map(
      (role, index) =>
        `${index + 1}. Story role "${role.label}" is played by ${role.assignedCharacterName}. Role description: ${role.description}. Character appearance requirement: ${role.assignedCharacterAppearance}. Reference image order: Image ${index + 1}.`,
    )
    .join("\n");

  const sceneBlock = scenes
    .map(
      (scene, index) =>
        `Panel ${index + 1}: "${scene.title}". Beat: ${scene.narration}. Restage prompt: ${scene.imagePrompt}.`,
    )
    .join("\n");

  const directionBlock = storyDirection ? `\nADDITIONAL USER DIRECTION:\n${storyDirection}\n` : "";
  const { layoutText, panelLayoutRequirement, panelOrderRequirement } = getPanelLayoutRequirement(
    panelCount,
    pageCapacity,
  );

  return `Create one finished hand-drawn comic page with a ${layoutText}.

GLOBAL STORY CONTEXT:
Story title: ${storyTitle}
Synopsis: ${synopsis}
Visual style: ${visualStyle}

ROLE TO CHARACTER ASSIGNMENTS:
${roleBlock}

PANEL ORDER:
${sceneBlock}
${directionBlock}
REFERENCE IMAGE ORDER:
- The role reference portraits are attached after this prompt in the same order as listed in ROLE TO CHARACTER ASSIGNMENTS.

IMAGE REQUIREMENTS:
- Output a single comic page only.
${panelLayoutRequirement}
${panelOrderRequirement}
- Do not add any new plot events beyond the provided ${panelCount} extracted scenes.
- Use the attached role reference portraits as the primary source of truth for each character's face, hair, outfit, body type, and visual identity.
- Keep all assigned characters visually consistent across every panel.
- Make the page read clearly from left to right, top to bottom.
- Preserve continuity of costume, hairstyle, body shape, and emotional progression.
- Emphasize hand-drawn manga/comic page aesthetics, strong storytelling, readable acting, and page-level continuity.
- Avoid text overlays, speech bubbles, watermarks, UI, logos, and captions unless explicitly required by the prompt.
- Prefer no visible text inside the artwork.
- If any visible text, lettering, signs, captions, sound effects, or dialogue appears, it must be correct natural English only.
- If speech bubbles or dialogue are present, write them as fluent idiomatic American conversational English.
- Make dialogue sound like real spoken American English, not a literal translation.
- Use short, punchy, readable comic lines with natural contractions when appropriate, for example "I'm", "you're", "gonna", "wanna", "let's", or "got it".
- Keep each speech bubble brief and legible, usually one short sentence or phrase.
- Keep spelling, grammar, and punctuation correct in every bubble.
- Never use Chinese, Japanese, Korean, pseudo-text, gibberish, or mixed-language lettering.
- Keep gutters clean and panel separation obvious.`;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as StoryComicRequestBody;
    const pageCapacity = normalizePageCapacity(body.pageCapacity);
    const panelCount = normalizePanelCount(body.panelCount, pageCapacity);
    const storyRoles = normalizeStoryRoles(body.storyRoles);
    const scenes = normalizeScenes(body.scenes, panelCount);
    const prompt = buildComicPrompt(body, storyRoles, scenes, panelCount, pageCapacity);
    const imageBase64 = await generateImageFromPromptWithReferences(
      prompt,
      storyRoles.map((role) => role.assignedCharacterImage),
      {
        timeoutMs: getStoryComicGatewayTimeoutMs(),
        maxAttempts: 2,
      },
    );

    return NextResponse.json(
      {
        imageBase64,
        panelCount,
        pageCapacity,
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
        error: "Comic page generation failed.",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}
