"use client";

import { ChangeEvent, useState } from "react";
import { Trash2, UserRoundPlus } from "lucide-react";
import type { Character } from "@/hooks/useCharacterStore";

type CharacterLibraryProps = {
  characters: Character[];
  selectionMode: "single" | "multi";
  selectedCharacterIds: string[];
  storageWarning?: string | null;
  isBusy?: boolean;
  selectionEnabled?: boolean;
  selectionDisabledMessage?: string;
  onSelectionModeChange: (mode: "single" | "multi") => void;
  onToggleCharacterSelection: (id: string) => void;
  onAddCharacter: (name: string, imageBase64: string) => Promise<void> | void;
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
  selectionMode,
  selectedCharacterIds,
  storageWarning,
  isBusy = false,
  selectionEnabled = true,
  selectionDisabledMessage,
  onSelectionModeChange,
  onToggleCharacterSelection,
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
    if (isBusy) {
      return;
    }

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
      await onAddCharacter(characterName.trim(), imageBase64);

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
        <p className="mt-1 text-xs text-zinc-500">Upload reusable reference portraits, then choose targets or assign them per person.</p>
      </div>

      {selectionEnabled ? (
        <>
          <div className="mb-3 inline-flex w-full rounded-lg border border-zinc-800 bg-zinc-900/80 p-1">
            <button
              type="button"
              onClick={() => onSelectionModeChange("single")}
              disabled={isBusy}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
                selectionMode === "single"
                  ? "bg-emerald-500 text-zinc-950"
                  : "text-zinc-300 hover:bg-zinc-800"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => onSelectionModeChange("multi")}
              disabled={isBusy}
              className={`flex-1 rounded-md px-3 py-2 text-xs font-medium transition ${
                selectionMode === "multi"
                  ? "bg-emerald-500 text-zinc-950"
                  : "text-zinc-300 hover:bg-zinc-800"
              } disabled:cursor-not-allowed disabled:opacity-60`}
            >
              Multi
            </button>
          </div>

          <p className="mb-4 text-xs text-zinc-500">
            {selectionMode === "single"
              ? "Single mode applies one target character to the whole batch."
              : `${selectedCharacterIds.length} target(s) selected for the current batch.`}
          </p>
        </>
      ) : (
        <p className="mb-4 rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-500">
          {selectionDisabledMessage ??
            "Multi-subject mapping mode is active. Add or manage characters here, then assign each person inside the workbench."}
        </p>
      )}

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
          disabled={isBusy}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 outline-none ring-emerald-500 transition focus:ring-2"
        />

        <input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={isBusy}
          className="w-full cursor-pointer rounded-lg border border-dashed border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-200 hover:file:bg-zinc-700"
        />

        <button
          type="button"
          onClick={handleAddCharacter}
          disabled={isBusy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400"
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
          const isSelected = selectedCharacterIds.includes(character.id);
          const selectionHint = !selectionEnabled
            ? "Available for mapping"
            : selectionMode === "multi"
              ? isSelected
                ? "Included in batch"
                : "Click to include"
              : isSelected
                ? "Selected"
                : "Click to select";

          return (
            <div
              key={character.id}
              className={`group flex items-center gap-3 rounded-xl border p-2 transition ${
                selectionEnabled && isSelected
                  ? "border-emerald-500/80 bg-emerald-500/10"
                  : "border-zinc-800 bg-zinc-900/60 hover:border-zinc-700"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (!selectionEnabled) {
                    return;
                  }
                  onToggleCharacterSelection(character.id);
                }}
                disabled={isBusy || !selectionEnabled}
                className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
              >
                <img
                  src={character.imageBase64}
                  alt={character.name}
                  className="h-12 w-12 rounded-lg border border-zinc-700 object-cover"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-zinc-100">{character.name}</span>
                  <span className="block text-xs text-zinc-500">{selectionHint}</span>
                </span>
              </button>

              {selectionEnabled && isSelected ? (
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                  {selectionMode === "multi" ? "On" : "Active"}
                </span>
              ) : null}

              <button
                type="button"
                onClick={() => onRemoveCharacter(character.id)}
                disabled={isBusy}
                className="rounded-md p-1.5 text-zinc-500 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-50"
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
