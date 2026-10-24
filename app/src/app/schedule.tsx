import { useCallback, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { deleteEvent, listEvents, listItems, saveEvent, saveItem, setItemEvent, toggleItem } from '@/lib/db';
import { rescheduleNotifications } from '@/lib/notify';
import { useSession } from '@/lib/session';
import type { EventRow, ItemRow, ListType } from '@/lib/types';
import { addDays, dateKey, formatDate, formatTime, fromLocalInput, startOfDay, toLocalInput } from '@/lib/format';
import { DateField } from '@/components/date-picker';
import { Badge, Btn, Card, Chip, Empty, Field, Hint, Screen } from '@/components/ui';
import { BottomBar } from '@/components/bottom-bar';
import { colors, font, radius, space } from '@/theme';

type Section = { title: string; subtitle: string; data: EventRow[] };

const TYPE_LABEL: Record<ListType, string> = {
  shopping: '장보기',
  supply: '준비물',
  todo: '할 일',
};

export default function ScheduleScreen() {
  const params = useLocalSearchParams<{ new?: string; eventId?: string }>();
  const { syncNow } = useSession();
  const [sections, setSections] = useState<Section[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [editing, setEditing] = useState<EventRow | 'new' | null>(params.new ? 'new' : null);
  const openedEventParam = useRef<string | null>(null);

  const load = useCallback(async () => {
    const now = new Date();
    const [events, allItems] = await Promise.all([
      listEvents(addDays(now, -14).toISOString(), addDays(now, 180).toISOString()),
      listItems(),
    ]);
    setSections(groupEvents(events));
    setItems(allItems);
    if (params.eventId && openedEventParam.current !== params.eventId) {
      const target = events.find((ev) => ev.id === params.eventId);
      if (target) {
        openedEventParam.current = params.eventId;
        setEditing(target);
      }
    }
  }, [params.eventId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const save = async (draft: EventDraft) => {
    const saved = await saveEvent({
      id: draft.id,
      title: draft.title.trim() || '새 일정',
      startsAt: draft.allDay ? fromLocalInput(`${draft.date}T00:00`) : fromLocalInput(`${draft.date} ${draft.time}`),
      allDay: draft.allDay ? 1 : 0,
      location: draft.location || null,
      memo: draft.memo || null,
    });

    const initialLinkedIds = new Set(
      draft.id ? items.filter((it) => it.eventId === draft.id).map((it) => it.id) : [],
    );
    const nextLinkedIds = new Set(draft.linkedItemIds);

    for (const prevId of initialLinkedIds) {
      if (!nextLinkedIds.has(prevId)) {
        await setItemEvent(prevId, null);
      }
    }
    for (const nextId of nextLinkedIds) {
      if (!initialLinkedIds.has(nextId)) {
        const targetItem = items.find((it) => it.id === nextId);
        await saveItem({
          id: nextId,
          title: targetItem?.title ?? '',
          listType: targetItem?.listType ?? 'todo',
          eventId: saved.id,
          dueAt: targetItem?.dueAt ?? (draft.date ? fromLocalInput(`${draft.date}T00:00`) : null),
        });
      }
    }

    for (const newItem of draft.newItems) {
      if (!newItem.title.trim()) continue;
      await saveItem({
        title: newItem.title.trim(),
        listType: newItem.listType,
        dueAt: newItem.dueDate ? fromLocalInput(`${newItem.dueDate}T00:00`) : draft.date ? fromLocalInput(`${draft.date}T00:00`) : null,
        eventId: saved.id,
      });
    }

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
    <Screen padded={false} scroll={false} style={{ flex: 1 }} footer={<BottomBar active="schedule" />}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>일정</Text>
          <Text style={styles.sub}>앞으로 6개월 · 눌러서 상세/연결 관리</Text>
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
        renderItem={({ item }) => {
          const linked = items.filter((it) => it.eventId === item.id);
          const doneCount = linked.filter((it) => it.done).length;
          return (
            <Pressable onPress={() => setEditing(item)}>
              <Card style={styles.eventCard}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.titleRow}>
                    <Text style={[styles.eventTitle, { flex: 1 }]}>{item.title}</Text>
                    {linked.length > 0 ? (
                      <Badge
                        label={`준비물·할 일 ${doneCount}/${linked.length}`}
                        tone={doneCount === linked.length ? 'good' : 'primary'}
                      />
                    ) : null}
                  </View>
                  <View style={styles.metaRow}>
                    {item.allDay ? <Badge label="종일" tone="neutral" /> : <Text style={styles.time}>{formatTime(item.startsAt)}</Text>}
                    {item.location ? <Text style={styles.meta}>📍 {item.location}</Text> : null}
                  </View>
                  {item.memo ? <Text style={styles.memo}>{item.memo}</Text> : null}
                  {linked.length > 0 ? (
                    <View style={styles.linkedList}>
                      {linked.map((linkedItem) => (
                        <Pressable
                          key={linkedItem.id}
                          onPress={(e) => {
                            e.stopPropagation();
                            toggleItem(linkedItem).then(load).then(() => syncNow().catch(() => {}));
                          }}
                          style={[styles.linkedPill, linkedItem.done ? styles.linkedPillDone : undefined]}
                        >
                          <Text style={[styles.linkedCheck, linkedItem.done ? { color: colors.good } : undefined]}>
                            {linkedItem.done ? '✓' : '○'}
                          </Text>
                          <Text style={styles.linkedKind}>{TYPE_LABEL[linkedItem.listType]}</Text>
                          <Text
                            style={[styles.linkedTitle, linkedItem.done ? styles.linkedTitleDone : undefined]}
                            numberOfLines={1}
                          >
                            {linkedItem.title}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              </Card>
            </Pressable>
          );
        }}
      />

      <EventEditor
        key={editing === 'new' ? 'new' : draft?.id ?? 'closed'}
        visible={Boolean(editing)}
        initial={draft}
        items={items}
        defaultDate={dateKey(addDays(new Date(), 1).toISOString())}
        onClose={() => setEditing(null)}
        onSave={save}
        onToggleItem={async (item) => {
          await toggleItem(item);
          await load();
          syncNow().catch(() => {});
        }}
        onDelete={draft ? () => remove(draft.id) : undefined}
      />
    </Screen>
  );
}

type PendingNewItem = {
  title: string;
  listType: ListType;
  dueDate: string;
};

type EventDraft = {
  id?: string;
  title: string;
  date: string;
  time: string;
  allDay: boolean;
  location: string;
  memo: string;
  linkedItemIds: string[];
  newItems: PendingNewItem[];
};

function EventEditor({
  visible,
  initial,
  items,
  defaultDate,
  onClose,
  onSave,
  onToggleItem,
  onDelete,
}: {
  visible: boolean;
  initial: EventRow | null;
  items: ItemRow[];
  defaultDate: string;
  onClose: () => void;
  onSave: (draft: EventDraft) => void;
  onToggleItem: (item: ItemRow) => void;
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
  const [linkedItemIds, setLinkedItemIds] = useState<string[]>(() =>
    initial ? items.filter((it) => it.eventId === initial.id).map((it) => it.id) : [],
  );
  const [newItems, setNewItems] = useState<PendingNewItem[]>([]);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemType, setNewItemType] = useState<ListType>('supply');
  const [newItemDueDate, setNewItemDueDate] = useState('');
  const [showExistingPicker, setShowExistingPicker] = useState(false);

  const toggleLinkId = (id: string) => {
    setLinkedItemIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const addNewInlineItem = () => {
    const trimmed = newItemTitle.trim();
    if (!trimmed) return;
    setNewItems((prev) => [
      ...prev,
      { title: trimmed, listType: newItemType, dueDate: newItemDueDate || date },
    ]);
    setNewItemTitle('');
    setNewItemDueDate('');
  };

  const removeNewInlineItem = (idx: number) => {
    setNewItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const linkedExisting = items.filter((it) => linkedItemIds.includes(it.id));
  const candidateItems = items.filter(
    (it) => !linkedItemIds.includes(it.id) && !it.done && (it.listType === 'supply' || it.listType === 'todo'),
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>{initial ? '일정 상세 · 수정' : '새 일정'}</Text>
          <Btn label="닫기" variant="ghost" small onPress={onClose} />
        </View>
        <ScrollView
          contentContainerStyle={{ gap: space.md, paddingBottom: 40 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field
            label="제목"
            value={title}
            onChangeText={setTitle}
            placeholder="예: 현장학습"
            autoFocus={!initial}
            style={{ fontSize: 17 }}
          />
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <DateField
                label="날짜 (눌러서 달력 열기)"
                value={date}
                onChange={setDate}
                placeholder="날짜 선택"
                mode="inline"
              />
            </View>
            {!allDay ? (
              <View style={{ width: 104 }}>
                <Field label="시간" value={time} onChangeText={setTime} placeholder="08:40" />
              </View>
            ) : null}
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.switchLabel}>종일 일정</Text>
            <Switch value={allDay} onValueChange={setAllDay} trackColor={{ true: colors.primary, false: colors.line }} />
          </View>
          <Field label="장소" value={location} onChangeText={setLocation} placeholder="선택" />
          <Field
            label="메모"
            value={memo}
            onChangeText={setMemo}
            placeholder="선택"
            multiline
            style={{ minHeight: 68, textAlignVertical: 'top' }}
          />

          <Card style={{ gap: space.sm, backgroundColor: colors.cardAlt }}>
            <View style={styles.linkSectionHeader}>
              <Text style={styles.linkSectionTitle}>
                연결된 준비물 · 할 일 ({linkedExisting.length + newItems.length})
              </Text>
              {candidateItems.length > 0 ? (
                <Pressable onPress={() => setShowExistingPicker((prev) => !prev)}>
                  <Text style={styles.linkToggleText}>
                    {showExistingPicker ? '기존 목록 닫기' : `+ 기존 항목 연결 (${candidateItems.length})`}
                  </Text>
                </Pressable>
              ) : null}
            </View>

            {linkedExisting.length === 0 && newItems.length === 0 ? (
              <Text style={styles.emptyLinkText}>
                연결된 준비물이나 할 일이 없습니다. 아래에서 바로 추가하거나 기존 항목을 연결해 보세요.
              </Text>
            ) : (
              <View style={{ gap: 6 }}>
                {linkedExisting.map((item) => (
                  <View key={item.id} style={styles.linkedItemRow}>
                    <Pressable
                      onPress={() => onToggleItem(item)}
                      style={[styles.itemCheck, item.done ? styles.itemCheckDone : undefined]}
                    >
                      {item.done ? <Text style={styles.itemCheckMark}>✓</Text> : null}
                    </Pressable>
                    <Badge label={TYPE_LABEL[item.listType]} tone={item.listType === 'supply' ? 'primary' : 'neutral'} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemRowTitle, item.done ? styles.itemRowTitleDone : undefined]}>
                        {item.title}
                      </Text>
                      {item.dueAt ? <Text style={styles.itemRowDue}>{formatDate(item.dueAt)}까지</Text> : null}
                    </View>
                    <Pressable hitSlop={8} onPress={() => toggleLinkId(item.id)} style={styles.unlinkBtn}>
                      <Text style={styles.unlinkText}>연결 해제</Text>
                    </Pressable>
                  </View>
                ))}
                {newItems.map((item, idx) => (
                  <View key={`new-${idx}`} style={styles.linkedItemRow}>
                    <Badge label={`새 ${TYPE_LABEL[item.listType]}`} tone="good" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemRowTitle}>{item.title}</Text>
                      {item.dueDate ? <Text style={styles.itemRowDue}>마감: {item.dueDate}</Text> : null}
                    </View>
                    <Pressable hitSlop={8} onPress={() => removeNewInlineItem(idx)} style={styles.unlinkBtn}>
                      <Text style={styles.unlinkText}>취소</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            {showExistingPicker && candidateItems.length > 0 ? (
              <View style={styles.candidateBox}>
                <Text style={styles.candidateHelp}>눌러서 이 일정에 연결하세요</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  {candidateItems.map((item) => (
                    <Chip
                      key={item.id}
                      label={`+ [${TYPE_LABEL[item.listType]}] ${item.title}`}
                      onPress={() => toggleLinkId(item.id)}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={styles.newInlineBox}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Chip
                  label="준비물"
                  selected={newItemType === 'supply'}
                  onPress={() => setNewItemType('supply')}
                />
                <Chip
                  label="할 일"
                  selected={newItemType === 'todo'}
                  onPress={() => setNewItemType('todo')}
                />
                <View style={{ flex: 1 }}>
                  <DateField
                    value={newItemDueDate}
                    onChange={setNewItemDueDate}
                    placeholder={`마감일 (${date || '일정일'})`}
                    allowClear
                    compact
                    mode="inline"
                  />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <View style={{ flex: 1 }}>
                  <Field
                    value={newItemTitle}
                    onChangeText={setNewItemTitle}
                    placeholder={newItemType === 'supply' ? '새 준비물 입력 (예: 도시락)' : '새 할 일 입력 (예: 동의서 제출)'}
                    onSubmitEditing={addNewInlineItem}
                    returnKeyType="done"
                  />
                </View>
                <Btn label="추가" small variant="secondary" onPress={addNewInlineItem} disabled={!newItemTitle.trim()} />
              </View>
            </View>
          </Card>

          <Hint>저장하면 가족 기기와 동기화되고 연결된 준비물·할 일도 함께 반영됩니다.</Hint>
          <Btn
            label={initial ? '저장' : '일정 추가'}
            onPress={() => {
              const pending = newItemTitle.trim()
                ? [...newItems, { title: newItemTitle.trim(), listType: newItemType, dueDate: newItemDueDate || date }]
                : newItems;
              onSave({
                id: initial?.id,
                title,
                date,
                time,
                allDay,
                location,
                memo,
                linkedItemIds,
                newItems: pending,
              });
            }}
            disabled={!title.trim()}
          />
          {onDelete ? <Btn label="일정 삭제" variant="danger" onPress={onDelete} /> : null}
        </ScrollView>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  eventTitle: { ...font.h3, color: colors.ink },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  time: { ...font.small, color: colors.primary, fontWeight: '700' },
  meta: { ...font.small, color: colors.sub },
  memo: { ...font.small, color: colors.sub, marginTop: 4 },
  linkedList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  linkedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.line,
  },
  linkedPillDone: {
    opacity: 0.6,
    backgroundColor: colors.bg,
  },
  linkedCheck: { ...font.tiny, color: colors.primary, fontWeight: '800' },
  linkedKind: { ...font.tiny, color: colors.sub },
  linkedTitle: { ...font.tiny, color: colors.ink, fontWeight: '700', maxWidth: 150 },
  linkedTitleDone: { textDecorationLine: 'line-through', color: colors.sub },
  modal: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { ...font.h2, color: colors.ink },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  switchLabel: { ...font.body, color: colors.ink },
  linkSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  linkSectionTitle: { ...font.small, color: colors.ink, fontWeight: '700' },
  linkToggleText: { ...font.tiny, color: colors.primary, fontWeight: '700' },
  emptyLinkText: { ...font.tiny, color: colors.sub, lineHeight: 17 },
  linkedItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.card,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
  },
  itemCheck: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCheckDone: {
    backgroundColor: colors.good,
    borderColor: colors.good,
  },
  itemCheckMark: { color: '#fff', fontSize: 11, fontWeight: '800' },
  itemRowTitle: { ...font.small, color: colors.ink, fontWeight: '600' },
  itemRowTitleDone: { textDecorationLine: 'line-through', color: colors.sub },
  itemRowDue: { ...font.tiny, color: colors.sub },
  unlinkBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
  },
  unlinkText: { ...font.tiny, color: colors.danger, fontWeight: '700' },
  candidateBox: {
    backgroundColor: colors.card,
    padding: space.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 6,
  },
  candidateHelp: { ...font.tiny, color: colors.sub },
  newInlineBox: {
    gap: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
});
