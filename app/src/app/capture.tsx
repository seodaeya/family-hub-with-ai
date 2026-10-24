import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { getAiSettings, getPhotoSettings, defaultPhotoSettings } from '@/lib/db';
import { prepareImage, type PreparedImage } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { setDraft } from '@/lib/store';
import type { AiSettings, PhotoSettings } from '@/lib/types';
import { formatBytes } from '@/lib/format';
import { Badge, Btn, Card, Field, Hint, Screen } from '@/components/ui';
import { colors, font, radius, space } from '@/theme';

const EXTERNAL_PROMPT = `아래 사진(또는 붙여넣은 글)은 한국 학교/학원의 안내문이야.
날짜가 있는 일정, 준비물·구매 목록, 해야 할 일을 뽑아서 아래 JSON 형식으로만 답해줘.
설명이나 인사말은 쓰지 말고, 없는 내용은 만들지 마.

{"events":[{"title":"","startsAt":"YYYY-MM-DDTHH:mm:00+09:00","endsAt":null,"allDay":false,"location":null,"memo":null,"confidence":0.9}],"items":[{"listType":"supply","title":"","qty":null,"dueAt":null,"confidence":0.9}],"warnings":[]}

listType은 shopping(사야 할 것) / supply(준비물) / todo(할 일) 중 하나.
결과를 복사해서 우리집 AI 앱의 "결과 붙여넣기"에 넣어줘.`;

type Stage = 'idle' | 'reading' | 'thinking';

export default function CaptureScreen() {
  const router = useRouter();
  const { health } = useSession();
  const [photos, setPhotos] = useState<PreparedImage[]>([]);
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [pasted, setPasted] = useState('');
  const [textOnly, setTextOnly] = useState('');
  const [photoSettings, setPhotoSettings] = useState<PhotoSettings | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>({ model: 'fast' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getAiSettings().then(setAiSettings);
  }, []);

  // Re-read on focus: the quality screen can be opened from the summary card.
  useFocusEffect(
    useCallback(() => {
      getPhotoSettings().then(setPhotoSettings);
    }, []),
  );

  useEffect(() => {
    if (!busy) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    timer.current = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [busy]);

  const pick = async (fromCamera: boolean) => {
    setError(null);
    try {
      if (fromCamera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('카메라 권한이 필요합니다.');
          return;
        }
        const result = await ImagePicker.launchCameraAsync({ quality: 1 });
        if (!result.canceled) await addAssets(result.assets);
        return;
      }
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError('사진 접근 권한이 필요합니다.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 0,
        quality: 1,
      });
      if (!result.canceled) await addAssets(result.assets);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const addAssets = async (assets: ImagePicker.ImagePickerAsset[]) => {
    const settings = photoSettings ?? defaultPhotoSettings;
    const prepared: PreparedImage[] = [];
    for (const asset of assets) {
      prepared.push(await prepareImage(asset, settings));
    }
    setPhotos((current) => [...current, ...prepared]);
  };

  const analyze = async () => {
    setBusy(true);
    setElapsed(0);
    setError(null);
    setStage('reading');
    const stageTimer = setTimeout(() => setStage('thinking'), 1800);
    try {
      const model = aiSettings.model === 'accurate' ? health?.ollama.altModel ?? 'qwen2.5:14b-instruct' : undefined;
      const result = await api.extract({
        images: photos.length
          ? photos.map((photo) => ({ base64: photo.base64, mimeType: photo.mimeType }))
          : undefined,
        text: photos.length ? undefined : textOnly.trim(),
        hint: hint.trim() || undefined,
        model,
        retain: photoSettings?.location === 'hub',
      });
      setDraft({ result, images: photos, text: photos.length ? undefined : textOnly });
      router.push('/review');
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : '분석에 실패했습니다. 사진을 다시 찍거나 직접 입력해 주세요.';
      setError(message);
      setShowFallback(true);
    } finally {
      clearTimeout(stageTimer);
      setBusy(false);
      setStage('idle');
    }
  };

  const analyzePasted = async () => {
    if (!pasted.trim()) return;
    setBusy(true);
    setElapsed(0);
    setError(null);
    setStage('thinking');
    try {
      const model = aiSettings.model === 'accurate' ? health?.ollama.altModel ?? 'qwen2.5:14b-instruct' : undefined;
      const result = await api.extract({ text: pasted, model, hint: hint.trim() || undefined });
      setDraft({ result, images: [], text: pasted });
      router.push('/review');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '붙여넣은 내용을 정리하지 못했습니다.');
    } finally {
      setBusy(false);
      setStage('idle');
    }
  };

  const shareToExternal = async () => {
    if (!photos[0]) return;
    await Clipboard.setStringAsync(EXTERNAL_PROMPT);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(photos[0].uri, { mimeType: 'image/jpeg', dialogTitle: '외부 AI 앱으로 보내기' });
    }
  };

  const totalOriginal = photos.reduce((sum, photo) => sum + photo.originalBytes, 0);
  const totalSend = photos.reduce((sum, photo) => sum + photo.bytes, 0);

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>사진으로 추가</Text>
          <Text style={styles.sub}>안내문·문자·스크린샷을 넣으면 일정과 준비물로 정리합니다</Text>
        </View>
        <Btn label="닫기" variant="ghost" small onPress={() => router.back()} />
      </View>

      <View style={styles.pickerRow}>
        <Pressable style={styles.picker} onPress={() => pick(true)} disabled={busy}>
          <Text style={styles.pickerIcon}>📷</Text>
          <Text style={styles.pickerText}>사진 찍기</Text>
        </Pressable>
        <Pressable style={styles.picker} onPress={() => pick(false)} disabled={busy}>
          <Text style={styles.pickerIcon}>🖼</Text>
          <Text style={styles.pickerText}>앨범에서</Text>
        </Pressable>
        <Pressable style={styles.picker} onPress={() => setShowFallback(true)} disabled={busy}>
          <Text style={styles.pickerIcon}>⌨️</Text>
          <Text style={styles.pickerText}>글 붙여넣기</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push('/photo-settings')}
        accessibilityRole="button"
        accessibilityLabel="사진 크기와 화질 바꾸기"
        style={({ pressed }) => [styles.qualityRow, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.qualityRowIcon}>🖼</Text>
        <Text style={styles.qualityRowText}>사진 품질 · {qualityValue(photoSettings)}</Text>
        <Text style={styles.qualityRowHint}>바꾸기</Text>
        <Text style={styles.qualityChevron}>›</Text>
      </Pressable>

      {photos.length > 0 ? (
        <View style={{ gap: space.sm, marginTop: space.xs }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
            {photos.map((photo, index) => {
              const width = thumbWidth(photo);
              return (
                <View key={`${photo.uri}-${index}`} style={[styles.thumbWrap, { width }]}>
                  <Image
                    source={{ uri: photo.uri }}
                    style={[styles.thumb, { width, height: THUMB_HEIGHT }]}
                    resizeMode="contain"
                  />
                  <Pressable
                    style={styles.thumbRemove}
                    onPress={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                    disabled={busy}
                    hitSlop={8}
                  >
                    <Text style={styles.thumbRemoveText}>✕</Text>
                  </Pressable>
                  <Text style={styles.thumbMeta} numberOfLines={1}>
                    {photo.width}×{photo.height} · {formatBytes(photo.bytes)}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          <Card style={styles.summary}>
            <View style={{ flex: 1 }}>
              <Text style={styles.summaryTitle}>사진 {photos.length}장</Text>
              <Text style={styles.summarySub}>
                원본 {formatBytes(totalOriginal)} → 전송 {formatBytes(totalSend)}
              </Text>
            </View>
            <Badge label={photoSettings?.mode === 'preset' ? `원본의 ${photoSettings.preset}%` : '상세 설정'} tone="neutral" />
          </Card>
          <Text style={styles.thumbHint}>사진 비율은 원본 그대로 유지됩니다. 위의 ‘사진 품질’에서 크기와 화질을 바꿀 수 있습니다.</Text>
        </View>
      ) : null}

      <Field
        label="메모 (선택)"
        value={hint}
        onChangeText={setHint}
        placeholder="예: 다음 주 금요일 현장학습"
      />

      {!photos.length ? (
        <Card style={{ gap: 4 }}>
          <Text style={styles.label}>글을 직접 붙여넣어도 됩니다</Text>
          <Field
            value={textOnly}
            onChangeText={setTextOnly}
            placeholder="문자 내용이나 카톡을 붙여넣으세요"
            multiline
            style={{ minHeight: 88, textAlignVertical: 'top' }}
          />
        </Card>
      ) : null}

      <Btn
        label={busy ? (stage === 'reading' ? '사진 읽는 중…' : 'AI가 정리하는 중…') : 'AI에게 정리 맡기기'}
        onPress={analyze}
        loading={busy}
        disabled={!photos.length && !textOnly.trim()}
      />

      {busy ? (
        <Card style={styles.progress}>
          <ActivityIndicator color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.progressTitle}>
              {stage === 'reading' ? '글자를 읽고 있어요' : '일정과 준비물을 뽑고 있어요'}
            </Text>
            <Text style={styles.progressSub}>
              {elapsed}초 경과 · 보통 6~15초 걸립니다 (정확 모드는 30초 이상)
            </Text>
          </View>
        </Card>
      ) : null}

      {error ? (
        <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
          <Text style={styles.error}>{error}</Text>
        </Card>
      ) : null}

      {showFallback ? (
        <Card style={{ gap: space.md }}>
          <Text style={styles.cardTitle}>잘 읽히지 않을 때</Text>

          <View style={{ gap: 6 }}>
            <Text style={styles.step}>1. 프롬프트 복사 → 외부 AI 앱에서 사진과 함께 붙여넣기</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="프롬프트 복사" small variant="secondary" onPress={() => Clipboard.setStringAsync(EXTERNAL_PROMPT)} />
              <Btn
                label="사진 공유"
                small
                variant="secondary"
                disabled={!photos.length}
                onPress={shareToExternal}
              />
            </View>
            <Hint>외부로 보내는 순간 이 사진은 가족 허브 밖으로 나갑니다. 동의하는 경우에만 사용하세요.</Hint>
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.step}>2. 외부 AI가 준 결과를 붙여넣기</Text>
            <Field
              value={pasted}
              onChangeText={setPasted}
              placeholder="JSON이 아니어도 됩니다. 문장을 그대로 붙여넣으세요"
              multiline
              style={{ minHeight: 92, textAlignVertical: 'top' }}
            />
            <Btn label="붙여넣은 내용으로 정리" small onPress={analyzePasted} loading={busy} disabled={!pasted.trim()} />
          </View>

          <View style={{ gap: 6 }}>
            <Text style={styles.step}>3. 직접 입력</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="일정 직접 추가" small variant="secondary" onPress={() => router.replace('/schedule?new=1')} />
              <Btn label="목록 직접 추가" small variant="secondary" onPress={() => router.replace('/lists?new=1')} />
            </View>
          </View>
        </Card>
      ) : (
        <Text style={styles.fallbackLink} onPress={() => setShowFallback(true)}>
          잘 안 읽히나요? 다른 방법 보기
        </Text>
      )}

      <Hint>
        사진은 {photoSettings?.location === 'hub' ? '집의 맥에만' : '이 기기와 맥 메모리에서만'} 처리됩니다. 외부 서버로 전송되지 않습니다.
      </Hint>
    </Screen>
  );
}

const THUMB_HEIGHT = 120;

/** Keeps each thumbnail's own aspect ratio instead of cropping it into a square. */
function thumbWidth(photo: PreparedImage): number {
  const ratio = photo.height > 0 ? photo.width / photo.height : 0.75;
  return Math.round(Math.min(180, Math.max(64, ratio * THUMB_HEIGHT)));
}

function qualityValue(settings: PhotoSettings | null): string {
  if (!settings) return '기본';
  return settings.mode === 'preset' ? `${settings.preset}%` : `${settings.maxDimension}px`;
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  title: { ...font.h1, color: colors.ink },
  sub: { ...font.small, color: colors.sub, marginTop: 2, lineHeight: 19 },
  pickerRow: { flexDirection: 'row', gap: space.sm },
  picker: {
    flex: 1,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    gap: 4,
  },
  pickerIcon: { fontSize: 22 },
  pickerText: { ...font.small, color: colors.ink, fontWeight: '600' },
  thumbWrap: { gap: 4 },
  thumb: {
    height: THUMB_HEIGHT,
    borderRadius: radius.md,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.line,
  },
  thumbRemove: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.55)',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbRemoveText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  thumbMeta: { ...font.tiny, color: colors.sub },
  thumbHint: { ...font.tiny, color: colors.sub, lineHeight: 16 },
  qualityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 12,
  },
  qualityRowIcon: { fontSize: 15 },
  qualityRowText: { ...font.small, color: colors.ink, fontWeight: '600', flex: 1 },
  qualityRowHint: { ...font.tiny, color: colors.primary },
  qualityChevron: { ...font.body, color: colors.sub, marginTop: -1 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  summaryTitle: { ...font.body, color: colors.ink, fontWeight: '700' },
  summarySub: { ...font.tiny, color: colors.sub },
  label: { ...font.small, color: colors.ink, fontWeight: '700' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  progressTitle: { ...font.small, color: colors.ink, fontWeight: '700' },
  progressSub: { ...font.tiny, color: colors.sub },
  error: { ...font.small, color: colors.danger, lineHeight: 20 },
  cardTitle: { ...font.h3, color: colors.ink },
  step: { ...font.small, color: colors.ink, fontWeight: '700' },
  fallbackLink: { ...font.small, color: colors.primary, textAlign: 'center', marginTop: space.sm },
});
