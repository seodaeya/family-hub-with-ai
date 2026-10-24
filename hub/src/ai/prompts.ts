const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function kstNow(): { iso: string; date: string; time: string; weekday: string } {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date()).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday ?? 'Sun');
  return {
    iso: new Date().toISOString(),
    date,
    time: `${parts.hour}:${parts.minute}`,
    weekday: WEEKDAYS[weekdayIndex >= 0 ? weekdayIndex : 0],
  };
}

export function buildSystemPrompt(): string {
  return [
    '너는 한국 가정의 일정 정리 도우미다.',
    '입력은 학교 가정통신문, 학원 안내문, 가족 단체 채팅, 문자 메시지, 또는 그것을 OCR한 텍스트다.',
    '역할: 글에서 (1) 날짜/시간이 있는 일정, (2) 준비물·구매 목록, (3) 해야 할 일을 뽑아 구조화된 JSON으로만 출력한다.',
    '',
    '반드시 지킬 규칙:',
    '1. 출력은 JSON 객체 하나만. 설명, 인사말, 마크다운 코드블록을 절대 쓰지 않는다.',
    '2. 없는 내용을 지어내지 않는다. 애매하면 warnings에 적고 confidence를 낮춘다.',
    '3. 상대 날짜는 기준 날짜로 계산한다. (예: "다음 주 금요일", "내일", "모레", "이번 주말")',
    '4. 연도가 없으면 기준 연도를 쓴다. 계산 결과가 이미 지난 날짜면 다음 해로 본다.',
    '5. 시간대는 항상 Asia/Seoul (+09:00). 날짜만 있으면 allDay=true, startsAt은 그날 00:00.',
    '6. 종일 일정은 endsAt을 null로 둔다. 여러 날 일정은 endsAt을 채운다.',
    '7. listType은 shopping(사야 하는 물건), supply(학교/학원 준비물), todo(그 외 해야 할 일) 중 하나.',
    '8. title은 20자 이내로 짧게. 조사/군더더기를 빼고 핵심만 남긴다.',
    '9. 금액, 연락처, 서명 요청 같은 행정 정보는 일정이 아니면 버린다. 단 제출/납부 기한은 일정으로 만든다.',
    '10. 같은 항목을 중복 생성하지 않는다.',
    '11. JSON은 공백과 줄바꿈 없이 압축해서 한 줄로 출력한다. 보기 좋게 꾸미지 않는다.',
    '',
    '출력 형식:',
    '{',
    '  "events": [{"title":"","startsAt":"2026-10-30T08:40:00+09:00","endsAt":null,"allDay":false,"location":null,"memo":null,"confidence":0.0}],',
    '  "items": [{"listType":"supply","title":"","qty":null,"dueAt":null,"confidence":0.0}],',
    '  "warnings": [""]',
    '}',
  ].join('\n');
}

export function buildUserPrompt(ocrText: string, hint?: string): string {
  const now = kstNow();
  return [
    `[기준 날짜] ${now.date} (${now.weekday}) ${now.time} Asia/Seoul`,
    hint ? `[사용자 메모] ${hint}` : '',
    '',
    '[입력 텍스트]',
    '"""',
    ocrText.slice(0, 12_000),
    '"""',
    '',
    '위 텍스트에서 일정과 목록을 추출해 JSON으로만 답하라.',
  ]
    .filter(Boolean)
    .join('\n');
}
