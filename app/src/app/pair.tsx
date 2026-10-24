import { useMemo, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useSession } from '@/lib/session';
import { ApiError, healthAt, type Health } from '@/lib/api';
import { suggestedHubUrl } from '@/lib/hub-url';
import { Btn, Card, Field, Hint, Screen } from '@/components/ui';
import { colors, font, radius, space } from '@/theme';

export default function PairScreen() {
  const { connect } = useSession();
  // Filled from the Mac's Metro address, so the usual case needs no typing.
  const detected = useMemo(() => suggestedHubUrl(), []);
  const [url, setUrl] = useState(() => suggestedHubUrl());
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  const checkServer = async () => {
    setError(null);
    setHealth(null);
    setBusy(true);
    try {
      const result = await healthAt(url);
      setHealth(result);
    } catch {
      setError('서버를 찾지 못했습니다. 주소와 Wi-Fi를 확인해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      await connect({ url, code });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'not_found') setError('코드를 찾을 수 없습니다. 맥에서 새 코드를 발급해 주세요.');
        else if (err.code === 'expired') setError('코드가 만료되었습니다. 맥에서 새 코드를 발급해 주세요.');
        else if (err.code === 'used') setError('이미 사용된 코드입니다.');
        else setError(err.message);
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={{ paddingTop: space.xl, gap: 6 }}>
        <Text style={styles.logo}>우리집 AI</Text>
        <Text style={styles.lead}>
          사진과 일정은 집 안에서만 처리됩니다.{'\n'}
          맥에서 서버를 켜고 연결 코드를 입력하세요.
        </Text>
      </View>

      <Card>
        <Text style={styles.cardTitle}>1. 맥에서 서버 켜기</Text>
        <View style={styles.codeBlock}>
          <Text style={styles.code}>cd family-hub-with-ai/hub</Text>
          <Text style={styles.code}>npm start</Text>
        </View>
        <Hint>처음이라면 `npm run init` 으로 연결 코드를 먼저 발급하세요.</Hint>
      </Card>

      <Card>
        <Text style={styles.cardTitle}>2. 서버 주소</Text>
        <Field
          value={url}
          onChangeText={setUrl}
          placeholder="http://192.168.0.10:4317"
          keyboardType="url"
        />
        <View style={styles.addressRow}>
          <Btn
            label="서버 상태 확인"
            variant="secondary"
            small
            onPress={checkServer}
            loading={busy && !code}
            style={{ flex: 1 }}
          />
          <Btn
            label="주소 자동 입력"
            variant="ghost"
            small
            onPress={() => setUrl(detected)}
            disabled={!detected}
          />
        </View>
        <Hint>
          {detected
            ? '맥의 주소를 자동으로 채웠습니다. 다르면 직접 수정하세요.'
            : 'npm run init 출력에 나오는 http://192.168.x.x:4317 을 입력하세요.'}
        </Hint>
        {health ? (
          <View style={styles.healthBox}>
            <Text style={styles.healthLine}>
              OCR {health.ocr.ok ? '준비됨' : '없음'} · AI {health.ollama.ok ? health.ollama.model : '모델 없음'}
            </Text>
            <Text style={styles.healthSub}>가족: {health.paired ? '등록됨' : '아직 없음'}</Text>
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.cardTitle}>3. 연결 코드</Text>
        <Field
          value={code}
          onChangeText={(value) => setCode(value.toUpperCase())}
          placeholder="예: EKTQBP3D"
          autoCapitalize="characters"
          style={{ letterSpacing: 3, fontWeight: '700', fontSize: 20, textAlign: 'center' }}
          maxLength={10}
        />
        <Hint>첫 기기는 부모 기기로 등록되고, 이후 기기는 보호자 승인이 필요합니다.</Hint>
      </Card>

      {error ? (
        <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
          <Text style={{ color: colors.danger, ...font.small, lineHeight: 20 }}>{error}</Text>
        </Card>
      ) : null}

      <Btn label="연결하기" onPress={submit} loading={busy} disabled={!code.trim() || !url.trim()} />

      <View style={styles.footer}>
        <Text style={styles.footerText}>외부 인터넷 없이 같은 Wi-Fi 또는 Tailscale로 연결합니다.</Text>
        <Text style={styles.footerLink} onPress={() => Linking.openURL('https://tailscale.com/download')}>
          Tailscale 설치 안내
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: { ...font.h1, fontSize: 32, color: colors.ink },
  lead: { ...font.body, color: colors.sub, lineHeight: 22 },
  cardTitle: { ...font.h3, color: colors.ink, marginBottom: 4 },
  codeBlock: {
    backgroundColor: '#1F2326',
    borderRadius: radius.sm,
    padding: space.md,
    gap: 2,
  },
  code: { color: '#E9E4DC', fontFamily: 'Menlo', fontSize: 12 },
  addressRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  healthBox: { backgroundColor: colors.goodSoft, padding: space.md, borderRadius: radius.sm, gap: 2 },
  healthLine: { ...font.small, color: colors.good, fontWeight: '700' },
  healthSub: { ...font.tiny, color: colors.sub },
  footer: { alignItems: 'center', gap: 6, marginTop: space.md },
  footerText: { ...font.tiny, color: colors.sub, textAlign: 'center' },
  footerLink: { ...font.tiny, color: colors.primary, textDecorationLine: 'underline' },
});
