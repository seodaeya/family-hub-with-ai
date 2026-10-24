import { useCallback, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import { useSession } from '@/lib/session';
import { getAiSettings, getPhotoSettings, listEvents, listItems, saveAiSettings } from '@/lib/db';
import { clearEverything } from '@/lib/session';
import type { AiSettings, PhotoSettings } from '@/lib/types';
import { formatRelativeTime } from '@/lib/format';
import { notificationsAvailable } from '@/lib/notify';
import { Badge, Btn, Card, Divider, Hint, Row, Screen, SectionTitle } from '@/components/ui';
import { BottomBar } from '@/components/bottom-bar';
import { colors, font, space } from '@/theme';

export default function SettingsScreen() {
  const router = useRouter();
  const { family, device, baseUrl, health, syncing, syncNow, outboxCount, lastSyncAt, disconnect, syncError } = useSession();
  const [photo, setPhoto] = useState<PhotoSettings | null>(null);
  const [ai, setAi] = useState<AiSettings | null>(null);
  const [notifOk, setNotifOk] = useState<boolean | null>(null);

  useFocusEffect(
    useCallback(() => {
      getPhotoSettings().then(setPhoto);
      getAiSettings().then(setAi);
      notificationsAvailable().then(setNotifOk);
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
    <Screen>
      <View>
        <Text style={styles.title}>설정</Text>
        <Text style={styles.sub}>집 안의 맥과 연결되어 있습니다</Text>
      </View>

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
            <Text style={[styles.value, { color: colors.sub }]}>이 환경에서는 미지원</Text>
          </Row>
        ) : null}
        <Btn label={syncing ? '동기화 중…' : '지금 동기화'} variant="secondary" loading={syncing} onPress={() => syncNow()} />
      </Card>

      <SectionTitle title="가족 · 기기" />
      <Card style={{ paddingVertical: 4 }}>
        <PressableRow label="기기 관리" hint="허용된 기기만 접속할 수 있습니다" onPress={() => router.push('/devices')} />
        <Divider />
        <PressableRow label="사진 · 저장 설정" hint={photo ? `${retentionLabel(photo.retention)} · ${qualityLabel(photo)}` : ''} onPress={() => router.push('/photo-settings')} />
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

      <SectionTitle title="연결" />
      <Card style={{ gap: space.md }}>
        <Btn label="연결 해제" variant="danger" onPress={disconnectDevice} />
      </Card>

      <Text style={styles.footer}>
        우리집 AI v0.1 · 로컬 우선{'\n'}
        사진과 글은 집 안의 맥에서만 처리됩니다.
      </Text>

      <BottomBar active="settings" />
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
    <Text
      onPress={onPress}
      style={[styles.pressableRow, danger && { color: colors.danger }]}
      suppressHighlighting
    >
      <Text>
        <Text style={{ ...font.body, color: danger ? colors.danger : colors.ink }}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{`\n${hint}`}</Text> : null}
      </Text>
    </Text>
  );
}

function retentionLabel(value: PhotoSettings['retention']): string {
  return { delete: '분석 후 삭제', '7d': '7일 보관', '30d': '30일 보관', keep: '계속 보관' }[value];
}

function qualityLabel(settings: PhotoSettings): string {
  return settings.mode === 'preset' ? `원본의 ${settings.preset}%` : `${settings.maxDimension}px · ${Math.round(settings.jpegQuality * 100)}%`;
}

const styles = StyleSheet.create({
  title: { ...font.h1, color: colors.ink },
  sub: { ...font.small, color: colors.sub, marginTop: 2 },
  cardTitle: { ...font.h3, color: colors.ink },
  server: { ...font.tiny, color: colors.sub },
  label: { ...font.small, color: colors.sub },
  value: { ...font.small, color: colors.ink, fontWeight: '600' },
  pressableRow: { paddingVertical: space.md },
  rowHint: { ...font.tiny, color: colors.sub },
  footer: { ...font.tiny, color: colors.sub, textAlign: 'center', lineHeight: 17, marginTop: space.md },
});
