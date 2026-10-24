# 우리집 AI — 앱

Expo(React Native) 클라이언트입니다. 전체 설명은 상위 [README](../README.md)를 보세요.

```bash
npx expo start          # Expo Go로 실행 (iOS/Android)
```

## 구조

```
src/
├── app/                 화면 (expo-router)
│   ├── index.tsx        홈
│   ├── capture.tsx      사진/문자 → AI 분석
│   ├── review.tsx       분석 결과 검토·저장
│   ├── schedule.tsx     일정
│   ├── lists.tsx        장보기·준비물·할 일
│   ├── settings.tsx     설정
│   ├── devices.tsx      기기 승인/해제, 초대 코드
│   ├── photo-settings.tsx  사진 품질·보관 정책
│   ├── pair.tsx         서버 연결
│   └── pending.tsx      보호자 승인 대기
├── components/          UI 키트, 하단 탭
├── lib/
│   ├── db.ts            SQLite + outbox (오프라인 우선)
│   ├── session.tsx      연결 상태, 자동 동기화
│   ├── api.ts           허브 HTTP 클라이언트
│   ├── photo.ts         리사이즈·보관 정책
│   ├── notify.ts        로컬 알림 예약
│   └── format.ts        한국어 날짜/시간
└── theme.ts
```

## 원칙

- 사진은 **전송 전에 기기에서 축소**합니다 (`lib/photo.ts`). 원본은 설정에 따라서만 보관합니다.
- 모든 쓰기는 **먼저 로컬 DB + outbox** 에 기록하고, 서버가 있으면 밀어 올립니다. 맥이 꺼져 있어도 동작합니다.
- AI 결과는 절대 자동 저장하지 않습니다. 항상 검토 화면을 거칩니다.
