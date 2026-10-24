import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { useRouter } from 'expo-router';
import { getPhotoSettings, savePhotoSettings } from '@/lib/db';
import type { PhotoSettings } from '@/lib/types';
import { Badge, Btn, Card, Chip, Hint, Screen, ScreenHeader, SectionTitle } from '@/components/ui';
import { colors, font, radius, space } from '@/theme';

const PRESETS: { value: 50 | 75 | 100; title: string; caption: string; recommended?: boolean }[] = [
  { value: 50, title: '50%', caption: '가볍게 · 빠른 전송' },
  { value: 75, title: '75%', caption: '권장 · OCR 충분', recommended: true },
  { value: 100, title: '100%', caption: '원본 해상도 유지' },
];

export default function PhotoSettingsScreen() {
  const router = useRouter();
  const [settings, setSettings] = useState<PhotoSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getPhotoSettings().then(setSettings);
  }, []);

  const update = (patch: Partial<PhotoSettings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    savePhotoSettings(next).then(() => {
      setSaved(true);
      setTimeout(() => setSaved(false), 1200);
    });
  };

  if (!settings) return <Screen />;

  return (
    <Screen>
      <ScreenHeader
        title="사진 · 저장 설정"
        sub="사진 크기와 보관 기간을 정합니다"
        onBack={() => router.back()}
      />

      <Hint>
        사진의 가로·세로 비율은 원본 그대로 유지됩니다. 여기서 바꾸는 것은 <Text style={styles.strong}>크기(해상도)</Text>와{' '}
        <Text style={styles.strong}>화질</Text>입니다.
      </Hint>

      <SectionTitle title="전송 품질" action={saved ? <Badge label="저장됨" tone="good" /> : undefined} />
      <View style={styles.segment}>
        <Btn
          label="간단 선택"
          small
          variant={settings.mode === 'preset' ? 'primary' : 'secondary'}
          onPress={() => update({ mode: 'preset' })}
          style={{ flex: 1 }}
        />
        <Btn
          label="상세 조절"
          small
          variant={settings.mode === 'custom' ? 'primary' : 'secondary'}
          onPress={() => update({ mode: 'custom' })}
          style={{ flex: 1 }}
        />
      </View>

      {settings.mode === 'preset' ? (
        <View style={{ gap: space.sm }}>
          {PRESETS.map((preset) => {
            const active = settings.preset === preset.value;
            return (
              <Pressable
                key={preset.value}
                onPress={() => update({ preset: preset.value })}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                style={({ pressed }) => [pressed && { opacity: 0.85 }]}
              >
                <Card
                  style={[
                    styles.presetCard,
                    active ? { borderColor: colors.primary, backgroundColor: colors.primarySoft } : undefined,
                  ]}
                >
                  <View style={styles.presetRow}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.presetTitle, active && { color: colors.primary }]}>{preset.title}</Text>
                        {preset.recommended ? <Badge label="권장" tone="primary" /> : null}
                      </View>
                      <Text style={styles.presetCaption}>{preset.caption}</Text>
                      <Text style={styles.estimate}>{estimateText(preset.value)}</Text>
                    </View>
                    <View style={[styles.radio, active && styles.radioOn]}>
                      {active ? <Text style={styles.radioMark}>✓</Text> : null}
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Card style={{ gap: space.md }}>
          <View>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>최대 가로 크기</Text>
              <Text style={styles.sliderValue}>{settings.maxDimension}px</Text>
            </View>
            <Slider
              minimumValue={1024}
              maximumValue={4096}
              step={128}
              value={settings.maxDimension}
              onValueChange={(value) => setSettings({ ...settings, maxDimension: Math.round(value) })}
              onSlidingComplete={(value) => update({ maxDimension: Math.round(value) })}
              minimumTrackTintColor={colors.primary}
              maximumTrackTintColor={colors.line}
              thumbTintColor={colors.primary}
            />
            <Text style={styles.ticks}>1024 · 2048 · 3072 · 4096</Text>
          </View>

          <View>
            <View style={styles.sliderHeader}>
              <Text style={styles.sliderLabel}>화질 (JPEG)</Text>
              <Text style={styles.sliderValue}>{Math.round(settings.jpegQuality * 100)}%</Text>
            </View>
            <Slider
              minimumValue={0.5}
              maximumValue={0.95}
              step={0.05}
              value={settings.jpegQuality}
              onValueChange={(value) => setSettings({ ...settings, jpegQuality: Math.round(value * 100) / 100 })}
              onSlidingComplete={(value) => update({ jpegQuality: Math.round(value * 100) / 100 })}
              minimumTrackTintColor={colors.accent}
              maximumTrackTintColor={colors.line}
              thumbTintColor={colors.accent}
            />
            <Text style={styles.ticks}>50% · 70% · 85% · 95%</Text>
          </View>

          <View style={styles.preview}>
            <Text style={styles.previewTitle}>이 설정이면</Text>
            <Text style={styles.previewText}>
              3000×4000 사진 → 약 {Math.round(settings.maxDimension / 10) / 100}배 크기 ·{' '}
              {estimateBytes(settings.maxDimension, settings.jpegQuality)}
            </Text>
          </View>
        </Card>
      )}

      <Hint>
        글자를 읽는 데는 2048px면 충분합니다. 너무 줄이면 작은 글씨를 놓칠 수 있고, 원본은 전송·저장 용량이 커집니다.
      </Hint>

      <SectionTitle title="보관" />
      <Card style={{ gap: space.md }}>
        <Text style={styles.label}>보관 기간</Text>
        <View style={styles.wrap}>
          {(
            [
              ['delete', '분석 후 삭제'],
              ['7d', '7일'],
              ['30d', '30일'],
              ['keep', '계속 보관'],
            ] as const
          ).map(([value, label]) => (
            <Chip key={value} label={label} selected={settings.retention === value} onPress={() => update({ retention: value })} />
          ))}
        </View>
        <Text style={styles.label}>저장 위치</Text>
        <View style={styles.wrap}>
          <Chip label="이 기기에만" selected={settings.location === 'device'} onPress={() => update({ location: 'device' })} />
          <Chip
            label="맥 허브에 보관"
            selected={settings.location === 'hub'}
            onPress={() =>
              update({
                location: 'hub',
                ...(settings.retention === 'delete' ? { retention: '30d' } : null),
              })
            }
          />
        </View>
        <Hint>
          기본값은 ‘분석 후 삭제’입니다. 보관을 켜면 원본이 지정한 위치에 남아 나중에 다시 볼 수 있습니다.
        </Hint>
        <View style={styles.pathBox}>
          <Text style={styles.pathTitle}>실제 파일 위치</Text>
          <Text style={styles.pathLine}>이 기기 · 앱 전용 저장소의 photos/ 폴더</Text>
          <Text style={styles.pathLine}>맥 · family-hub-with-ai/hub/data/photos/</Text>
        </View>
        <Btn label="보관한 사진 보기" variant="secondary" small onPress={() => router.push('/photos')} />
      </Card>
    </Screen>
  );
}

function estimateText(preset: 50 | 75 | 100): string {
  if (preset === 100) return '2MB 사진 → 약 2MB 전송';
  return `2MB 사진 → 약 ${preset === 50 ? '0.5MB' : '1.1MB'} 전송`;
}

function estimateBytes(maxDimension: number, quality: number): string {
  const pixels = maxDimension * maxDimension * 0.75;
  const bytes = pixels * quality * 0.08;
  if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.round(bytes / 1024)}KB`;
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', gap: space.sm },
  strong: { color: colors.ink, fontWeight: '700' },
  presetCard: { gap: 4 },
  presetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: colors.primary, backgroundColor: colors.primary },
  radioMark: { color: '#fff', fontSize: 14, fontWeight: '800' },
  presetTitle: { ...font.h2, color: colors.ink },
  presetCaption: { ...font.tiny, color: colors.sub },
  estimate: { ...font.tiny, color: colors.sub },
  sliderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sliderLabel: { ...font.small, color: colors.ink, fontWeight: '700' },
  sliderValue: { ...font.small, color: colors.primary, fontWeight: '800' },
  ticks: { ...font.tiny, color: colors.sub },
  preview: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: space.md, gap: 2 },
  previewTitle: { ...font.tiny, color: colors.sub },
  previewText: { ...font.small, color: colors.ink },
  label: { ...font.small, color: colors.sub },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pathBox: { backgroundColor: colors.cardAlt, borderRadius: radius.md, padding: space.md, gap: 2 },
  pathTitle: { ...font.tiny, color: colors.sub },
  pathLine: { ...font.small, color: colors.ink },
});
