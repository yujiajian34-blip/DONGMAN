"use client";

import { ChangeEvent, useState } from "react";
import { Trash2, UserRoundPlus } from "lucide-react";
import type { Character } from "@/hooks/useCharacterStore";

type CharacterLibraryProps = {
  characters: Character[];
  selectedCharacterId: string | null;
  storageWarning?: string | null;
  onSelectCharacter: (id: string) => void;
  onAddCharacter: (name: string, imageBase64: string) => void;
  onRemoveCharacter: (id: string) => void;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read character image."));
        return;
      }
      resolve(result);
    };

    reader.onerror = () => reject(new Error("Failed to read character image."));
    reader.readAsDataURL(file);
  });
}

export function CharacterLibrary({
  characters,
  selectedCharacterId,
  storageWarning,
  onSelectCharacter,
  onAddCharacter,
  onRemoveCharacter,
}: CharacterLibraryProps) {
  const [characterName, setCharacterName] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setPendingFile(file);
    setUploadError(null);
  };

  const handleAddCharacter = async () => {
    if (!pendingFile) {
      setUploadError("Please upload a character image first.");
      return;
    }

    if (!characterName.trim()) {
      setUploadError("Please provide a character name.");
      return;
    }

    try {
      const imageBase64 = await fileToBase64(pendingFile);
      onAddCharacter(characterName.trim(), imageBase64);

      setCharacterName("");
      setPendingFile(null);
      setUploadError(null);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to add character.");
    }
  };

  return (
    <aside className="h-full rounded-2xl border border-zinc-800/90 bg-zinc-950/70 p-4 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="mb-4">
        <h2 className="text-sm font-semibold uppercase tracking-[0.18em] text-zinc-300">Character Library</h2>
        <p className="mt-1 text-xs text-zinc-500">Upload a reference portrait and keep it reusable.</p>
      </div>

      {storageWarning ? (
        <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200">
          {storageWarning}
        </div>
      ) : null}

      <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/80 p-3">
        <input
          type="text"
          value={characterName}
          onChange={(event) => setCharacterName(event.target.value)}
          placeholder="Character name"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2"
        />

        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="w-full cursor-pointer rounded-lg border border-dashed border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-200 hover:file:bg-zinc-700"
        />

        <button
          type="button"
          onClick={handleAddCharacter}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400"
        >
          <UserRoundPlus size={16} />
          Add Character
        </button>

        {uploadError ? <p className="text-xs text-rose-400">{uploadError}</p> : null}
      </div>

      <div className="mt-4 max-h-[52vh] space-y-2 overflow-y-auto pr-1">
        {characters.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/80 p-4 text-xs text-zinc-500">
            No characters yet. Add one to start replacing.
          </div>
        ) : null}

        {characters.map((character) => {
          const isSelected = selectedCharacterId === character.id;

          return (
            <div
              key={character.id}
              className={`group flex items-center gap-3 rounded-xl border p-2 transition ${
                isSelected
                  ? "border-emerald-500/80 bg-emerald-500/10"
                  : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectCharacter(character.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <img
                  src={character.imageBase64}
                  alt={character.name}
                  className="h-12 w-12 rounded-lg border border-zinc-700 object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-100">{character.name}</p>
                  <p className="text-xs text-zinc-500">{isSelected ? "Selected" : "Click to select"}</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => onRemoveCharacter(character.id)}
                className="rounded-md p-1.5 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400"
                aria-label={`Remove ${character.name}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
