import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { api, ApiError } from '@/lib/api';
import { getAiSettings } from '@/lib/db';
import { useSession } from '@/lib/session';
import { setDraft } from '@/lib/store';
import type { AiSettings } from '@/lib/types';
import { Btn, Card, Field, Hint, Screen, ScreenHeader, SectionTitle } from '@/components/ui';
import { colors, font, space } from '@/theme';

const EXTERNAL_PROMPT = `다음 내용을 정리해 주세요.
사진이면 글자를 먼저 읽고, 날짜가 있는 일정 · 준비물이나 구매 목록 · 해야 할 일을 뽑아 주세요.
아래 JSON 형식으로만 답하고, 설명이나 인사말은 쓰지 마세요. 없는 내용은 만들지 마세요.

{"events":[{"title":"","startsAt":"YYYY-MM-DDTHH:mm:00+09:00","endsAt":null,"allDay":false,"location":null,"memo":null,"confidence":0.9}],"items":[{"listType":"supply","title":"","qty":null,"dueAt":null,"confidence":0.9}],"warnings":[]}

listType은 shopping(사야 할 것) / supply(준비물) / todo(할 일) 중 하나입니다.
결과를 복사해서 우리집 AI 앱의 "외부 AI 결과 붙여넣기"에 넣어 주세요.`;

type Action = 'text' | 'url' | 'paste' | null;

export default function AddScreen() {
  const router = useRouter();
  const { health } = useSession();
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState<Action>(null);
  const [stage, setStage] = useState<'reading' | 'thinking'>('thinking');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>({ model: 'fast' });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getAiSettings().then(setAiSettings);
  }, []);

  useEffect(() => {
    if (!busy) {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
      return;
    }
    timer.current = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [busy]);

  const model = aiSettings.model === 'accurate' ? health?.ollama.altModel ?? 'qwen2.5:14b-instruct' : undefined;

  const run = async (action: Exclude<Action, null>, body: { text?: string; url?: string }, readMs = 0) => {
    setBusy(action);
    setElapsed(0);
    setError(null);
    setStage(readMs > 0 ? 'reading' : 'thinking');
    const stageTimer = readMs > 0 ? setTimeout(() => setStage('thinking'), readMs) : null;
    try {
      const result = await api.extract({ ...body, model });
      setDraft({ result, images: [], text: body.url ?? body.text });
      router.push('/review');
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : action === 'url'
            ? '링크를 읽지 못했습니다. 공개 링크인지 확인하거나 글을 직접 붙여넣어 주세요.'
            : '내용을 정리하지 못했습니다. 글을 확인하고 다시 시도해 주세요.',
      );
    } finally {
      if (stageTimer) clearTimeout(stageTimer);
      setBusy(null);
      setStage('thinking');
    }
  };

  const progress =
    stage === 'reading' ? '링크를 읽고 있어요' : '일정과 할 일을 뽑고 있어요';

  return (
    <Screen>
      <ScreenHeader
        title="일정 추가"
        sub="안내문 사진, 붙여넣은 글, 공유 링크 중 편한 것으로 시작하세요."
        onBack={() => router.back()}
      />

      <Card style={{ gap: space.sm }}>
        <Text style={styles.label}>1. 글 붙여넣기</Text>
        <Text style={styles.sub}>문자, 카톡, 공지문을 그대로 붙여넣으세요.</Text>
        <Field
          value={text}
          onChangeText={setText}
          placeholder="예: 다음 주 화요일 3시까지 준비물…"
          multiline
          style={{ minHeight: 96, textAlignVertical: 'top' }}
        />
        <Btn
          label="글로 정리하기"
          small
          onPress={() => run('text', { text: text.trim() })}
          loading={busy === 'text'}
          disabled={!text.trim() || busy !== null}
        />
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text style={styles.label}>2. 링크 가져오기</Text>
        <Text style={styles.sub}>
          제미나이 공유 링크처럼 이미 정리된 글도 됩니다. 맥이 링크를 읽고, 정리는 맥 안에서 합니다.
        </Text>
        <Field
          value={url}
          onChangeText={setUrl}
          placeholder="https://share.gemini.google/..."
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={{ fontSize: 13 }}
        />
        <Btn
          label="링크에서 정리하기"
          small
          onPress={() => run('url', { url: url.trim() }, 5000)}
          loading={busy === 'url'}
          disabled={!url.trim() || busy !== null}
        />
        <Hint>공개 링크만 읽을 수 있습니다. 로그인이 필요한 주소는 안 됩니다.</Hint>
      </Card>

      <Card style={{ gap: space.sm }}>
        <Text style={styles.label}>3. 외부 AI로 정리한 결과 붙여넣기</Text>
        <Text style={styles.sub}>
          사진을 외부 AI에 보내 정리한 뒤, 그 결과를 여기에 붙여넣으면 이 맥에서 일정과 목록으로 바꿉니다.
        </Text>
        <Btn
          label="프롬프트 복사"
          small
          variant="secondary"
          onPress={() => Clipboard.setStringAsync(EXTERNAL_PROMPT)}
        />
        <Field
          value={pasted}
          onChangeText={setPasted}
          placeholder="외부 AI가 준 결과를 붙여넣으세요. JSON이 아니어도 됩니다."
          multiline
          style={{ minHeight: 92, textAlignVertical: 'top' }}
        />
        <Btn
          label="붙여넣은 내용으로 정리"
          small
          onPress={() => run('paste', { text: pasted.trim() })}
          loading={busy === 'paste'}
          disabled={!pasted.trim() || busy !== null}
        />
        <Hint>외부 AI로 사진을 보내는 순간 그 사진은 가족 허브 밖으로 나갑니다. 동의하는 경우에만 사용하세요.</Hint>
      </Card>

      {busy ? (
        <Card style={styles.progress}>
          <ActivityIndicator color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.progressTitle}>{progress}</Text>
            <Text style={styles.progressSub}>
              {elapsed}초 경과 · 보통 6~15초 걸립니다 (정확 모드는 30초 이상)
            </Text>
          </View>
        </Card>
      ) : null}

      {error ? (
        <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
          <Text style={styles.error}>{error}</Text>
        </Card>
      ) : null}

      <SectionTitle title="직접 넣기" />
      <Card style={{ gap: space.sm }}>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Btn label="일정 직접 추가" small variant="secondary" onPress={() => router.push('/schedule?new=1')} style={{ flex: 1 }} />
          <Btn label="목록 직접 추가" small variant="secondary" onPress={() => router.push('/lists?new=1')} style={{ flex: 1 }} />
        </View>
        <Btn label="사진으로 추가" small variant="secondary" onPress={() => router.push('/capture')} />
      </Card>

      <Hint>글과 링크 내용은 집 안의 맥에서만 처리됩니다. 링크를 가져올 때만 그 사이트에 접속합니다.</Hint>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { ...font.small, color: colors.ink, fontWeight: '700' },
  sub: { ...font.tiny, color: colors.sub, lineHeight: 16 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  progressTitle: { ...font.small, color: colors.ink, fontWeight: '700' },
  progressSub: { ...font.tiny, color: colors.sub },
  error: { ...font.small, color: colors.danger, lineHeight: 20 },
});
