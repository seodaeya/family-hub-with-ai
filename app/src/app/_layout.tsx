import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SessionProvider, useSession } from '@/lib/session';
import { colors, font, radius, space } from '@/theme';

/**
 * The native splash screen is intentionally left on its default auto-hide
 * behaviour. Holding it manually meant that any failure during startup left the
 * splash covering the app forever ("우리집 AI" only, nothing responds).
 */

function Root() {
  const { status } = useSession();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;
    const current = segments[0];
    if (status === 'unpaired' && current !== 'pair') router.replace('/pair');
    else if (status === 'pending' && current !== 'pending') router.replace('/pending');
    else if (status === 'ready' && (current === 'pair' || current === 'pending')) router.replace('/');
  }, [status, segments, router]);

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
        <Text style={styles.loadingText}>앱을 준비하는 중…</Text>
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <SessionProvider>
      <Root />
    </SessionProvider>
  );
}

/** expo-router renders this instead of a blank/crashed screen. */
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={styles.errorScreen}>
      <ScrollView contentContainerStyle={styles.errorScroll}>
        <Text style={styles.errorTitle}>앱을 시작하지 못했습니다</Text>
        <Text style={styles.errorBody}>
          아래 내용을 그대로 알려주시면 바로 고치겠습니다.
        </Text>
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error?.message ?? String(error)}</Text>
        </View>
        <Pressable style={styles.errorButton} onPress={() => retry()}>
          <Text style={styles.errorButtonText}>다시 시도</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    backgroundColor: colors.bg,
  },
  loadingText: { ...font.small, color: colors.sub },
  errorScreen: { flex: 1, backgroundColor: colors.bg },
  errorScroll: { padding: space.xl, gap: space.md, paddingTop: 80 },
  errorTitle: { ...font.h2, color: colors.ink },
  errorBody: { ...font.small, color: colors.sub, lineHeight: 20 },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.md,
    padding: space.md,
  },
  errorText: { ...font.tiny, color: colors.danger, lineHeight: 18 },
  errorButton: {
    marginTop: space.sm,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
  },
  errorButtonText: { ...font.body, color: '#fff', fontWeight: '700' },
});
