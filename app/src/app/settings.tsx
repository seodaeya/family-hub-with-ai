import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { clearEverything, useSession } from '@/lib/session';
import { getAiSettings, getPhotoSettings, listEvents, listItems, saveAiSettings } from '@/lib/db';
import type { AiSettings, PhotoSettings } from '@/lib/types';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { photoStorageSummary, type PhotoStorage } from '@/lib/photo';
import { notificationsAvailable } from '@/lib/notify';
import { Badge, Btn, Card, Divider, Hint, Row, Screen, ScreenHeader, SectionTitle } from '@/components/ui';
import { BottomBar } from '@/components/bottom-bar';
import { ServerAddressSheet } from '@/components/server-address';
import { colors, font, space } from '@/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ changeServer?: string }>();
  const {
    family,
    device,
    baseUrl,
    health,
    googleHealth,
    syncing,
    syncNow,
    syncGoogleNow,
    outboxCount,
    lastSyncAt,
    disconnect,
    syncError,
  } = useSession();
  const [photo, setPhoto] = useState<PhotoSettings | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [notifOk, setNotifOk] = useState<boolean | null>(null);
  const [photoStore, setPhotoStore] = useState<PhotoStorage | null>(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  // Opened directly by the home screen's offline banner.
  const [serverOpen, setServerOpen] = useState(params.changeServer === '1');

  useFocusEffect(
    useCallback(() => {
      getPhotoSettings().then(setPhoto);
      getAiSettings().then(setAi);
      notificationsAvailable().then(setNotifOk);
      photoStorageSummary().then(setPhotoStore);
    }, []),
  );

  const exportData = async () => {
    const [events, items] = await Promise.all([listEvents(), listItems()]);
    const payload = { exportedAt: new Date().toISOString(), family, events, items };
    const path = `${FileSystem.cacheDirectory}family-hub-export-${Date.now()}.json`;
    await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2));
    await Share.share({ url: path, message: '가족 데이터 내보내기' });
  };

  const resetLocal = () => {
    Alert.alert('로컬 데이터 삭제', '이 기기에 저장된 일정·목록이 모두 삭제됩니다. 서버(맥)에는 남아 있습니다. 계속할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          await clearEverything();
          await syncNow();
          Alert.alert('삭제 완료', '서버에서 다시 받아옵니다.');
        },
      },
    ]);
  };

  const disconnectDevice = () => {
    Alert.alert('연결 해제', '이 기기에서 가족 허브 연결을 해제합니다. 다시 연결하려면 새 코드가 필요합니다.', [
      { text: '취소', style: 'cancel' },
      { text: '해제', style: 'destructive', onPress: () => disconnect() },
    ]);
  };

  return (
    <Screen footer={<BottomBar active="settings" />}>
      <ScreenHeader title="설정" sub="집 안의 맥과 연결되어 있습니다" />

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.cardTitle}>{family?.name ?? '가족'}</Text>
          <Badge label={syncError ? '연결 확인 필요' : '연결됨'} tone={syncError ? 'danger' : 'good'} />
        </Row>
        <Text style={styles.server}>{baseUrl}</Text>
        <Divider />
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.label}>이 기기</Text>
          <Text style={styles.value}>
            {device?.name} · {device?.role === 'parent' ? '보호자' : '구성원'}
          </Text>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.label}>마지막 동기화</Text>
          <Text style={styles.value}>{formatRelativeTime(lastSyncAt)}</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.label}>대기 중인 변경</Text>
          <Text style={styles.value}>{outboxCount}건</Text>
        </Row>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.label}>AI 모델</Text>
          <Text style={styles.value}>{health?.ollama.ok ? health.ollama.model : '확인 안 됨'}</Text>
        </Row>
        {health ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.label}>OCR</Text>
            <Text style={styles.value}>{health.ocr.ok ? 'Apple Vision 준비됨' : '없음'}</Text>
          </Row>
        ) : null}
        {notifOk === false ? (
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.label}>일정 알림</Text>
            <Text style={[styles.value, { color: colors.sub }]}>이 빌드에서는 꺼짐</Text>
          </Row>
        ) : null}
        <Btn label={syncing ? '동기화 중…' : '지금 동기화'} variant="secondary" loading={syncing} onPress={() => syncNow()} />
      </Card>

      <SectionTitle title="가족 · 기기" />
      <Card style={{ paddingVertical: 4 }}>
        <PressableRow label="기기 관리" hint="허용된 기기만 접속할 수 있습니다" onPress={() => router.push('/devices')} />
        <Divider />
        <PressableRow label="사진 · 저장 설정" hint={photo ? `${retentionLabel(photo.retention)} · ${qualityLabel(photo)}` : ''} onPress={() => router.push('/photo-settings')} />
        <Divider />
        <PressableRow
          label="보관한 사진 보기"
          hint={photoStore ? `이 기기 ${photoStore.count}장` : '사진 모아 보기'}
          onPress={() => router.push('/photos')}
        />
      </Card>

      <SectionTitle title="구글 캘린더" />
      <Card style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.cardTitle}>
            {googleHealth?.calendarSummary ? `캘린더 · ${googleHealth.calendarSummary}` : '우리집 AI 전용 캘린더'}
          </Text>
          <Badge
            label={
              !googleHealth?.configured
                ? '미설정'
                : googleHealth.ok
                  ? '연결됨'
                  : '연결 오류'
            }
            tone={!googleHealth?.configured ? 'neutral' : googleHealth.ok ? 'good' : 'danger'}
          />
        </Row>
        {googleHealth?.configured ? (
          <>
            {googleHealth.calendarIdMasked ? (
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={styles.label}>캘린더 ID</Text>
                <Text style={styles.value}>{googleHealth.calendarIdMasked}</Text>
              </Row>
            ) : null}
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.label}>구글 동기화</Text>
              <Text style={styles.value}>{formatRelativeTime(googleHealth.lastSyncAt ?? null)}</Text>
            </Row>
            {googleHealth.error ? (
              <Text style={{ ...font.tiny, color: colors.danger }}>{googleHealth.error}</Text>
            ) : null}
            <Btn
              label={googleBusy ? '구글 동기화 중…' : '구글 캘린더 지금 동기화'}
              small
              variant="secondary"
              loading={googleBusy}
              onPress={async () => {
                setGoogleBusy(true);
                try {
                  const res = await syncGoogleNow();
                  if (!res.ok) {
                    Alert.alert('구글 동기화 오류', res.error ?? '구글 캘린더와 동기화하지 못했습니다.');
                  } else {
                    Alert.alert(
                      '구글 동기화 완료',
                      `업로드 ${res.pushed}건 · 가져오기 ${res.pulled}건${res.conflicts ? ` · 충돌 해결 ${res.conflicts}건` : ''}`,
                    );
                  }
                } catch (err) {
                  Alert.alert('동기화 실패', (err as Error).message);
                } finally {
                  setGoogleBusy(false);
                }
              }}
            />
          </>
        ) : (
          <Hint>
            맥 허브의 키체인에 서비스 계정 키를 등록하면 전용 구글 캘린더와 양방향 동기화됩니다.{'\n'}
            맥 터미널: cd hub && npm run google:setup -- --key service-account.json --calendar &lt;캘린더ID&gt;{'\n'}
            (키체인 등록 전에도 검토·일정 화면의 &ldquo;🔍 구글 캘린더에 추가&rdquo; 버튼으로 수동 추가할 수 있습니다.)
          </Hint>
        )}
      </Card>

      <SectionTitle title="AI" />
      <Card>
        <Text style={styles.cardTitle}>정리 속도</Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Btn
            label="빠르게"
            small
            variant={ai?.model === 'fast' ? 'primary' : 'secondary'}
            onPress={() => {
              const next: AiSettings = { model: 'fast' };
              setAi(next);
              saveAiSettings(next);
            }}
          />
          <Btn
            label="정확하게 (느림)"
            small
            variant={ai?.model === 'accurate' ? 'primary' : 'secondary'}
            onPress={() => {
              const next: AiSettings = { model: 'accurate' };
              setAi(next);
              saveAiSettings(next);
            }}
          />
        </View>
        <Hint>
          빠른 모드는 gemma4(약 6~10초), 정확 모드는 qwen2.5 14B(약 30~40초)를 사용합니다. 사진과 글은 맥 밖으로 나가지 않습니다.
        </Hint>
      </Card>

      <SectionTitle title="데이터" />
      <Card style={{ paddingVertical: 4 }}>
        <PressableRow label="가족 데이터 내보내기" hint="JSON 파일로 백업" onPress={exportData} />
        <Divider />
        <PressableRow label="이 기기 데이터 다시 받기" hint="로컬 캐시 삭제 후 서버에서 복원" onPress={resetLocal} danger />
      </Card>

      <SectionTitle title="저장 위치" />
      <Card style={{ gap: space.sm }}>
        <Text style={styles.cardTitle}>이 기기 (안드로이드폰)</Text>
        <Text style={styles.storeLine}>일정·목록 DB · family-hub.db</Text>
        <Text style={styles.storeLine}>
          사진 · {photoStore ? `${photoStore.count}장 · ${formatBytes(photoStore.bytes)}` : '확인 중'}
        </Text>
        <Divider />
        <Text style={styles.cardTitle}>맥 (가족 허브)</Text>
        <Text style={styles.storeLine}>DB · hub/data/hub.db</Text>
        <Text style={styles.storeLine}>사진 · hub/data/photos/</Text>
        <Hint>
          앱은 이 기기에 먼저 저장하고, 맥이 켜져 있으면 같은 내용을 맞춰 둡니다. 사진 원본은 보관 설정을 켠 경우에만 남습니다.
        </Hint>
      </Card>

      <SectionTitle title="연결" />
      <Card style={{ gap: space.md }}>
        <PressableRow
          label="서버 주소 변경"
          hint={baseUrl ? `현재 · ${baseUrl}` : '맥의 IP가 바뀌었을 때'}
          onPress={() => setServerOpen(true)}
        />
        <Divider />
        <Btn label="연결 해제" variant="danger" onPress={disconnectDevice} />
      </Card>

      <Text style={styles.footer}>
        우리집 AI v0.1 · 로컬 우선{'\n'}
        사진과 글은 집 안의 맥에서만 처리됩니다.
      </Text>

      {serverOpen ? <ServerAddressSheet onClose={() => setServerOpen(false)} /> : null}
    </Screen>
  );
}

function PressableRow({
  label,
  hint,
  onPress,
  danger,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.pressableRow, pressed && { opacity: 0.55 }]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function retentionLabel(value: PhotoSettings['retention']): string {
  return { delete: '분석 후 삭제', '7d': '7일 보관', '30d': '30일 보관', keep: '계속 보관' }[value];
}

function qualityLabel(settings: PhotoSettings): string {
  return settings.mode === 'preset' ? `원본의 ${settings.preset}%` : `${settings.maxDimension}px · ${Math.round(settings.jpegQuality * 100)}%`;
}

const styles = StyleSheet.create({
  cardTitle: { ...font.h3, color: colors.ink },
  server: { ...font.tiny, color: colors.sub },
  storeLine: { ...font.small, color: colors.sub },
  label: { ...font.small, color: colors.sub },
  value: { ...font.small, color: colors.ink, fontWeight: '600' },
  pressableRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  rowLabel: { ...font.body, color: colors.ink },
  rowHint: { ...font.tiny, color: colors.sub },
  chevron: { ...font.h2, color: colors.sub },
  footer: { ...font.tiny, color: colors.sub, textAlign: 'center', lineHeight: 17, marginTop: space.md },
});
