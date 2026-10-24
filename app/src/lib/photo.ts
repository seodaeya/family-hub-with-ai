import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import type { PhotoSettings } from './types';

export type PreparedImage = {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
  originalWidth: number;
  originalHeight: number;
  uri: string;
};

const PRESET_COMPRESS: Record<number, number> = { 50: 0.7, 75: 0.8, 100: 0.9 };

export function targetWidth(originalWidth: number, settings: PhotoSettings): number {
  if (settings.mode === 'custom') {
    return Math.max(320, Math.min(originalWidth, settings.maxDimension));
  }
  return Math.max(320, Math.round((originalWidth * settings.preset) / 100));
}

export async function prepareImage(asset: ImagePickerAsset, settings: PhotoSettings): Promise<PreparedImage> {
  const originalWidth = asset.width || 0;
  const originalHeight = asset.height || 0;
  const width = targetWidth(originalWidth || 2000, settings);
  const compress = settings.mode === 'custom' ? settings.jpegQuality : PRESET_COMPRESS[settings.preset] ?? 0.8;

  const context = ImageManipulator.manipulate(asset.uri);
  if (width < originalWidth) context.resize({ width });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ compress, format: SaveFormat.JPEG, base64: true });

  const base64 = saved.base64 ?? '';
  const bytes = Math.round((base64.length * 3) / 4);
  const ratio = originalWidth ? width / originalWidth : 1;
  const height = Math.round(originalHeight * ratio);

  return {
    base64,
    mimeType: 'image/jpeg',
    width,
    height,
    bytes,
    originalBytes: asset.fileSize ?? bytes,
    originalWidth,
    originalHeight,
    uri: saved.uri,
  };
}

export function estimatedBytes(asset: ImagePickerAsset, settings: PhotoSettings): number {
  const original = asset.fileSize ?? 0;
  if (!original) return 0;
  const width = targetWidth(asset.width || 2000, settings);
  const ratio = asset.width ? width / asset.width : 0.75;
  const compress = settings.mode === 'custom' ? settings.jpegQuality : PRESET_COMPRESS[settings.preset] ?? 0.8;
  return Math.round(original * ratio * ratio * (compress / 0.9));
}

// --------------------------------------------------------- local photo store

const PHOTO_DIR = `${FileSystem.documentDirectory ?? ''}photos/`;

export async function ensurePhotoDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(PHOTO_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(PHOTO_DIR, { intermediates: true });
}

export async function savePhotoLocally(base64: string): Promise<string> {
  await ensurePhotoDir();
  const name = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}.jpg`;
  const uri = `${PHOTO_DIR}${name}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

export async function deletePhotoLocally(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // ignore
  }
}

export type PhotoStorage = { dir: string; count: number; bytes: number };

export type StoredPhoto = { uri: string; name: string; bytes: number; createdAt: number };

/** Photos kept in this device's folder, newest first. */
export async function listStoredPhotos(): Promise<StoredPhoto[]> {
  try {
    await ensurePhotoDir();
    const files = (await FileSystem.readDirectoryAsync(PHOTO_DIR)).filter((file) => file.endsWith('.jpg'));
    const photos: StoredPhoto[] = [];
    for (const name of files) {
      const uri = `${PHOTO_DIR}${name}`;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) continue;
      const stamp = Number(name.split('_')[0]);
      photos.push({
        uri,
        name,
        bytes: info.size ?? 0,
        createdAt: Number.isFinite(stamp) && stamp > 0 ? stamp : Date.now(),
      });
    }
    return photos.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/** What is actually sitting in this device's photo folder (for the settings screen). */
export async function photoStorageSummary(): Promise<PhotoStorage> {
  try {
    await ensurePhotoDir();
    const files = (await FileSystem.readDirectoryAsync(PHOTO_DIR)).filter((file) => file.endsWith('.jpg'));
    let bytes = 0;
    for (const file of files) {
      const info = await FileSystem.getInfoAsync(`${PHOTO_DIR}${file}`);
      if (info.exists) bytes += info.size ?? 0;
    }
    return { dir: PHOTO_DIR, count: files.length, bytes };
  } catch {
    return { dir: PHOTO_DIR, count: 0, bytes: 0 };
  }
}

/** Deletes photos older than the retention window. */
export async function cleanupOldPhotos(settings: PhotoSettings): Promise<number> {
  if (settings.retention === 'keep') return 0;
  const days = settings.retention === 'delete' ? 0 : settings.retention === '7d' ? 7 : 30;
  const cutoff = Date.now() - days * 86_400_000;
  try {
    await ensurePhotoDir();
    const files = await FileSystem.readDirectoryAsync(PHOTO_DIR);
    let removed = 0;
    for (const file of files) {
      const stamp = Number(file.split('_')[0]);
      if (Number.isFinite(stamp) && stamp < cutoff) {
        await FileSystem.deleteAsync(`${PHOTO_DIR}${file}`, { idempotent: true });
        removed += 1;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}
