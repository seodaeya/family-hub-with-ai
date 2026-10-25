import { useEffect, useMemo, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { getPhotoSettings, listEvents, saveEvent, saveItem, saveSource } from '@/lib/db';
import { rescheduleNotifications } from '@/lib/notify';
import { savePhotoLocally } from '@/lib/photo';
import { useSession } from '@/lib/session';
import { peekDraft, takeDraft } from '@/lib/store';
import type { EventRow, ListType } from '@/lib/types';
import { addDays, formatDate, fromLocalInput, toLocalInput } from '@/lib/format';
import { openGoogleCalendarTemplate } from '@/lib/google-calendar';
import { DateField, formatYmdLabel } from '@/components/date-picker';
import { EventLinkField, type EventOption } from '@/components/event-picker';
import { Badge, Btn, Card, Chip, Empty, Field, Hint, Screen, SectionTitle } from '@/components/ui';
import { colors, font, space } from '@/theme';

type DraftEvent = {
  selected: boolean;
  target: 'event' | 'list';
  title: string;
  date: string;
  time: string;
  allDay: boolean;
  location: string;
  googleSync: boolean;
  confidence: number;
};

type DraftItem = {
  selected: boolean;
  target: 'list' | 'event';
  title: string;
  listType: ListType;
  qty: string;
  dueAt: string;
  linkedEventKey: string | null;
  googleSync: boolean;
  confidence: number;
};

const TYPE_LABEL: Record<ListType, string> = { shopping: '장보기', supply: '준비물', todo: '할 일' };

export default function ReviewScreen() {
  const router = useRouter();
  const { syncNow, googleHealth } = useSession();
  const [draft] = useState(() => peekDraft());
  const [existingEvents, setExistingEvents] = useState<EventRow[]>([]);
  const [events, setEvents] = useState<DraftEvent[]>(() =>
    (draft?.result.events ?? []).map((event) => ({
      selected: true,
      target: 'event',
      title: event.title,
      date: event.startsAt ? toLocalInput(event.startsAt).slice(0, 10) : '',
      time: event.allDay || !event.startsAt ? '09:00' : toLocalInput(event.startsAt).slice(11, 16),
      allDay: event.allDay,
      location: event.location ?? '',
      googleSync: false,
      confidence: event.confidence,
    })),
  );
  const [items, setItems] = useState<DraftItem[]>(() => {
    const rawEvents = draft?.result.events ?? [];
    return (draft?.result.items ?? []).map((item) => {
      const dueYmd = item.dueAt ? toLocalInput(item.dueAt).slice(0, 10) : '';
      let defaultLink: string | null = null;
      if (item.listType !== 'shopping' && rawEvents.length > 0) {
        if (dueYmd) {
          const matchIdx = rawEvents.findIndex(
            (ev) => ev.startsAt && toLocalInput(ev.startsAt).slice(0, 10) === dueYmd,
          );
          if (matchIdx >= 0) defaultLink = `draft:${matchIdx}`;
        }
        if (!defaultLink && rawEvents.length === 1) {
          defaultLink = 'draft:0';
        }
      }
      return {
        selected: true,
        target: 'list',
        title: item.title,
        listType: item.listType,
        qty: item.qty ?? '',
        dueAt: dueYmd,
        linkedEventKey: defaultLink,
        googleSync: false,
        confidence: item.confidence,
      };
    });
  });
  const [showText, setShowText] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const now = new Date();
    listEvents(addDays(now, -7).toISOString(), addDays(now, 180).toISOString()).then(setExistingEvents);
  }, []);

  const eventOptions = useMemo<EventOption[]>(() => {
    const opts: EventOption[] = [];
    events.forEach((ev, idx) => {
      if (ev.selected && ev.target === 'event') {
        opts.push({
          id: `draft:${idx}`,
          title: ev.title.trim() || `일정 후보 ${idx + 1}`,
          dateLabel: ev.date ? formatYmdLabel(ev.date, true) : '날짜 미정',
          badge: '이번 추출',
          dateYmd: ev.date || undefined,
        });
      }
    });
    existingEvents.forEach((ev) => {
      opts.push({
        id: `existing:${ev.id}`,
        title: ev.title,
        dateLabel: ev.startsAt ? formatDate(ev.startsAt) : '날짜 미정',
        badge: '기존 일정',
        dateYmd: ev.startsAt ? toLocalInput(ev.startsAt).slice(0, 10) : undefined,
      });
    });
    return opts;
  }, [events, existingEvents]);

  if (!draft) {
    return (
      <Screen>
        <Empty
          title="정리할 내용이 없습니다"
          hint="사진을 추가하면 여기에서 결과를 확인하고 저장할 수 있습니다."
          action={<Btn label="사진 추가" onPress={() => router.replace('/capture')} />}
        />
      </Screen>
    );
  }

  const selectedEvents = events.filter((event) => event.selected);
  const selectedItems = items.filter((item) => item.selected);
  const total = selectedEvents.length + selectedItems.length;
  const confidence = Math.round((draft.result.confidence ?? 0) * 100);

  const updateEvent = (index: number, patch: Partial<DraftEvent>) =>
    setEvents((current) => current.map((event, i) => (i === index ? { ...event, ...patch } : event)));

  const updateItem = (index: number, patch: Partial<DraftItem>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const save = async () => {
    const missingEventDate = selectedEvents.find((event) => event.target === 'event' && !event.date.trim());
    if (missingEventDate) {
      Alert.alert('날짜가 없습니다', `"${missingEventDate.title || '제목 없음'}" 일정의 날짜를 입력해 주세요.`);
      return;
    }
    const missingItemDate = selectedItems.find((item) => item.target === 'event' && !item.dueAt.trim());
    if (missingItemDate) {
      Alert.alert('날짜가 없습니다', `"${missingItemDate.title || '제목 없음'}"을 일정으로 넣으려면 날짜를 입력해 주세요.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const source = await saveSource({
        kind: draft.result.mode,
        text: draft.result.ocrText || draft.text || null,
        photoRef: draft.result.photoRef ?? null,
      });

      const draftEventIdMap = new Map<number, string>();

      for (let i = 0; i < events.length; i += 1) {
        const event = events[i];
        if (!event.selected || !event.title.trim()) continue;
        if (event.target === 'list') {
          await saveItem({
            title: event.title.trim(),
            listType: 'todo',
            qty: null,
            dueAt: event.date ? fromLocalInput(`${event.date}T00:00`) : null,
            sourceId: source.id,
          });
          continue;
        }
        const startsAt = event.date
          ? fromLocalInput(event.allDay ? `${event.date}T00:00` : `${event.date} ${event.time}`)
          : null;
        const savedEvent = await saveEvent({
          title: event.title.trim(),
          startsAt,
          allDay: event.allDay ? 1 : 0,
          location: event.location.trim() || null,
          sourceId: source.id,
          googleSync: event.googleSync ? 1 : 0,
        });
        draftEventIdMap.set(i, savedEvent.id);
      }

      for (const item of selectedItems) {
        if (!item.title.trim()) continue;
        if (item.target === 'event') {
          await saveEvent({
            title: item.title.trim(),
            startsAt: fromLocalInput(`${item.dueAt}T00:00`),
            allDay: 1,
            location: null,
            memo: item.qty.trim() ? `수량 ${item.qty.trim()}` : null,
            sourceId: source.id,
            googleSync: item.googleSync ? 1 : 0,
          });
          continue;
        }
        let resolvedEventId: string | null = null;
        if (item.linkedEventKey?.startsWith('draft:')) {
          const idx = Number(item.linkedEventKey.slice(6));
          resolvedEventId = draftEventIdMap.get(idx) ?? null;
        } else if (item.linkedEventKey?.startsWith('existing:')) {
          resolvedEventId = item.linkedEventKey.slice(9) || null;
        }
        await saveItem({
          title: item.title.trim(),
          listType: item.listType,
          qty: item.qty.trim() || null,
          dueAt: item.dueAt ? fromLocalInput(`${item.dueAt}T00:00`) : null,
          sourceId: source.id,
          eventId: resolvedEventId,
        });
      }

      const photoSettings = await getPhotoSettings();
      if (photoSettings.retention !== 'delete' && photoSettings.location === 'device') {
        for (const image of draft.images) {
          await savePhotoLocally(image.base64);
        }
      }

      await rescheduleNotifications(await listEvents(new Date().toISOString()));
      takeDraft();
      syncNow().catch(() => {});
      router.replace('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const hasNothing = !events.length && !items.length;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>AI가 정리한 내용</Text>
          <Text style={styles.sub}>확인하고 고친 뒤 저장하세요. 자동 저장되지 않습니다.</Text>
        </View>
        <Btn label="닫기" variant="ghost" small onPress={() => router.back()} />
      </View>

      <View style={styles.metaRow}>
        <Badge label={`신뢰도 ${confidence}%`} tone={confidence >= 75 ? 'good' : confidence >= 50 ? 'warn' : 'danger'} />
        <Badge label={`${draft.result.meta.llmMs}ms · ${draft.result.meta.model}`} tone="neutral" />
      </View>

      {draft.images.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {draft.images.map((image, index) => {
            const ratio = image.height > 0 ? image.width / image.height : 0.75;
            const width = Math.round(Math.min(160, Math.max(56, ratio * 110)));
            return (
              <Image
                key={`${image.uri}-${index}`}
                source={{ uri: image.uri }}
                style={[styles.previewImage, { width, height: 110 }]}
                resizeMode="contain"
              />
            );
          })}
        </ScrollView>
      ) : null}

      {draft.result.source ? (
        <Card style={{ gap: 3, padding: space.md }}>
          <Text style={styles.sourceLabel}>링크에서 가져옴</Text>
          <Text style={styles.sourceTitle} numberOfLines={2}>
            {draft.result.source.title || draft.result.source.url}
          </Text>
          <Text style={styles.sourceUrl} numberOfLines={1}>
            {draft.result.source.url}
          </Text>
        </Card>
      ) : null}

      {draft.result.warnings.length > 0 ? (
        <Card style={{ backgroundColor: colors.warnSoft, borderColor: colors.warnSoft, gap: 4 }}>
          {draft.result.warnings.map((warning) => (
            <Text key={warning} style={styles.warning}>
              · {warning}
            </Text>
          ))}
        </Card>
      ) : null}

      {hasNothing ? (
        <Empty
          title="뽑아낸 항목이 없습니다"
          hint="사진이 흐리거나 글자가 작으면 인식이 어렵습니다. 다시 찍거나 직접 추가해 주세요."
          action={
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Btn label="다시 찍기" small onPress={() => router.replace('/capture')} />
              <Btn label="직접 추가" small variant="secondary" onPress={() => router.replace('/schedule?new=1')} />
            </View>
          }
        />
      ) : null}

      {events.length > 0 ? (
        <>
          <SectionTitle title={`일정 후보 ${selectedEvents.length}/${events.length}`} />
          <View style={{ gap: space.sm }}>
            {events.map((event, index) => (
              <Card key={`event-${index}`} style={[styles.itemCard, event.selected ? undefined : styles.itemCardOff]}>
                <View style={styles.itemHeader}>
                  <Checkbox
                    checked={event.selected}
                    onPress={() => updateEvent(index, { selected: !event.selected })}
                  />
                  <Field
                    value={event.title}
                    onChangeText={(title) => updateEvent(index, { title })}
                    style={styles.titleInput}
                  />
                  <Text style={styles.conf}>{Math.round(event.confidence * 100)}%</Text>
                </View>
                <View style={styles.dateRow}>
                  <DateField
                    value={event.date}
                    onChange={(date) => updateEvent(index, { date })}
                    placeholder="날짜 선택"
                    title="일정 날짜 선택"
                    style={styles.dateInput}
                  />
                  {!event.allDay ? (
                    <Field
                      value={event.time}
                      onChangeText={(time) => updateEvent(index, { time })}
                      placeholder="HH:mm"
                      style={styles.timeInput}
                    />
                  ) : null}
                  <Chip
                    label={event.allDay ? '종일' : '시간'}
                    selected={event.allDay}
                    onPress={() => updateEvent(index, { allDay: !event.allDay })}
                  />
                </View>
                <Field
                  value={event.location}
                  onChangeText={(location) => updateEvent(index, { location })}
                  placeholder="장소 (선택)"
                />
                {event.target === 'event' && items.length > 0 ? (
                  <View style={styles.targetRow}>
                    <Text style={styles.targetLabel}>연결 항목</Text>
                    <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {items.map((item, itemIdx) => {
                        if (!item.selected || item.target !== 'list') return null;
                        const linked = item.linkedEventKey === `draft:${index}`;
                        return (
                          <Chip
                            key={`link-${index}-${itemIdx}`}
                            label={`${TYPE_LABEL[item.listType]} · ${item.title || '항목'}`}
                            selected={linked}
                            onPress={() =>
                              updateItem(itemIdx, {
                                linkedEventKey: linked ? null : `draft:${index}`,
                                dueAt: !linked && !item.dueAt && event.date ? event.date : item.dueAt,
                              })
                            }
                          />
                        );
                      })}
                    </View>
                  </View>
                ) : null}
                <View style={styles.targetRow}>
                  <Text style={styles.targetLabel}>저장 위치</Text>
                  <Chip
                    label="일정"
                    selected={event.target === 'event'}
                    onPress={() => updateEvent(index, { target: 'event' })}
                  />
                  <Chip
                    label="할 일"
                    selected={event.target === 'list'}
                    onPress={() => updateEvent(index, { target: 'list' })}
                  />
                </View>
                <View style={styles.targetRow}>
                  <Text style={styles.targetLabel}>구글 연동</Text>
                  {event.target === 'event' && googleHealth?.ok ? (
                    <Chip
                      label={event.googleSync ? '✓ 허브 자동 동기화' : '허브 자동 동기화'}
                      selected={event.googleSync}
                      onPress={() => updateEvent(index, { googleSync: !event.googleSync })}
                    />
                  ) : null}
                  <Chip
                    label="🔍 구글 캘린더에 추가"
                    onPress={() => {
                      if (!event.date.trim()) {
                        Alert.alert('날짜 필요', '구글 캘린더에 추가하려면 먼저 날짜를 선택해 주세요.');
                        return;
                      }
                      openGoogleCalendarTemplate({
                        title: event.title,
                        date: event.date,
                        time: event.time,
                        allDay: event.allDay,
                        location: event.location,
                      });
                    }}
                  />
                </View>
              </Card>
            ))}
          </View>
        </>
      ) : null}

      {items.length > 0 ? (
        <>
          <SectionTitle title={`목록 후보 ${selectedItems.length}/${items.length}`} />
          <View style={{ gap: space.sm }}>
            {items.map((item, index) => (
              <Card key={`item-${index}`} style={[styles.itemCard, item.selected ? undefined : styles.itemCardOff]}>
                <View style={styles.itemHeader}>
                  <Checkbox
                    checked={item.selected}
                    onPress={() => updateItem(index, { selected: !item.selected })}
                  />
                  <Field
                    value={item.title}
                    onChangeText={(title) => updateItem(index, { title })}
                    style={styles.titleInput}
                  />
                  <Text style={styles.conf}>{Math.round(item.confidence * 100)}%</Text>
                </View>
                <View style={styles.typeRow}>
                  {(['shopping', 'supply', 'todo'] as ListType[]).map((type) => (
                    <Chip
                      key={type}
                      label={TYPE_LABEL[type]}
                      selected={item.listType === type}
                      onPress={() => updateItem(index, { listType: type })}
                    />
                  ))}
                  <Field
                    value={item.qty}
                    onChangeText={(qty) => updateItem(index, { qty })}
                    placeholder="수량"
                    style={styles.qtyInput}
                  />
                </View>
                <View style={styles.targetRow}>
                  <Text style={styles.targetLabel}>{item.target === 'event' ? '날짜' : '마감일'}</Text>
                  <DateField
                    value={item.dueAt}
                    onChange={(dueAt) => updateItem(index, { dueAt })}
                    placeholder="마감일 선택 (선택)"
                    title={item.target === 'event' ? '일정 날짜 선택' : '마감일 선택'}
                    allowClear={item.target !== 'event'}
                    style={styles.dateInput}
                  />
                </View>
                {item.target === 'list' ? (
                  <View style={styles.targetRow}>
                    <Text style={styles.targetLabel}>일정 연결</Text>
                    <EventLinkField
                      value={item.linkedEventKey}
                      options={eventOptions}
                      onChange={(nextKey, opt) =>
                        updateItem(index, {
                          linkedEventKey: nextKey,
                          dueAt: !item.dueAt && opt?.dateYmd ? opt.dateYmd : item.dueAt,
                        })
                      }
                      placeholder="연결할 일정 선택 (선택)"
                      style={{ flex: 1 }}
                    />
                  </View>
                ) : null}
                <View style={styles.targetRow}>
                  <Text style={styles.targetLabel}>저장 위치</Text>
                  <Chip
                    label="목록"
                    selected={item.target === 'list'}
                    onPress={() => updateItem(index, { target: 'list' })}
                  />
                  <Chip
                    label="일정"
                    selected={item.target === 'event'}
                    onPress={() => updateItem(index, { target: 'event' })}
                  />
                </View>
                <View style={styles.targetRow}>
                  <Text style={styles.targetLabel}>구글 연동</Text>
                  {item.target === 'event' && googleHealth?.ok ? (
                    <Chip
                      label={item.googleSync ? '✓ 허브 자동 동기화' : '허브 자동 동기화'}
                      selected={item.googleSync}
                      onPress={() => updateItem(index, { googleSync: !item.googleSync })}
                    />
                  ) : null}
                  <Chip
                    label="🔍 구글 캘린더에 추가"
                    onPress={() => {
                      const fallbackDate =
                        item.dueAt.trim() ||
                        (item.linkedEventKey ? eventOptions.find((o) => o.id === item.linkedEventKey)?.dateYmd : '') ||
                        '';
                      if (!fallbackDate) {
                        Alert.alert('날짜 필요', '구글 캘린더에 추가하려면 마감일이나 연결된 일정 날짜가 필요합니다.');
                        return;
                      }
                      openGoogleCalendarTemplate({
                        title: `[${TYPE_LABEL[item.listType]}] ${item.title}`,
                        date: fallbackDate,
                        allDay: true,
                        memo: item.qty ? `수량: ${item.qty}` : undefined,
                      });
                    }}
                  />
                </View>
              </Card>
            ))}
          </View>
        </>
      ) : null}

      <Btn
        label={saving ? '저장 중…' : `${total}개 저장하기`}
        onPress={save}
        loading={saving}
        disabled={total === 0}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable onPress={() => setShowText((value) => !value)} style={styles.textToggle}>
        <Text style={styles.textToggleLabel}>{showText ? '원본 글자 숨기기' : '원본 글자 보기'}</Text>
      </Pressable>
      {showText ? (
        <Card>
          <Text style={styles.rawText}>{draft.result.ocrText || '(글자 없음)'}</Text>
        </Card>
      ) : null}

      <Hint>
        저장 후에도 각 항목을 눌러 수정하거나 삭제할 수 있습니다. &ldquo;🔍 구글 캘린더에 추가&rdquo;는 브라우저를 열어 구글 캘린더에 수동으로 저장합니다 (앱 저장과 별도).
      </Hint>
    </Screen>
  );
}

function Checkbox({ checked, onPress }: { checked: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked ? <Text style={styles.checkMark}>✓</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  title: { ...font.h1, color: colors.ink },
  sub: { ...font.small, color: colors.sub, marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: 6 },
  previewImage: {
    borderRadius: 10,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.line,
  },
  warning: { ...font.small, color: colors.warn, lineHeight: 19 },
  sourceLabel: { ...font.tiny, color: colors.sub, fontWeight: '700' },
  sourceTitle: { ...font.small, color: colors.ink, fontWeight: '700' },
  sourceUrl: { ...font.tiny, color: colors.primary },
  itemCard: { gap: space.sm, padding: space.md },
  itemCardOff: { opacity: 0.45 },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  titleInput: { flex: 1, fontWeight: '700', backgroundColor: colors.bg },
  conf: { ...font.tiny, color: colors.sub, width: 34, textAlign: 'right' },
  dateRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  dateInput: { flex: 1, backgroundColor: colors.bg },
  timeInput: { width: 76, backgroundColor: colors.bg },
  typeRow: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  qtyInput: { width: 76, backgroundColor: colors.bg },
  targetRow: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  targetLabel: { ...font.tiny, color: colors.sub, width: 52 },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: '#fff', fontSize: 12, fontWeight: '800' },
  textToggle: { alignItems: 'center', paddingVertical: space.sm },
  textToggleLabel: { ...font.small, color: colors.primary },
  rawText: { ...font.small, color: colors.sub, lineHeight: 20 },
  error: { ...font.small, color: colors.danger },
});
