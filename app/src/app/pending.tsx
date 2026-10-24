import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSession } from '@/lib/session';
import { Badge, Btn, Card, Hint, Screen } from '@/components/ui';
import { colors, font, space } from '@/theme';

export default function PendingScreen() {
  const { device, family, refresh, disconnect } = useSession();
  const router = useRouter();

  return (
    <Screen scroll={false} style={{ flex: 1, justifyContent: 'center', gap: space.lg }}>
      <View style={styles.iconWrap}>
        <Text style={styles.icon}>⏳</Text>
      </View>
      <Text style={styles.title}>보호자 승인을 기다리는 중</Text>
      <Text style={styles.body}>
        {family?.name ?? '가족'}의 보호자 기기에서 이 기기를 승인하면{'\n'}자동으로 시작됩니다.
      </Text>

      <Card>
        <View style={styles.row}>
          <Text style={styles.label}>기기</Text>
          <Text style={styles.value}>{device?.name ?? '알 수 없음'}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>상태</Text>
          <Badge label="승인 대기" tone="pending" />
        </View>
      </Card>

      <Hint>부모 기기 → 설정 → 기기 관리 에서 승인할 수 있습니다.</Hint>

      <Btn label="다시 확인" onPress={() => refresh()} />
      <Btn label="연결 해제" variant="ghost" onPress={() => disconnect().then(() => router.replace('/pair'))} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconWrap: { alignItems: 'center' },
  icon: { fontSize: 56 },
  title: { ...font.h1, fontSize: 24, color: colors.ink, textAlign: 'center' },
  body: { ...font.body, color: colors.sub, textAlign: 'center', lineHeight: 22 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  label: { ...font.small, color: colors.sub },
  value: { ...font.body, color: colors.ink },
});
