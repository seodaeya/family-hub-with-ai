import { useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/lib/session';
import { ApiError, healthAt } from '@/lib/api';
import { suggestedHubUrl } from '@/lib/hub-url';
import { Btn, Card, Field, Hint } from '@/components/ui';
import { colors, font, space } from '@/theme';

/**
 * Lets the user point this device at the same hub on a new address.
 *
 * The Mac's LAN IP changes whenever the router hands out a different lease
 * (or the Mac switches between Wi-Fi and Ethernet). The device token stays
 * valid in that case, so re-pairing should not be necessary — only the URL.
 */
export function ServerAddressSheet({ onClose }: { onClose: () => void }) {
  const { baseUrl, changeServer } = useSession();
  const [url, setUrl] = useState(baseUrl ?? '');
  const [detected] = useState(() => suggestedHubUrl());
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [probe, setProbe] = useState<string | null>(null);

  const edit = (value: string) => {
    setUrl(value);
    setError(null);
    setProbe(null);
  };

  const check = async () => {
    setChecking(true);
    setError(null);
    setProbe(null);
    try {
      const health = await healthAt(url);
      setProbe(
        `응답 정상 · AI ${health.ollama.ok ? health.ollama.model : '모델 없음'} · ${
          health.paired ? '가족 등록됨' : '가족 없음'
        }`,
      );
    } catch {
      setError('이 주소에서 허브를 찾지 못했습니다. IP·포트와 같은 Wi-Fi인지 확인해 주세요.');
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await changeServer(url);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError(
          '허브는 찾았지만 이 기기를 모릅니다. 주소가 맞다면 설정에서 연결을 해제하고 새 코드로 다시 연결해 주세요.',
        );
      } else {
        setError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.header}>
          <Text style={styles.title}>서버 주소 변경</Text>
          <Btn label="닫기" variant="ghost" small onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ gap: space.md, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Card style={{ gap: space.sm }}>
            <Text style={styles.label}>현재 주소</Text>
            <Text style={styles.current}>{baseUrl ?? '없음'}</Text>
            <Field
              label="새 주소"
              value={url}
              onChangeText={edit}
              placeholder="http://192.168.0.10:4317"
              keyboardType="url"
              autoFocus
            />
            <View style={styles.row}>
              <Btn
                label="주소 자동 입력"
                small
                variant="ghost"
                onPress={() => edit(detected)}
                disabled={!detected}
                style={{ flex: 1 }}
              />
              <Btn
                label={checking ? '확인 중…' : '상태 확인'}
                small
                variant="secondary"
                loading={checking}
                onPress={check}
                style={{ flex: 1 }}
              />
            </View>
            {probe ? <Text style={styles.probe}>{probe}</Text> : null}
            <Hint>
              맥의 IP만 바뀐 경우라면 연결 코드 없이 주소만 고치면 됩니다.{'\n'}
              `주소 자동 입력`은 지금 개발 서버(Metro)가 알려준 맥 주소를 채웁니다.
            </Hint>
          </Card>

          {error ? (
            <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
              <Text style={styles.error}>{error}</Text>
            </Card>
          ) : null}

          <Btn
            label={saving ? '저장 중…' : '이 주소로 변경'}
            onPress={save}
            loading={saving}
            disabled={!url.trim()}
          />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modal: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...font.h2, color: colors.ink },
  label: { ...font.small, color: colors.sub },
  current: { ...font.small, color: colors.ink, fontWeight: '600' },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  probe: { ...font.small, color: colors.good, fontWeight: '600', lineHeight: 19 },
  error: { ...font.small, color: colors.danger, lineHeight: 20 },
});
