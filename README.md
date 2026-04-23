# DONGMAN

AI-assisted manga and comic replacement workbench built with Next.js and Electron.

The app supports three production workflows:

- `Single Subject Batch`: replace the main character in one or many source images with one or more characters from your local character library.
- `Mapped Subjects`: assign different ROIs in the same source image to different target characters.
- `Story Batch`: analyze uploaded original story images, extract the existing plot in order, map extracted roles to your character library, then regenerate scenes or comic pages.

## Core Features

- Character library with local persistence
- Single-subject batch replacement
- Multi-subject ROI mapping
- Story analysis from uploaded original images
- Scene-by-scene story frame generation
- `4-Panel Comic` and `9-Panel Comic` generation
- Automatic comic pagination for longer stories
- ZIP export for generated scenes and comic pages
- Electron desktop packaging

## Story Batch Flow

`Story Batch` is designed for "analyze first, generate later" workflows.

1. Upload the original story images in order.
2. The app analyzes only those images and extracts:
   - story title
   - synopsis
   - visual style
   - recurring story roles
   - one scene per uploaded image
3. Assign each extracted role to a character from your character library.
4. The app analyzes each assigned character portrait to build a stable appearance description.
5. Generate either:
   - `Scene Frames`: one image per extracted scene
   - `4-Panel Comic`: paginated comic pages with up to 4 panels per page
   - `9-Panel Comic`: paginated comic pages with up to 9 panels per page

Important behavior:

- The story analysis is intended to preserve the original plot order.
- Each extracted scene corresponds to one uploaded original image.
- Character consistency is driven by the assigned reference portraits from the character library.
- Comic generation uses automatic pagination, so longer stories are split into multiple comic pages instead of truncating to the first page only.

## Automatic Pagination

For comic modes, the app automatically balances the extracted scenes across multiple pages.

Examples:

- `4-panel mode`
  - 13 scenes -> `4 + 3 + 3 + 3`
  - 14 scenes -> `4 + 4 + 3 + 3`
  - 15 scenes -> `4 + 4 + 4 + 3`
- `9-panel mode`
  - 14 scenes -> `7 + 7`
  - 15 scenes -> `8 + 7`
  - 20 scenes -> `7 + 7 + 6`

This keeps the pacing more balanced than leaving a tiny trailing page whenever possible.

## Tech Stack

- Next.js 15
- React 19
- TypeScript
- Tailwind CSS 4
- Electron
- JSZip
- File Saver

## Project Structure

```text
app/
  api/
    _lib/
    character-appearance/
    replace/
    story-comic/
    story-plan/
    story-scene/
  layout.tsx
  page.tsx
components/
  CharacterLibrary.tsx
  ReplacerWorkbench.tsx
electron/
  main.cjs
hooks/
  useCharacterStore.ts
```

## Local Development

Install dependencies:

```powershell
npm install
```

Start the web app:

```powershell
npm run dev
```

Default local URL:

```text
http://127.0.0.1:3000/
```

Type-check:

```powershell
npm run typecheck
```

Build the web app:

```powershell
npm run build
```

## Desktop Packaging

Run the Electron desktop app in development:

```powershell
npm run desktop:dev
```

Build a portable Windows executable:

```powershell
npm run build:exe
```

## Environment Notes

The app talks to a Gemini-compatible image gateway from the server routes under `app/api/`.

Recommended environment variables:

```env
GEMINI_GATEWAY_TOKEN=your_token_here
GATEWAY_TIMEOUT_MS=70000
REFERENCE_IMAGE_GATEWAY_TIMEOUT_MS=180000
STORY_COMIC_GATEWAY_TIMEOUT_MS=240000
```

## Current Notes

- Character library data is stored locally in the app/browser environment.
- Story scene and comic generation both use assigned character reference images, not just text-only character descriptions.
- Comic text, if any appears in generated pages, is guided toward natural English.
- ZIP export supports story scenes and comic pages.

## Repository

GitHub: [yujiajian34-blip/DONGMAN](https://github.com/yujiajian34-blip/DONGMAN)
