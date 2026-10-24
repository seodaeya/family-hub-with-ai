import type { ExtractResult } from './types';

export type PreparedDraftImage = {
  uri: string;
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
};

export type ReviewDraft = {
  result: ExtractResult;
  images: PreparedDraftImage[];
  text?: string;
};

let draft: ReviewDraft | null = null;

export function setDraft(next: ReviewDraft): void {
  draft = next;
}

export function takeDraft(): ReviewDraft | null {
  const current = draft;
  draft = null;
  return current;
}

export function peekDraft(): ReviewDraft | null {
  return draft;
}
