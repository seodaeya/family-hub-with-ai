import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, font, radius, space } from '@/theme';

const TABS = [
  { key: 'home', label: '홈', icon: '⌂', href: '/' },
  { key: 'schedule', label: '일정', icon: '▤', href: '/schedule' },
  { key: 'lists', label: '목록', icon: '☑', href: '/lists' },
  { key: 'settings', label: '설정', icon: '⚙', href: '/settings' },
] as const;

export function BottomBar({ active }: { active: (typeof TABS)[number]['key'] }) {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        {TABS.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (!isActive) router.replace(tab.href as any);
              }}
              style={styles.tab}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
            >
              <Text style={[styles.icon, isActive && { color: colors.primary }]}>{tab.icon}</Text>
              <Text style={[styles.label, isActive && { color: colors.primary, fontWeight: '700' }]}>{tab.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: 24,
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 },
  icon: { fontSize: 19, color: colors.sub },
  label: { ...font.tiny, color: colors.sub },
});
