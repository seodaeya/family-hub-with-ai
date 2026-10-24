import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors, font, radius, space } from '@/theme';

export type EventOption = {
  id: string;
  title: string;
  dateLabel?: string;
  badge?: string;
  /** YYYY-MM-DD when available, useful for syncing due dates. */
  dateYmd?: string;
};

export function EventLinkField({
  label,
  value,
  options,
  onChange,
  placeholder = '일정 연결 안 함',
  mode = 'modal',
  compact = false,
  style,
}: {
  label?: string;
  value: string | null;
  options: EventOption[];
  onChange: (nextId: string | null, option?: EventOption) => void;
  placeholder?: string;
  /** Use 'inline' inside another Modal to avoid nested Modal issues. */
  mode?: 'modal' | 'inline';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? options.find((opt) => opt.id === value) : undefined;

  const select = (nextId: string | null, opt?: EventOption) => {
    onChange(nextId, opt);
    setOpen(false);
  };

  const displayText = selected
    ? `${selected.title}${selected.dateLabel ? ` (${selected.dateLabel})` : ''}`
    : placeholder;

  return (
    <View style={[{ gap: 6 }, style]}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <View style={styles.triggerWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label ?? '일정 연결 선택'}
          onPress={() => setOpen((prev) => !prev)}
          style={({ pressed }) => [
            styles.trigger,
            compact && styles.triggerCompact,
            selected && styles.triggerLinked,
            open && styles.triggerActive,
            pressed && { opacity: 0.75 },
          ]}
        >
          <Text style={styles.icon}>🔗</Text>
          <Text
            style={[
              styles.triggerText,
              compact && styles.triggerTextCompact,
              !selected && { color: colors.sub },
              selected && { color: colors.primary, fontWeight: '700' },
            ]}
            numberOfLines={1}
          >
            {displayText}
          </Text>
        </Pressable>
        {selected ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="일정 연결 해제"
            hitSlop={8}
            onPress={() => select(null)}
            style={styles.clearBtn}
          >
            <Text style={styles.clearText}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {mode === 'inline' && open ? (
        <View style={styles.inlineCard}>
          <EventOptionList
            value={value}
            options={options}
            onSelect={select}
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
                <Text style={styles.modalTitle}>연결할 일정 선택</Text>
                <Pressable hitSlop={10} onPress={() => setOpen(false)}>
                  <Text style={styles.closeBtn}>닫기</Text>
                </Pressable>
              </View>
              <EventOptionList
                value={value}
                options={options}
                onSelect={select}
                onClose={() => setOpen(false)}
              />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

function EventOptionList({
  value,
  options,
  onSelect,
}: {
  value: string | null;
  options: EventOption[];
  onSelect: (nextId: string | null, option?: EventOption) => void;
  onClose?: () => void;
}) {
  return (
    <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={{ gap: 6 }}>
      <Pressable
        onPress={() => onSelect(null)}
        style={[styles.optionRow, !value && styles.optionRowSelected]}
      >
        <Text style={[styles.optionTitle, !value && { color: colors.primary, fontWeight: '700' }]}>
          연결 안 함
        </Text>
        {!value ? <Text style={styles.check}>✓</Text> : null}
      </Pressable>

      {options.length === 0 ? (
        <Text style={styles.emptyText}>연결할 수 있는 일정이 없습니다.</Text>
      ) : (
        options.map((opt) => {
          const isSelected = value === opt.id;
          return (
            <Pressable
              key={opt.id}
              onPress={() => onSelect(opt.id, opt)}
              style={[styles.optionRow, isSelected && styles.optionRowSelected]}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {opt.badge ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{opt.badge}</Text>
                    </View>
                  ) : null}
                  <Text
                    style={[
                      styles.optionTitle,
                      isSelected && { color: colors.primary, fontWeight: '700' },
                    ]}
                    numberOfLines={1}
                  >
                    {opt.title}
                  </Text>
                </View>
                {opt.dateLabel ? <Text style={styles.optionSub}>{opt.dateLabel}</Text> : null}
              </View>
              {isSelected ? <Text style={styles.check}>✓</Text> : null}
            </Pressable>
          );
        })
      )}
    </ScrollView>
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
  triggerLinked: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  triggerActive: {
    borderColor: colors.primary,
  },
  icon: { fontSize: 13 },
  triggerText: { flex: 1, fontSize: 14, color: colors.ink, fontWeight: '500' },
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
    padding: space.sm,
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
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 8,
  },
  optionRowSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  optionTitle: { ...font.small, color: colors.ink, flexShrink: 1 },
  optionSub: { ...font.tiny, color: colors.sub },
  badge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  badgeText: { ...font.tiny, color: colors.primary },
  check: { ...font.small, color: colors.primary, fontWeight: '800' },
  emptyText: { ...font.small, color: colors.sub, textAlign: 'center', paddingVertical: space.md },
});
