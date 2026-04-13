"use client";

import { useCallback, useEffect, useState } from "react";

export type Character = {
  id: string;
  name: string;
  imageBase64: string;
};

type UseCharacterStoreReturn = {
  addCharacter: (name: string, imageBase64: string) => Character;
  removeCharacter: (id: string) => void;
  getCharacters: () => Character[];
  storageWarning: string | null;
};

const STORAGE_KEY = "manga-replacer.characters";

function isQuotaExceededError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }

  return error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED";
}

function persistCharactersWithinQuota(characters: Character[]): number {
  if (typeof window === "undefined") {
    return characters.length;
  }

  let candidate = [...characters];

  while (candidate.length > 0) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
      return candidate.length;
    } catch (error) {
      if (!isQuotaExceededError(error)) {
        throw error;
      }
      candidate = candidate.slice(0, -1);
    }
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
  return 0;
}

function isCharacter(value: unknown): value is Character {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Character>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.imageBase64 === "string"
  );
}

function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useCharacterStore(): UseCharacterStoreReturn {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }

      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        setCharacters(parsed.filter(isCharacter));
      }
    } catch {
      setCharacters([]);
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") {
      return;
    }

    try {
      const persistedCount = persistCharactersWithinQuota(characters);
      const droppedCount = characters.length - persistedCount;

      if (droppedCount > 0) {
        setStorageWarning(
          `Local storage quota reached. ${droppedCount} oldest character(s) were not persisted.`,
        );
      } else {
        setStorageWarning(null);
      }
    } catch {
      setStorageWarning("Failed to persist character library to local storage.");
    }
  }, [characters, hydrated]);

  const addCharacter = useCallback((name: string, imageBase64: string): Character => {
    const newCharacter: Character = {
      id: makeId(),
      name: name.trim(),
      imageBase64,
    };

    setCharacters((prev) => [newCharacter, ...prev]);
    return newCharacter;
  }, []);

  const removeCharacter = useCallback((id: string): void => {
    setCharacters((prev) => prev.filter((character) => character.id !== id));
  }, []);

  const getCharacters = useCallback((): Character[] => characters, [characters]);

  return {
    addCharacter,
    removeCharacter,
    getCharacters,
    storageWarning,
  };
}
