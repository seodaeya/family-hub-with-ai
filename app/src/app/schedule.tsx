import { useCallback, useState } from 'react';
import {
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { deleteEvent, listEvents, saveEvent } from '@/lib/db';
import { rescheduleNotifications } from '@/lib/notify';
import { useSession } from '@/lib/session';
import type { EventRow } from '@/lib/types';
import { addDays, dateKey, formatDate, formatTime, fromLocalInput, startOfDay, toLocalInput } from '@/lib/format';
import { Badge, Btn, Card, Empty, Field, Hint, Screen } from '@/components/ui';
import { BottomBar } from '@/components/bottom-bar';
import { colors, font, space } from '@/theme';

type Section = { title: string; subtitle: string; data: EventRow[] };

export default function ScheduleScreen() {
  const params = useLocalSearchParams<{ new?: string }>();
  const { syncNow } = useSession();
  const [sections, setSections] = useState<Section[]>([]);
  const [editing, setEditing] = useState<EventRow | 'new' | null>(params.new ? 'new' : null);

  const load = useCallback(async () => {
    const now = new Date();
    const events = await listEvents(addDays(now, -14).toISOString(), addDays(now, 180).toISOString());
    setSections(groupEvents(events));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const save = async (draft: EventDraft) => {
    await saveEvent({
      id: draft.id,
      title: draft.title.trim() || '새 일정',
      startsAt: draft.allDay ? fromLocalInput(`${draft.date}T00:00`) : fromLocalInput(`${draft.date} ${draft.time}`),
      allDay: draft.allDay ? 1 : 0,
      location: draft.location || null,
      memo: draft.memo || null,
    });
    setEditing(null);
    await load();
    await rescheduleNotifications(await listEvents(new Date().toISOString()));
    syncNow().catch(() => {});
  };

  const remove = async (id: string) => {
    await deleteEvent(id);
    setEditing(null);
    await load();
    syncNow().catch(() => {});
  };

  const draft = editing && editing !== 'new' ? editing : null;

  return (
    <Screen padded={false} scroll={false} style={{ flex: 1 }}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>일정</Text>
          <Text style={styles.sub}>앞으로 6개월</Text>
        </View>
        <Btn label="+ 일정" small onPress={() => setEditing('new')} />
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 140, gap: 4 }}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <Empty title="일정이 없습니다" hint="안내문 사진을 추가하거나 직접 일정을 만들어 보세요." action={<Btn label="일정 추가" small onPress={() => setEditing('new')} />} />
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{section.subtitle}</Text>
            <Text style={styles.sectionDate}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable onPress={() => setEditing(item)}>
            <Card style={styles.eventCard}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.eventTitle}>{item.title}</Text>
                <View style={styles.metaRow}>
                  {item.allDay ? <Badge label="종일" tone="neutral" /> : <Text style={styles.time}>{formatTime(item.startsAt)}</Text>}
                  {item.location ? <Text style={styles.meta}>📍 {item.location}</Text> : null}
                </View>
                {item.memo ? <Text style={styles.memo}>{item.memo}</Text> : null}
              </View>
            </Card>
          </Pressable>
        )}
      />

      <EventEditor
        key={editing === 'new' ? 'new' : draft?.id ?? 'closed'}
        visible={Boolean(editing)}
        initial={draft}
        defaultDate={dateKey(addDays(new Date(), 1).toISOString())}
        onClose={() => setEditing(null)}
        onSave={save}
        onDelete={draft ? () => remove(draft.id) : undefined}
      />

      <BottomBar active="schedule" />
    </Screen>
  );
}

type EventDraft = {
  id?: string;
  title: string;
  date: string;
  time: string;
  allDay: boolean;
  location: string;
  memo: string;
};

function EventEditor({
  visible,
  initial,
  defaultDate,
  onClose,
  onSave,
  onDelete,
}: {
  visible: boolean;
  initial: EventRow | null;
  defaultDate: string;
  onClose: () => void;
  onSave: (draft: EventDraft) => void;
  onDelete?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [date, setDate] = useState(
    initial?.startsAt ? toLocalInput(initial.startsAt).slice(0, 10) : defaultDate,
  );
  const [time, setTime] = useState(
    initial?.startsAt && !initial.allDay ? toLocalInput(initial.startsAt).slice(11, 16) : '09:00',
  );
  const [allDay, setAllDay] = useState(Boolean(initial?.allDay));
  const [location, setLocation] = useState(initial?.location ?? '');
  const [memo, setMemo] = useState(initial?.memo ?? '');

  const quickDate = (offset: number) => setDate(dateKey(addDays(new Date(), offset).toISOString()));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{initial ? '일정 수정' : '새 일정'}</Text>
          <Btn label="닫기" variant="ghost" small onPress={onClose} />
        </View>
        <View style={{ gap: space.md }}>
          <Field label="제목" value={title} onChangeText={setTitle} placeholder="예: 현장학습" autoFocus={!initial} style={{ fontSize: 17 }} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Field label="날짜 (YYYY-MM-DD)" value={date} onChangeText={setDate} placeholder="2026-10-30" />
            </View>
            {!allDay ? (
              <View style={{ width: 110 }}>
                <Field label="시간" value={time} onChangeText={setTime} placeholder="08:40" />
              </View>
            ) : null}
          </View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <Btn label="오늘" variant="secondary" small onPress={() => quickDate(0)} />
            <Btn label="내일" variant="secondary" small onPress={() => quickDate(1)} />
            <Btn label="모레" variant="secondary" small onPress={() => quickDate(2)} />
            <Btn label="다음 주" variant="secondary" small onPress={() => quickDate(7)} />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>종일 일정</Text>
            <Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: colors.primary, false: colors.line }} />
          </View>
          <Field label="장소" value={location} onChangeText={setLocation} placeholder="선택" />
          <Field label="메모" value={memo} onChangeText={setMemo} placeholder="선택" multiline style={{ minHeight: 72, textAlignVertical: 'top' }} />
          <Hint>저장하면 가족 기기와 동기화되고 알림이 예약됩니다.</Hint>
          <Btn label={initial ? '저장' : '일정 추가'} onPress={() => onSave({ id: initial?.id, title, date, time, allDay, location, memo })} disabled={!title.trim()} />
          {onDelete ? <Btn label="삭제" variant="danger" onPress={onDelete} /> : null}
        </View>
      </View>
    </Modal>
  );
}

function groupEvents(events: EventRow[]): Section[] {
  const map = new Map<string, EventRow[]>();
  for (const event of events) {
    const key = dateKey(event.startsAt);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(event);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, rows]) => ({
      title: key === 'none' ? '날짜 미정' : formatDate(rows[0].startsAt),
      subtitle: key === 'none' ? '' : startOfDay(new Date(rows[0].startsAt!)).getFullYear().toString(),
      data: rows.sort((a, b) => (a.startsAt ?? '').localeCompare(b.startsAt ?? '')),
    }));
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  title: { ...font.h1, color: colors.ink },
  sub: { ...font.small, color: colors.sub },
  sectionHeader: { paddingTop: space.lg, paddingBottom: 6 },
  sectionTitle: { ...font.h3, color: colors.ink },
  sectionDate: { ...font.tiny, color: colors.sub },
  eventCard: { paddingVertical: space.md, paddingHorizontal: space.lg },
  eventTitle: { ...font.h3, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  time: { ...font.small, color: colors.primary, fontWeight: '700' },
  meta: { ...font.small, color: colors.sub },
  memo: { ...font.small, color: colors.sub, marginTop: 4 },
  modal: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.lg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { ...font.h2, color: colors.ink },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchLabel: { ...font.body, color: colors.ink },
});
