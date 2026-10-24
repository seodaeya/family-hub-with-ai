import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSession } from '@/lib/session';
import { getPhotoSettings, listEvents, listItems, toggleItem } from '@/lib/db';
import type { EventRow, ItemRow, PhotoSettings } from '@/lib/types';
import { addDays, endOfDay, formatDate, formatRelativeTime, formatTime, relativeDay, startOfDay } from '@/lib/format';
import { Badge, Card, Empty, Screen, SectionTitle } from '@/components/ui';
import { BottomBar } from '@/components/bottom-bar';
import { colors, font, radius, space } from '@/theme';

export default function HomeScreen() {
  const { family, syncing, syncError, outboxCount, lastSyncAt, syncNow } = useSession();
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [photoSettings, setPhotoSettings] = useState<PhotoSettings | null>(null);

  const load = useCallback(async () => {
    const now = new Date();
    const [eventsNext, allItems, settings] = await Promise.all([
      listEvents(startOfDay(now).toISOString(), addDays(endOfDay(now), 14).toISOString()),
      listItems(),
      getPhotoSettings(),
    ]);
    setEvents(eventsNext);
    setItems(allItems);
    setPhotoSettings(settings);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const todayKey = new Date().toDateString();
  const todayEvents = events.filter((event) => event.startsAt && new Date(event.startsAt).toDateString() === todayKey);
  const tomorrow = addDays(new Date(), 1).toDateString();
  const tomorrowEvents = events.filter(
    (event) => event.startsAt && new Date(event.startsAt).toDateString() === tomorrow,
  );
  const shopping = items.filter((item) => item.listType === 'shopping' && !item.done).slice(0, 6);
  const tasks = items.filter((item) => item.listType !== 'shopping' && !item.done).slice(0, 4);
  const openShopping = items.filter((item) => item.listType === 'shopping' && !item.done).length;

  const syncState = syncing ? '동기화 중' : outboxCount > 0 ? `대기 ${outboxCount}건` : syncError ? '오프라인' : '최신';
  const syncTone = syncing ? 'primary' : outboxCount > 0 ? 'warn' : syncError ? 'danger' : 'good';

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Text style={styles.family}>{family?.name ?? '우리 가족'}</Text>
          <Text style={styles.title}>오늘의 우리 집</Text>
          <Text style={styles.date}>{formatDate(new Date().toISOString())}</Text>
        </View>
        <Pressable onPress={() => syncNow()} style={styles.syncPill}>
          <Badge label={syncState} tone={syncTone as never} />
        </Pressable>
      </View>

      {syncError ? (
        <Card style={{ backgroundColor: colors.warnSoft, borderColor: colors.warnSoft }}>
          <Text style={styles.syncError}>{syncError}</Text>
        </Card>
      ) : null}

      <View style={styles.quickRow}>
        <Pressable style={[styles.quick, { backgroundColor: colors.primary }]} onPress={() => router.push('/capture')}>
          <Text style={styles.quickIcon}>📷</Text>
          <Text style={[styles.quickText, { color: '#fff' }]}>사진으로 추가</Text>
        </Pressable>
        <Pressable style={styles.quick} onPress={() => router.push('/schedule?new=1')}>
          <Text style={styles.quickIcon}>🗓</Text>
          <Text style={styles.quickText}>일정</Text>
        </Pressable>
        <Pressable style={styles.quick} onPress={() => router.push('/lists?new=1')}>
          <Text style={styles.quickIcon}>🛒</Text>
          <Text style={styles.quickText}>장보기</Text>
        </Pressable>
      </View>

      <Pressable
        onPress={() => router.push('/photo-settings')}
        accessibilityRole="button"
        accessibilityLabel="사진 크기와 화질 설정 열기"
        style={({ pressed }) => [styles.photoRow, pressed && { opacity: 0.65 }]}
      >
        <Text style={styles.photoLabel}>사진 품질 · 크기</Text>
        <Text style={styles.photoValue}>
          {photoSettings
            ? photoSettings.mode === 'preset'
              ? `원본의 ${photoSettings.preset}%`
              : `${photoSettings.maxDimension}px · ${Math.round(photoSettings.jpegQuality * 100)}%`
            : '기본값'}{' '}
          ›
        </Text>
      </Pressable>

      <View style={styles.statsRow}>
        <Stat label="오늘 일정" value={todayEvents.length} tone={colors.primary} />
        <Stat label="장보기" value={openShopping} tone={colors.accent} />
        <Stat label="할 일" value={tasks.length} tone={colors.good} />
      </View>

      <SectionTitle title="오늘 · 내일" action={<Text style={styles.link} onPress={() => router.replace('/schedule')}>전체</Text>} />
      {todayEvents.length + tomorrowEvents.length === 0 ? (
        <Empty title="예정된 일정이 없어요" hint="안내문 사진을 추가하면 AI가 일정을 정리해 줍니다." />
      ) : (
        <View style={{ gap: space.sm }}>
          {todayEvents.map((event) => (
            <EventCard key={event.id} event={event} highlight />
          ))}
          {tomorrowEvents.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </View>
      )}

      <SectionTitle
        title="장보기"
        action={
          <Text style={styles.link} onPress={() => router.replace('/lists')}>
            전체 {openShopping}
          </Text>
        }
      />
      {shopping.length === 0 ? (
        <Empty title="살 것이 없습니다" hint="문자나 사진에서 필요한 물건을 자동으로 모아둡니다." />
      ) : (
        <Card style={{ paddingVertical: space.sm }}>
          {shopping.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <View style={styles.line} /> : null}
              <Pressable style={styles.checkRow} onPress={() => toggleItem(item).then(load)}>
                <View style={styles.checkbox} />
                <Text style={styles.itemTitle}>{item.title}</Text>
                {item.qty ? <Text style={styles.qty}>{item.qty}</Text> : null}
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <SectionTitle title="준비물 · 할 일" action={<Text style={styles.link} onPress={() => router.replace('/lists')}>전체</Text>} />
      {tasks.length === 0 ? (
        <Empty title="남은 할 일이 없습니다" />
      ) : (
        <Card style={{ paddingVertical: space.sm }}>
          {tasks.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <View style={styles.line} /> : null}
              <Pressable style={styles.checkRow} onPress={() => toggleItem(item).then(load)}>
                <View style={styles.checkbox} />
                <Text style={styles.itemTitle}>{item.title}</Text>
                <Text style={styles.listKind}>{item.listType === 'supply' ? '준비물' : '할 일'}</Text>
              </Pressable>
            </View>
          ))}
        </Card>
      )}

      <Text style={styles.footer}>
        마지막 동기화 {formatRelativeTime(lastSyncAt)}
        {outboxCount > 0 ? ` · 전송 대기 ${outboxCount}건` : ''}
      </Text>

      <BottomBar active="home" />
    </Screen>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function EventCard({ event, highlight }: { event: EventRow; highlight?: boolean }) {
  return (
    <Card style={[styles.eventCard, highlight ? { borderColor: colors.primary, borderWidth: 1.5 } : undefined]}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.eventTop}>
          <Text style={styles.eventDate}>{relativeDay(event.startsAt)}</Text>
          <Text style={styles.eventTime}>{event.allDay ? '종일' : formatTime(event.startsAt)}</Text>
        </View>
        <Text style={styles.eventTitle} numberOfLines={2}>
          {event.title}
        </Text>
        {event.location ? <Text style={styles.eventMeta}>📍 {event.location}</Text> : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  family: { ...font.small, color: colors.sub },
  title: { ...font.h1, color: colors.ink, marginTop: 2 },
  date: { ...font.small, color: colors.sub, marginTop: 2 },
  syncPill: { paddingTop: 4 },
  syncError: { ...font.small, color: colors.warn, lineHeight: 19 },
  quickRow: { flexDirection: 'row', gap: space.sm },
  quick: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    paddingVertical: 14,
    alignItems: 'center',
    gap: 4,
  },
  quickIcon: { fontSize: 20 },
  quickText: { ...font.small, color: colors.ink, fontWeight: '700' },
  statsRow: { flexDirection: 'row', gap: space.sm },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
  },
  photoLabel: { ...font.small, color: colors.ink, fontWeight: '600' },
  photoValue: { ...font.small, color: colors.primary, fontWeight: '700' },
  stat: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    alignItems: 'center',
  },
  statValue: { fontSize: 22, fontWeight: '800' },
  statLabel: { ...font.tiny, color: colors.sub },
  link: { ...font.small, color: colors.primary },
  eventCard: { flexDirection: 'row', paddingVertical: space.md },
  eventTop: { flexDirection: 'row', gap: 8, alignItems: 'baseline' },
  eventDate: { ...font.tiny, color: colors.primary, fontWeight: '700' },
  eventTime: { ...font.tiny, color: colors.sub },
  eventTitle: { ...font.h3, color: colors.ink },
  eventMeta: { ...font.small, color: colors.sub },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 11, paddingHorizontal: 4 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  itemTitle: { flex: 1, ...font.body, color: colors.ink },
  qty: { ...font.tiny, color: colors.sub },
  listKind: { ...font.tiny, color: colors.sub },
  line: { height: 1, backgroundColor: colors.line, marginHorizontal: 4 },
  footer: { ...font.tiny, color: colors.sub, textAlign: 'center', marginTop: space.md },
});
