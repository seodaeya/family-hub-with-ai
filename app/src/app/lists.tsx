import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { deleteItem, listItems, saveItem, toggleItem } from '@/lib/db';
import { useSession } from '@/lib/session';
import type { ItemRow, ListType } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { Btn, Card, Empty, Field, Screen } from '@/components/ui';
import { BottomBar } from '@/components/bottom-bar';
import { colors, font, radius, space } from '@/theme';

const TABS: Array<{ key: ListType; label: string; placeholder: string }> = [
  { key: 'shopping', label: '장보기', placeholder: '예: 우유 2개' },
  { key: 'supply', label: '준비물', placeholder: '예: 도시락' },
  { key: 'todo', label: '할 일', placeholder: '예: 가정통신문 서명' },
];

export default function ListsScreen() {
  const { syncNow } = useSession();
  const params = useLocalSearchParams<{ new?: string }>();
  const [tab, setTab] = useState<ListType>('shopping');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [text, setText] = useState('');

  const load = useCallback(async () => {
    setItems(await listItems());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const add = async () => {
    const title = text.trim();
    if (!title) return;
    await saveItem({ title, listType: tab });
    setText('');
    await load();
    syncNow().catch(() => {});
  };

  const filtered = items.filter((item) => item.listType === tab);
  const open = filtered.filter((item) => !item.done);
  const done = filtered.filter((item) => item.done);
  const placeholder = TABS.find((entry) => entry.key === tab)!.placeholder;

  return (
    <Screen>
      <View>
        <Text style={styles.title}>목록</Text>
        <Text style={styles.sub}>가족이 함께 보고 체크합니다</Text>
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

      <View style={styles.addRow}>
        <View style={{ flex: 1 }}>
          <Field value={text} onChangeText={setText} placeholder={placeholder} onSubmitEditing={add} returnKeyType="done" autoFocus={Boolean(params.new)} />
        </View>
        <Btn label="추가" onPress={add} disabled={!text.trim()} />
      </View>

      {open.length === 0 && done.length === 0 ? (
        <Empty
          title="목록이 비어 있어요"
          hint="문자나 안내문 사진을 추가하면 필요한 물건과 할 일을 AI가 뽑아줍니다."
        />
      ) : null}

      {open.length > 0 ? (
        <Card style={{ paddingVertical: space.sm }}>
          {open.map((item, index) => (
            <View key={item.id}>
              {index > 0 ? <View style={styles.line} /> : null}
              <View style={styles.row}>
                <Pressable style={styles.checkRow} onPress={() => toggleItem(item).then(load)}>
                  <View style={styles.checkbox} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    {item.dueAt ? <Text style={styles.due}>{formatDate(item.dueAt)}까지</Text> : null}
                  </View>
                  {item.qty ? <Text style={styles.qty}>{item.qty}</Text> : null}
                </Pressable>
                <Pressable hitSlop={10} onPress={() => deleteItem(item.id).then(load).then(() => syncNow())}>
                  <Text style={styles.remove}>✕</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {done.length > 0 ? (
        <>
          <Text style={styles.doneTitle}>완료 {done.length}</Text>
          <Card style={{ paddingVertical: space.sm, backgroundColor: colors.cardAlt }}>
            {done.map((item) => (
              <View key={item.id} style={styles.row}>
                <Pressable style={styles.checkRow} onPress={() => toggleItem(item).then(load)}>
                  <View style={[styles.checkbox, styles.checkboxDone]}>
                    <Text style={styles.checkMark}>✓</Text>
                  </View>
                  <Text style={[styles.itemTitle, styles.itemDone]}>{item.title}</Text>
                </Pressable>
                <Pressable hitSlop={10} onPress={() => deleteItem(item.id).then(load).then(() => syncNow())}>
                  <Text style={styles.remove}>✕</Text>
                </Pressable>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <Text style={styles.footer}>체크한 내용은 가족 기기와 동기화됩니다.</Text>

      <BottomBar active="lists" />
    </Screen>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 11, flex: 1 },
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
  due: { ...font.tiny, color: colors.sub, marginTop: 2 },
  qty: { ...font.tiny, color: colors.sub },
  remove: { color: colors.sub, fontSize: 15, paddingHorizontal: 4 },
  line: { height: 1, backgroundColor: colors.line, marginLeft: 36 },
  doneTitle: { ...font.small, color: colors.sub, marginTop: space.sm },
  footer: { ...font.tiny, color: colors.sub, textAlign: 'center', marginTop: space.md },
});
