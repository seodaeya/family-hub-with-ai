import { useCallback, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { deleteItem, listEvents, listItems, saveItem, toggleItem } from '@/lib/db';
import { useSession } from '@/lib/session';
import type { EventRow, ItemRow, ListType } from '@/lib/types';
import { addDays, formatDate, fromLocalInput, toLocalInput } from '@/lib/format';
import { DateField } from '@/components/date-picker';
import { EventLinkField, type EventOption } from '@/components/event-picker';
import { Btn, Card, Chip, Empty, Field, Hint, Screen } from '@/components/ui';
import { BottomBar } from '@/components/bottom-bar';
import { colors, font, radius, space } from '@/theme';

const TABS: { key: ListType; label: string; placeholder: string }[] = [
  { key: 'shopping', label: '장보기', placeholder: '예: 우유 2개' },
  { key: 'supply', label: '준비물', placeholder: '예: 도시락' },
  { key: 'todo', label: '할 일', placeholder: '예: 가정통신문 서명' },
];

export default function ListsScreen() {
  const router = useRouter();
  const { syncNow } = useSession();
  const params = useLocalSearchParams<{ new?: string; tab?: string; itemId?: string }>();
  const [tab, setTab] = useState<ListType>(
    params.tab === 'supply' || params.tab === 'todo' || params.tab === 'shopping' ? params.tab : 'shopping',
  );
  const [items, setItems] = useState<ItemRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [linkedEventId, setLinkedEventId] = useState<string | null>(null);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const openedItemParam = useRef<string | null>(null);

  const load = useCallback(async () => {
    const now = new Date();
    const [allItems, allEvents] = await Promise.all([
      listItems(),
      listEvents(addDays(now, -30).toISOString(), addDays(now, 180).toISOString()),
    ]);
    setItems(allItems);
    setEvents(allEvents);
    if (params.itemId && openedItemParam.current !== params.itemId) {
      const target = allItems.find((it) => it.id === params.itemId);
      if (target) {
        openedItemParam.current = params.itemId;
        setTab(target.listType);
        setEditing(target);
      }
    }
  }, [params.itemId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const eventMap = useMemo(() => {
    const map = new Map<string, EventRow>();
    for (const ev of events) map.set(ev.id, ev);
    return map;
  }, [events]);

  const eventOptions = useMemo<EventOption[]>(
    () =>
      events.map((ev) => ({
        id: ev.id,
        title: ev.title,
        dateLabel: ev.startsAt ? formatDate(ev.startsAt) : '날짜 미정',
        dateYmd: ev.startsAt ? toLocalInput(ev.startsAt).slice(0, 10) : undefined,
      })),
    [events],
  );

  const add = async () => {
    const title = text.trim();
    if (!title) return;
    await saveItem({
      title,
      listType: tab,
      dueAt: dueDate ? fromLocalInput(`${dueDate}T00:00`) : null,
      eventId: linkedEventId,
    });
    setText('');
    setDueDate('');
    setLinkedEventId(null);
    await load();
    syncNow().catch(() => {});
  };

  const saveEdit = async (draft: {
    id: string;
    title: string;
    listType: ListType;
    qty: string;
    dueDate: string;
    eventId: string | null;
  }) => {
    await saveItem({
      id: draft.id,
      title: draft.title.trim() || '항목',
      listType: draft.listType,
      qty: draft.qty.trim() || null,
      dueAt: draft.dueDate ? fromLocalInput(`${draft.dueDate}T00:00`) : null,
      eventId: draft.eventId,
    });
    setEditing(null);
    await load();
    syncNow().catch(() => {});
  };

  const removeItem = async (id: string) => {
    await deleteItem(id);
    setEditing(null);
    await load();
    syncNow().catch(() => {});
  };

  const filtered = items.filter((item) => item.listType === tab);
  const open = filtered.filter((item) => !item.done);
  const done = filtered.filter((item) => item.done);
  const placeholder = TABS.find((entry) => entry.key === tab)!.placeholder;

  return (
    <Screen footer={<BottomBar active="lists" />}>
      <View>
        <Text style={styles.title}>목록</Text>
        <Text style={styles.sub}>가족이 함께 보고 체크합니다 · 항목을 눌러 마감일·일정 연결 수정</Text>
      </View>

      <View style={styles.tabs}>
        {TABS.map((entry) => (
          <Pressable
            key={entry.key}
            onPress={() => setTab(entry.key)}
            style={[styles.tab, tab === entry.key && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === entry.key && styles.tabTextActive]}>{entry.label}</Text>
            <Text style={[styles.tabCount, tab === entry.key && { color: colors.primary }]}>
              {items.filter((item) => item.listType === entry.key && !item.done).length}
            </Text>
          </Pressable>
        ))}
      </View>

      <Card style={{ gap: space.sm, padding: space.md }}>
        <View style={styles.addRow}>
          <View style={{ flex: 1 }}>
            <Field
              value={text}
              onChangeText={setText}
              placeholder={placeholder}
              onSubmitEditing={add}
              returnKeyType="done"
              autoFocus={Boolean(params.new)}
            />
          </View>
          <Btn label="추가" onPress={add} disabled={!text.trim()} />
        </View>
        <View style={styles.addOptionsRow}>
          <DateField
            value={dueDate}
            onChange={setDueDate}
            placeholder="마감일 (선택)"
            title="마감일 선택"
            allowClear
            compact
            style={{ flex: 1 }}
          />
          <EventLinkField
            value={linkedEventId}
            options={eventOptions}
            onChange={(nextId, opt) => {
              setLinkedEventId(nextId);
              if (!dueDate && opt?.dateYmd) setDueDate(opt.dateYmd);
            }}
            placeholder="일정 연결 (선택)"
            compact
            style={{ flex: 1 }}
          />
        </View>
      </Card>

      {open.length === 0 && done.length === 0 ? (
        <Empty
          title="목록이 비어 있어요"
          hint="문자나 안내문 사진을 추가하면 필요한 물건과 할 일을 AI가 뽑아줍니다."
        />
      ) : null}

      {open.length > 0 ? (
        <Card style={{ paddingVertical: space.sm }}>
          {open.map((item, index) => {
            const linkedEv = item.eventId ? eventMap.get(item.eventId) : undefined;
            return (
              <View key={item.id}>
                {index > 0 ? <View style={styles.line} /> : null}
                <View style={styles.row}>
                  <Pressable
                    hitSlop={8}
                    style={styles.checkboxHit}
                    onPress={() => toggleItem(item).then(load).then(() => syncNow().catch(() => {}))}
                  >
                    <View style={styles.checkbox} />
                  </Pressable>
                  <Pressable style={styles.bodyPress} onPress={() => setEditing(item)}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <View style={styles.metaWrap}>
                      {item.dueAt ? <Text style={styles.due}>📅 {formatDate(item.dueAt)}까지</Text> : null}
                      {linkedEv ? (
                        <Pressable
                          onPress={(e) => {
                            e.stopPropagation();
                            router.push(`/schedule?eventId=${linkedEv.id}`);
                          }}
                          style={styles.eventPill}
                        >
                          <Text style={styles.eventPillText} numberOfLines={1}>
                            🔗 {linkedEv.title}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  </Pressable>
                  {item.qty ? <Text style={styles.qty}>{item.qty}</Text> : null}
                  <Pressable hitSlop={10} onPress={() => removeItem(item.id)}>
                    <Text style={styles.remove}>✕</Text>
                  </Pressable>
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

      {done.length > 0 ? (
        <>
          <Text style={styles.doneTitle}>완료 {done.length}</Text>
          <Card style={{ paddingVertical: space.sm, backgroundColor: colors.cardAlt }}>
            {done.map((item) => {
              const linkedEv = item.eventId ? eventMap.get(item.eventId) : undefined;
              return (
                <View key={item.id} style={styles.row}>
                  <Pressable
                    hitSlop={8}
                    style={styles.checkboxHit}
                    onPress={() => toggleItem(item).then(load).then(() => syncNow().catch(() => {}))}
                  >
                    <View style={[styles.checkbox, styles.checkboxDone]}>
                      <Text style={styles.checkMark}>✓</Text>
                    </View>
                  </Pressable>
                  <Pressable style={styles.bodyPress} onPress={() => setEditing(item)}>
                    <Text style={[styles.itemTitle, styles.itemDone]}>{item.title}</Text>
                    {linkedEv ? (
                      <Text style={styles.doneEventText} numberOfLines={1}>
                        🔗 {linkedEv.title}
                      </Text>
                    ) : null}
                  </Pressable>
                  <Pressable hitSlop={10} onPress={() => removeItem(item.id)}>
                    <Text style={styles.remove}>✕</Text>
                  </Pressable>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <ItemEditor
        key={editing?.id ?? 'closed'}
        visible={Boolean(editing)}
        initial={editing}
        eventOptions={eventOptions}
        onClose={() => setEditing(null)}
        onSave={saveEdit}
        onDelete={editing ? () => removeItem(editing.id) : undefined}
        onOpenEvent={(eventId) => {
          setEditing(null);
          router.push(`/schedule?eventId=${eventId}`);
        }}
      />

      <Text style={styles.footer}>체크하거나 연결한 내용은 가족 기기와 동기화됩니다.</Text>
    </Screen>
  );
}

function ItemEditor({
  visible,
  initial,
  eventOptions,
  onClose,
  onSave,
  onDelete,
  onOpenEvent,
}: {
  visible: boolean;
  initial: ItemRow | null;
  eventOptions: EventOption[];
  onClose: () => void;
  onSave: (draft: {
    id: string;
    title: string;
    listType: ListType;
    qty: string;
    dueDate: string;
    eventId: string | null;
  }) => void;
  onDelete?: () => void;
  onOpenEvent: (eventId: string) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [listType, setListType] = useState<ListType>(initial?.listType ?? 'todo');
  const [qty, setQty] = useState(initial?.qty ?? '');
  const [dueDate, setDueDate] = useState(
    initial?.dueAt ? toLocalInput(initial.dueAt).slice(0, 10) : '',
  );
  const [eventId, setEventId] = useState<string | null>(initial?.eventId ?? null);

  if (!initial) return null;

  const selectedEvent = eventId ? eventOptions.find((opt) => opt.id === eventId) : undefined;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>항목 상세 · 수정</Text>
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
            placeholder="항목 이름"
            style={{ fontSize: 17 }}
          />

          <View style={{ gap: 6 }}>
            <Text style={styles.fieldLabel}>분류</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {TABS.map((entry) => (
                <Chip
                  key={entry.key}
                  label={entry.label}
                  selected={listType === entry.key}
                  onPress={() => setListType(entry.key)}
                />
              ))}
            </View>
          </View>

          <Field
            label="수량 (선택)"
            value={qty}
            onChangeText={setQty}
            placeholder="예: 2개, 1팩"
          />

          <DateField
            label="마감일 (눌러서 달력 열기)"
            value={dueDate}
            onChange={setDueDate}
            placeholder="마감일 없음 (선택)"
            allowClear
            mode="inline"
          />

          <EventLinkField
            label="연결된 일정 (선택 · 해제 가능)"
            value={eventId}
            options={eventOptions}
            onChange={(nextId, opt) => {
              setEventId(nextId);
              if (!dueDate && opt?.dateYmd) setDueDate(opt.dateYmd);
            }}
            placeholder="일정 연결 안 함"
            mode="inline"
          />

          {selectedEvent ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {selectedEvent.dateYmd && dueDate !== selectedEvent.dateYmd ? (
                <Btn
                  label="마감일을 일정 날짜로 맞추기"
                  small
                  variant="secondary"
                  onPress={() => setDueDate(selectedEvent.dateYmd!)}
                  style={{ flex: 1 }}
                />
              ) : null}
              <Btn
                label="연결된 일정 보기 ›"
                small
                variant="secondary"
                onPress={() => onOpenEvent(selectedEvent.id)}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}

          <Hint>준비물과 할 일을 일정에 연결하면 일정 화면과 홈 화면에서도 함께 확인할 수 있습니다.</Hint>

          <Btn
            label="저장"
            onPress={() =>
              onSave({
                id: initial.id,
                title,
                listType,
                qty,
                dueDate,
                eventId,
              })
            }
            disabled={!title.trim()}
          />
          {onDelete ? <Btn label="항목 삭제" variant="danger" onPress={onDelete} /> : null}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  title: { ...font.h1, color: colors.ink },
  sub: { ...font.small, color: colors.sub, marginTop: 2 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.cardAlt,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm, flexDirection: 'row', justifyContent: 'center', gap: 6 },
  tabActive: { backgroundColor: colors.card, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 },
  tabText: { ...font.small, color: colors.sub },
  tabTextActive: { color: colors.ink, fontWeight: '700' },
  tabCount: { ...font.tiny, color: colors.sub },
  addRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-end' },
  addOptionsRow: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 8 },
  checkboxHit: { paddingVertical: 4, paddingRight: 4 },
  bodyPress: { flex: 1, gap: 3, paddingVertical: 2 },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  checkboxDone: { backgroundColor: colors.good, borderColor: colors.good, alignItems: 'center', justifyContent: 'center' },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '800' },
  itemTitle: { ...font.body, color: colors.ink },
  itemDone: { color: colors.sub, textDecorationLine: 'line-through' },
  metaWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 1 },
  due: { ...font.tiny, color: colors.sub },
  eventPill: {
    backgroundColor: colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    maxWidth: 190,
  },
  eventPillText: { ...font.tiny, color: colors.primary, fontWeight: '700' },
  doneEventText: { ...font.tiny, color: colors.sub },
  qty: { ...font.tiny, color: colors.sub },
  remove: { color: colors.sub, fontSize: 15, paddingHorizontal: 4 },
  line: { height: 1, backgroundColor: colors.line, marginLeft: 32 },
  doneTitle: { ...font.small, color: colors.sub, marginTop: space.sm },
  footer: { ...font.tiny, color: colors.sub, textAlign: 'center', marginTop: space.md },
  modal: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.md },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { ...font.h2, color: colors.ink },
  fieldLabel: { ...font.small, color: colors.sub },
});
