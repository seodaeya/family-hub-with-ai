import { useCallback, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, photoSource, type PhotoEntry } from '@/lib/api';
import { deletePhotoLocally, listStoredPhotos, type StoredPhoto } from '@/lib/photo';
import { formatBytes } from '@/lib/format';
import { Btn, Empty, Hint, Screen, ScreenHeader, SectionTitle } from '@/components/ui';
import { colors, font, radius, space } from '@/theme';

type Viewing = {
  key: string;
  uri: string;
  headers?: Record<string, string>;
  title: string;
  bytes: number;
  localUri?: string;
} | null;

export default function PhotosScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [local, setLocal] = useState<StoredPhoto[]>([]);
  const [hub, setHub] = useState<PhotoEntry[]>([]);
  const [hubError, setHubError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState<Viewing>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const localPhotos = await listStoredPhotos();
    let hubPhotos: PhotoEntry[] = [];
    try {
      hubPhotos = (await api.photos()).photos;
      setHubError(null);
    } catch (error) {
      setHubError((error as Error).message);
    }
    setLocal(localPhotos);
    setHub(hubPhotos);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const gap = 6;
  const tile = Math.floor((width - space.lg * 2 - gap * 2) / 3);

  const openLocal = (photo: StoredPhoto) => {
    setViewing({
      key: photo.name,
      uri: photo.uri,
      title: formatStamp(photo.createdAt),
      bytes: photo.bytes,
      localUri: photo.uri,
    });
  };

  const openHub = (photo: PhotoEntry) => {
    const source = photoSource(photo.id);
    if (!source) return;
    setViewing({
      key: photo.id,
      uri: source.uri,
      headers: source.headers,
      title: formatStamp(photo.createdAt),
      bytes: photo.bytes,
    });
  };

  const removeLocal = async () => {
    if (!viewing?.localUri) return;
    await deletePhotoLocally(viewing.localUri);
    setViewing(null);
    await load();
  };

  return (
    <Screen>
      <ScreenHeader
        title="보관한 사진"
        sub="가족이 추가한 사진을 모아 봅니다. 보관하지 않기로 한 사진은 여기에 남지 않습니다."
        onBack={() => router.back()}
      />

      <SectionTitle title={`이 기기 · ${local.length}장`} />
      {local.length ? (
        <View style={[styles.grid, { gap }]}>
          {local.map((photo) => (
            <Pressable
              key={photo.name}
              onPress={() => openLocal(photo)}
              style={({ pressed }) => [{ width: tile, height: tile }, styles.tile, pressed && { opacity: 0.7 }]}
            >
              <Image source={{ uri: photo.uri }} style={styles.image} resizeMode="cover" />
            </Pressable>
          ))}
        </View>
      ) : (
        <Empty
          title={loading ? '불러오는 중…' : '이 기기에 보관한 사진이 없습니다'}
          hint="사진 보관 설정이 '촬영 후 삭제'이면 사진이 남지 않습니다. 보관 기간을 바꾸면 새로 추가한 사진부터 여기에 쌓입니다."
          action={<Btn label="사진 보관 설정" small variant="secondary" onPress={() => router.push('/photo-settings')} />}
        />
      )}

      <SectionTitle title={`맥 허브 · ${hub.length}장`} />
      {hub.length ? (
        <View style={[styles.grid, { gap }]}>
          {hub.map((photo) => (
            <Pressable
              key={photo.id}
              onPress={() => openHub(photo)}
              style={({ pressed }) => [{ width: tile, height: tile }, styles.tile, pressed && { opacity: 0.7 }]}
            >
              <Image
                source={photoSource(photo.id) ?? undefined}
                style={styles.image}
                resizeMode="cover"
              />
            </Pressable>
          ))}
        </View>
      ) : (
        <Empty
          title={hubError ? '맥 사진을 불러오지 못했습니다' : loading ? '불러오는 중…' : '맥에 보관한 사진이 없습니다'}
          hint={
            hubError
              ? '맥이 켜져 있고 같은 Wi-Fi인지 확인해 주세요.'
              : "사진 보관 위치를 '맥 허브에 보관'으로 바꾸면 사진이 맥에 남고, 가족 기기에서도 볼 수 있습니다."
          }
        />
      )}

      {hub.length > 0 ? (
        <Hint>맥 사진은 가족 허브를 통해 불러옵니다. 허브가 꺼져 있으면 표시되지 않습니다.</Hint>
      ) : null}

      <Modal visible={viewing !== null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {viewing ? (
              <Image
                source={{ uri: viewing.uri, ...(viewing.headers ? { headers: viewing.headers } : {}) }}
                style={styles.modalImage}
                resizeMode="contain"
              />
            ) : null}
            <View style={styles.modalMeta}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>{viewing?.title}</Text>
                <Text style={styles.modalSub}>{viewing ? formatBytes(viewing.bytes) : ''}</Text>
              </View>
              {viewing?.localUri ? (
                <Btn label="삭제" small variant="danger" onPress={removeLocal} />
              ) : null}
              <Btn label="닫기" small variant="secondary" onPress={() => setViewing(null)} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function formatStamp(ms: number): string {
  const date = new Date(ms);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}월 ${date.getDate()}일 ${hh}:${mm}`;
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  tile: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderColor: colors.line,
  },
  image: { width: '100%', height: '100%' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 620,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  modalImage: { width: '100%', height: 420, backgroundColor: '#000' },
  modalMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
  },
  modalTitle: { ...font.body, color: colors.ink, fontWeight: '700' },
  modalSub: { ...font.tiny, color: colors.sub },
});
