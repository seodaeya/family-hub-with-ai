import { useCallback, useState } from 'react';
import { Alert, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@/lib/session';
import type { DeviceInfo } from '@/lib/types';
import { formatRelativeTime } from '@/lib/format';
import { Badge, Btn, Card, Empty, Hint, Screen, SectionTitle } from '@/components/ui';
import { colors, font, radius, space } from '@/theme';

export default function DevicesScreen() {
  const { device: current, device: me, refreshDevices, approveDevice, revokeDevice, createInvite } = useSession();
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [invite, setInvite] = useState<{ code: string; expiresAt: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDevices(await refreshDevices());
    } catch {
      // offline
    }
  }, [refreshDevices]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const isParent = me?.role === 'parent';

  const makeInvite = async () => {
    setBusy(true);
    try {
      const result = await createInvite();
      setInvite(result);
      await Clipboard.setStringAsync(result.code);
    } catch (error) {
      Alert.alert('초대 코드 발급 실패', (error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const approve = async (item: DeviceInfo) => {
    try {
      await approveDevice(item.id);
      await load();
    } catch (error) {
      Alert.alert('승인 실패', (error as Error).message);
    }
  };

  const revoke = (item: DeviceInfo) => {
    Alert.alert(
      '기기 허용 해제',
      `${item.name} 기기는 즉시 가족 데이터에 접근할 수 없게 됩니다.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '해제',
          style: 'destructive',
          onPress: async () => {
            await revokeDevice(item.id);
            await load();
          },
        },
      ],
    );
  };

  const pending = devices.filter((item) => item.status === 'pending');
  const approved = devices.filter((item) => item.status === 'approved');
  const revoked = devices.filter((item) => item.status === 'revoked');

  return (
    <Screen>
      <View>
        <Text style={styles.title}>기기 관리</Text>
        <Text style={styles.sub}>승인된 기기만 가족 데이터를 읽고 쓸 수 있습니다</Text>
      </View>

      {!isParent ? (
        <Card style={{ backgroundColor: colors.warnSoft, borderColor: colors.warnSoft }}>
          <Text style={{ ...font.small, color: colors.warn, lineHeight: 19 }}>
            보호자 기기에서만 기기를 승인하거나 해제할 수 있습니다.
          </Text>
        </Card>
      ) : null}

      {pending.length > 0 ? (
        <>
          <SectionTitle title={`승인 대기 ${pending.length}`} />
          <Card style={{ gap: space.md }}>
            {pending.map((item) => (
              <View key={item.id} style={styles.deviceRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.deviceName}>{item.name}</Text>
                  <Text style={styles.deviceMeta}>
                    {item.platform ?? '기기'} · {formatRelativeTime(item.createdAt)}
                  </Text>
                </View>
                {isParent ? (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Btn label="승인" small onPress={() => approve(item)} />
                    <Btn label="거절" small variant="danger" onPress={() => revoke(item)} />
                  </View>
                ) : (
                  <Badge label="대기" tone="pending" />
                )}
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle title="허용된 기기" />
      {approved.length === 0 ? (
        <Empty title="허용된 기기가 없습니다" />
      ) : (
        <Card style={{ gap: space.md }}>
          {approved.map((item) => (
            <View key={item.id} style={styles.deviceRow}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Text style={styles.deviceName}>{item.name}</Text>
                  {item.id === current?.id ? <Badge label="이 기기" tone="primary" /> : null}
                  {item.role === 'parent' ? <Badge label="보호자" tone="neutral" /> : null}
                </View>
                <Text style={styles.deviceMeta}>최근 접속 {formatRelativeTime(item.lastSeenAt)}</Text>
              </View>
              {isParent && item.id !== current?.id ? (
                <Pressable hitSlop={8} onPress={() => revoke(item)}>
                  <Text style={styles.remove}>해제</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </Card>
      )}

      {isParent ? (
        <>
          <SectionTitle title="새 기기 추가" />
          <Card style={{ gap: space.md }}>
            {invite ? (
              <View style={styles.inviteBox}>
                <Text style={styles.inviteLabel}>초대 코드</Text>
                <Text style={styles.inviteCode}>{invite.code}</Text>
                <Text style={styles.inviteHint}>10분 안에 새 기기에서 입력하세요</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                  <Btn
                    label="복사"
                    small
                    variant="secondary"
                    onPress={() => Clipboard.setStringAsync(invite.code)}
                  />
                  <Btn
                    label="공유"
                    small
                    variant="secondary"
                    onPress={() => Share.share({ message: `우리집 AI 초대 코드: ${invite.code}` })}
                  />
                  <Btn label="새로 발급" small variant="ghost" onPress={makeInvite} loading={busy} />
                </View>
              </View>
            ) : (
              <>
                <Btn label="초대 코드 만들기" onPress={makeInvite} loading={busy} />
                <Hint>
                  새 기기에서 앱 → 서버 주소 입력 → 이 코드를 넣으면 ‘승인 대기’ 상태가 됩니다. 아래 목록에서 승인해야 사용할 수 있습니다.
                </Hint>
              </>
            )}
          </Card>
        </>
      ) : null}

      {revoked.length > 0 ? (
        <>
          <SectionTitle title="해제된 기기" />
          <Card style={{ gap: 8 }}>
            {revoked.map((item) => (
              <View key={item.id} style={styles.deviceRow}>
                <Text style={[styles.deviceName, { color: colors.sub }]}>{item.name}</Text>
                <Badge label="해제됨" tone="danger" />
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Hint>
        기기를 잃어버렸다면 즉시 해제하세요. 해제된 기기의 토큰은 서버에서 바로 거부됩니다.
      </Hint>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...font.h1, color: colors.ink },
  sub: { ...font.small, color: colors.sub, marginTop: 2 },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  deviceName: { ...font.body, color: colors.ink, fontWeight: '700' },
  deviceMeta: { ...font.tiny, color: colors.sub, marginTop: 2 },
  remove: { ...font.small, color: colors.danger },
  inviteBox: {
    backgroundColor: colors.primarySoft,
    borderRadius: radius.md,
    padding: space.lg,
    alignItems: 'center',
    gap: 2,
  },
  inviteLabel: { ...font.tiny, color: colors.sub },
  inviteCode: { fontSize: 32, fontWeight: '800', letterSpacing: 6, color: colors.primary },
  inviteHint: { ...font.tiny, color: colors.sub },
});
