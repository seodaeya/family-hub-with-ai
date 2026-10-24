import { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { addDays, dateKey } from '@/lib/format';
import { colors, font, radius, space } from '@/theme';

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function toYmd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatYmdLabel(value: string, compact = false): string {
  const parsed = parseYmd(value);
  if (!parsed) return value.trim();
  const date = new Date(parsed.year, parsed.month - 1, parsed.day);
  const weekday = WEEKDAYS[date.getDay()];
  const today = dateKey(new Date().toISOString());
  const tomorrow = dateKey(addDays(new Date(), 1).toISOString());
  const prefix = value === today ? '오늘 · ' : value === tomorrow ? '내일 · ' : '';
  if (compact) {
    return `${prefix}${parsed.month}월 ${parsed.day}일 (${weekday})`;
  }
  return `${prefix}${parsed.year}-${String(parsed.month).padStart(2, '0')}-${String(parsed.day).padStart(2, '0')} (${weekday})`;
}

export function DateField({
  label,
  value,
  onChange,
  placeholder = '날짜 선택',
  allowClear = false,
  title = '날짜 선택',
  mode = 'modal',
  compact = false,
  style,
}: {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  allowClear?: boolean;
  title?: string;
  /** Use 'inline' inside another Modal to avoid nested Modal presentation issues on iOS. */
  mode?: 'modal' | 'inline';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const hasValue = Boolean(value.trim());
  const displayText = hasValue ? formatYmdLabel(value, compact) : placeholder;

  const handleSelect = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.triggerWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label ?? title}
          onPress={() => setOpen((prev) => !prev)}
          style={({ pressed }) => [
            styles.trigger,
            compact && styles.triggerCompact,
            open && styles.triggerActive,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text style={styles.calIcon}>📅</Text>
          <Text
            style={[
              styles.triggerText,
              compact && styles.triggerTextCompact,
              !hasValue && { color: colors.sub },
            ]}
            numberOfLines={1}
          >
            {displayText}
          </Text>
        </Pressable>
        {allowClear && hasValue ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="날짜 지우기"
            hitSlop={8}
            onPress={() => {
              onChange('');
              setOpen(false);
            }}
            style={styles.clearBtn}
          >
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {mode === 'inline' && open ? (
        <View style={styles.inlineCard}>
          <CalendarPicker
            key={value}
            value={value}
            allowClear={allowClear}
            onSelect={handleSelect}
            onClose={() => setOpen(false)}
          />
        </View>
      ) : null}

      {mode === 'modal' ? (
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
        >
          <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{title}</Text>
                <Pressable hitSlop={10} onPress={() => setOpen(false)}>
                  <Text style={styles.closeBtn}>닫기</Text>
                </Pressable>
              </View>
              <CalendarPicker
                key={value}
                value={value}
                allowClear={allowClear}
                onSelect={handleSelect}
                onClose={() => setOpen(false)}
              />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

export function CalendarPicker({
  value,
  allowClear = false,
  onSelect,
  onClose,
}: {
  value: string;
  allowClear?: boolean;
  onSelect: (next: string) => void;
  onClose?: () => void;
}) {
  const initialParsed = parseYmd(value);
  const now = new Date();
  const [cursorYear, setCursorYear] = useState(initialParsed?.year ?? now.getFullYear());
  const [cursorMonth, setCursorMonth] = useState(initialParsed?.month ?? now.getMonth() + 1);
  const [manualText, setManualText] = useState(value);

  const todayKey = dateKey(new Date().toISOString());

  const moveMonth = (delta: number) => {
    const next = new Date(cursorYear, cursorMonth - 1 + delta, 1);
    setCursorYear(next.getFullYear());
    setCursorMonth(next.getMonth() + 1);
  };

  const quickSelect = (offsetDays: number) => {
    const target = dateKey(addDays(new Date(), offsetDays).toISOString());
    onSelect(target);
  };

  const cells = useMemo(() => {
    const firstDay = new Date(cursorYear, cursorMonth - 1, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(cursorYear, cursorMonth, 0).getDate();
    const prevMonthDays = new Date(cursorYear, cursorMonth - 1, 0).getDate();

    const list: { ymd: string; day: number; inMonth: boolean; weekday: number }[] = [];

    for (let i = startWeekday - 1; i >= 0; i -= 1) {
      const d = prevMonthDays - i;
      const prevDate = new Date(cursorYear, cursorMonth - 2, d);
      list.push({
        ymd: toYmd(prevDate.getFullYear(), prevDate.getMonth() + 1, prevDate.getDate()),
        day: d,
        inMonth: false,
        weekday: prevDate.getDay(),
      });
    }

    for (let d = 1; d <= daysInMonth; d += 1) {
      const curDate = new Date(cursorYear, cursorMonth - 1, d);
      list.push({
        ymd: toYmd(cursorYear, cursorMonth, d),
        day: d,
        inMonth: true,
        weekday: curDate.getDay(),
      });
    }

    const remainder = list.length % 7 === 0 ? 0 : 7 - (list.length % 7);
    for (let d = 1; d <= remainder; d += 1) {
      const nextDate = new Date(cursorYear, cursorMonth, d);
      list.push({
        ymd: toYmd(nextDate.getFullYear(), nextDate.getMonth() + 1, nextDate.getDate()),
        day: d,
        inMonth: false,
        weekday: nextDate.getDay(),
      });
    }

    return list;
  }, [cursorYear, cursorMonth]);

  const weeks = useMemo(() => {
    const rows: (typeof cells)[] = [];
    for (let i = 0; i < cells.length; i += 7) {
      rows.push(cells.slice(i, i + 7));
    }
    return rows;
  }, [cells]);

  const applyManual = () => {
    const trimmed = manualText.trim();
    if (!trimmed && allowClear) {
      onSelect('');
      return;
    }
    if (parseYmd(trimmed)) {
      onSelect(trimmed);
    }
  };

  return (
    <View style={styles.calendarWrap}>
      <View style={styles.quickRow}>
        <Pressable style={styles.quickChip} onPress={() => quickSelect(0)}>
          <Text style={styles.quickChipText}>오늘</Text>
        </Pressable>
        <Pressable style={styles.quickChip} onPress={() => quickSelect(1)}>
          <Text style={styles.quickChipText}>내일</Text>
        </Pressable>
        <Pressable style={styles.quickChip} onPress={() => quickSelect(2)}>
          <Text style={styles.quickChipText}>모레</Text>
        </Pressable>
        <Pressable style={styles.quickChip} onPress={() => quickSelect(7)}>
          <Text style={styles.quickChipText}>다음 주</Text>
        </Pressable>
        {allowClear && value ? (
          <Pressable
            style={[styles.quickChip, { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }]}
            onPress={() => onSelect('')}
          >
            <Text style={[styles.quickChipText, { color: colors.danger }]}>해제</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.monthBar}>
        <Pressable hitSlop={10} style={styles.navBtn} onPress={() => moveMonth(-1)}>
          <Text style={styles.navBtnText}>‹ 이전</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const today = new Date();
            setCursorYear(today.getFullYear());
            setCursorMonth(today.getMonth() + 1);
          }}
        >
          <Text style={styles.monthTitle}>
            {cursorYear}년 {cursorMonth}월
          </Text>
        </Pressable>
        <Pressable hitSlop={10} style={styles.navBtn} onPress={() => moveMonth(1)}>
          <Text style={styles.navBtnText}>다음 ›</Text>
        </Pressable>
      </View>

      <View style={styles.weekHeader}>
        {WEEKDAYS.map((day, index) => (
          <Text
            key={day}
            style={[
              styles.weekDayText,
              index === 0 && { color: colors.danger },
              index === 6 && { color: colors.primary },
            ]}
          >
            {day}
          </Text>
        ))}
      </View>

      <View style={{ gap: 4 }}>
        {weeks.map((week, rowIndex) => (
          <View key={`week-${rowIndex}`} style={styles.weekRow}>
            {week.map((cell) => {
              const selected = cell.ymd === value;
              const isToday = cell.ymd === todayKey;
              return (
                <Pressable
                  key={cell.ymd}
                  onPress={() => onSelect(cell.ymd)}
                  style={({ pressed }) => [
                    styles.dayCell,
                    isToday && !selected && styles.dayCellToday,
                    selected && styles.dayCellSelected,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      !cell.inMonth && styles.dayTextMuted,
                      cell.inMonth && cell.weekday === 0 && { color: colors.danger },
                      cell.inMonth && cell.weekday === 6 && { color: colors.primary },
                      isToday && !selected && { fontWeight: '800' },
                      selected && styles.dayTextSelected,
                    ]}
                  >
                    {cell.day}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>

      <View style={styles.manualRow}>
        <TextInput
          value={manualText}
          onChangeText={setManualText}
          placeholder="YYYY-MM-DD 직접 입력"
          placeholderTextColor={colors.sub}
          style={styles.manualInput}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={applyManual}
        />
        <Pressable
          onPress={applyManual}
          disabled={!parseYmd(manualText) && !(allowClear && !manualText.trim())}
          style={[
            styles.manualApply,
            !parseYmd(manualText) && !(allowClear && !manualText.trim()) && { opacity: 0.4 },
          ]}
        >
          <Text style={styles.manualApplyText}>적용</Text>
        </Pressable>
        {onClose ? (
          <Pressable onPress={onClose} style={styles.manualClose}>
            <Text style={styles.manualCloseText}>닫기</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldLabel: { ...font.small, color: colors.sub },
  triggerWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trigger: {
    flex: 1,
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  triggerCompact: {
    minHeight: 36,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  triggerActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  calIcon: { fontSize: 14 },
  triggerText: { flex: 1, fontSize: 15, color: colors.ink, fontWeight: '500' },
  triggerTextCompact: { fontSize: 13 },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { fontSize: 13, color: colors.sub, fontWeight: '700' },
  inlineCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    padding: space.md,
    marginTop: 4,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: space.lg,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
    borderWidth: 1,
    borderColor: colors.line,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: { ...font.h2, color: colors.ink },
  closeBtn: { ...font.small, color: colors.primary, fontWeight: '700' },
  calendarWrap: { gap: space.sm },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  quickChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.line,
  },
  quickChipText: { ...font.tiny, color: colors.ink, fontWeight: '700' },
  monthBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  navBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.cardAlt,
  },
  navBtnText: { ...font.small, color: colors.ink, fontWeight: '700' },
  monthTitle: { ...font.h3, color: colors.ink },
  weekHeader: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  weekDayText: {
    flex: 1,
    textAlign: 'center',
    ...font.tiny,
    color: colors.sub,
  },
  weekRow: {
    flexDirection: 'row',
    gap: 2,
  },
  dayCell: {
    flex: 1,
    height: 38,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellToday: {
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  dayCellSelected: {
    backgroundColor: colors.primary,
  },
  dayText: {
    ...font.small,
    color: colors.ink,
    fontWeight: '600',
  },
  dayTextMuted: {
    color: colors.sub,
    opacity: 0.38,
  },
  dayTextSelected: {
    color: '#fff',
    fontWeight: '800',
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  manualInput: {
    flex: 1,
    height: 38,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    fontSize: 13,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  manualApply: {
    height: 38,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualApplyText: { ...font.tiny, color: '#fff', fontWeight: '700' },
  manualClose: {
    height: 38,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualCloseText: { ...font.tiny, color: colors.sub, fontWeight: '700' },
});
