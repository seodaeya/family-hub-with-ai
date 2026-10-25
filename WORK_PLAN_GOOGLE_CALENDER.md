# 🤖 Google Calendar 연동 프로젝트 계획서 (WORK_PLAN_GOOGLE_CALENDER.md)

## 📋 개요
이 계획서는 기존에 논의되었던 **C안 (허브 주도 양방향 동기화)** 을 기반으로 하며, 출시 안정성 및 보안을 최우선으로 고려하여 **A안 (수동 추가 버튼)** 을 선행 구현 후, 더 정교한 C안으로 전환하는 전략을 따릅니다. 목표는 가족 캘린더를 AI와 연동하는 것이지만, 민감한 클라우드 자격 증명을 모바일 앱(Expo Go)에서 직접 다루지 않도록 **허브(서버)** 중심의 아키텍처를 유지합니다.

---

## ✅ 확정된 설계 원칙
*   **캘린더**: 전용 캘린더 (`우리집 AI`)를 생성하여 사용. (기존 가족 캘린더와 분리).
*   **동기화 범위**: '일정'만 동기화 대상. 준비물/할 일 목록은 앱 내에 유지.
*   **반복 일정 처리**: **[READ-ONLY]** 구글의 반복 규칙을 180일치 단일 이벤트로 펼쳐 앱에 표시 (수동 변경 불가).
*   **핵심 보안**: 구글 서비스 계정 키는 **macOS 키체인**에 저장하고, 런타임 중에는 키체인에서만 읽음.
*   **키 유출 방지**: 전화기, Git, 앱 번들에는 절대로 민감 정보를 포함하지 않음.
*   **기본 동작**: 일정별 동기화 스위치를 껐을 때, **구글 사본을 삭제하지 않음** (안전성 우선).

---

## 🛠️ 프로젝트 진행 단계 (フェーズ)

### 🔷 Phase 0: 기반 다지기 및 인프라 구축 (🚨 **[Pre-requisite]**)
**목표**: 구글 API 연동에 필요한 환경(자격 증명, 캘린더)을 서버와 OS 레벨에서 완벽히 준비합니다.
**구현 주체**: 주로 **맥 허브(서버)** 작업.
**주요 작업**:
1.  **[GCP] 전용 캘린더 생성 및 권한 부여**:
    *   Google Cloud Project 생성.
    *   Calendar API 활성화.
    *   `우리집 AI` 전용 캘린더를 생성하고, 해당 캘린더를 서비스 계정에 **'Make changes to events'** 권한으로 공유.
2.  **[KEY] 서비스 계정 키 생성 및 키체인 등록**:
    *   서비스 계정 JSON 키 다운로드.
    *   키 내용을 안전하게 백업 후, **macOS 키체인에 등록**.
    *   `hub` 서버가 실행될 때 키체인에서 안전하게 키를 로드하도록 로직 보완.
3.  **[API] 헬스체크 훅 구현**:
    *   허브가 구글 캘린더와 통신할 수 있는지 체크하는 새로운 API 엔드포인트 (`/v1/google/health`)를 구현하고, 상태를 `useSession`에 추가.

### 🟢 Phase 1: A안 - 수동 추가 버튼 구현 (🚀 **[Quick Win]**)
**목표**: 클라우드 API 설정이 완료되기 전에, 사용자가 당장 활용할 수 있는 기능을 구현합니다.
**구현 주체**: `app/src/app/review.tsx`, `app/src/components/ui.tsx`.
**주요 작업**:
1.  **[UI] 구글 연동 스위치 추가**: `review.tsx`의 개별 항목(Item) 및 일정(Event) 상세 뷰에 '🔍 구글 캘린더에 추가' 스위치/칩 구현. (기본값: OFF).
2.  **[FUNC - CALL] 템플릿 URL 생성**: 사용자가 이 버튼을 누르면, `onPress` 핸들러가 항목/일정 데이터를 받아 구글 템플릿 URL을 동적으로 구성. (예: `?action=TEMPLATE&text=...`).
3.  **[OS] 외부 브라우저 띄우기**: 생성된 URL을 열어주는 로직 구현 (WebBrowser.openBrowser() 사용).
4.  **[README] 안내**: 이 기능은 수동 저장임을 명시하는 경고문 추가.

### 🟡 Phase 2: C안 - 양방향 DB 동기화 코어 (⚙️ **[Core Logic]**)
**목표**: 앱과 허브 간 일정 데이터의 실시간/지연 동기화 메커니즘을 완성합니다.
**구현 주체**: `app/src/lib/session.tsx`, `hub/src/db.ts`, `hub/src/server.ts`.
**주요 작업**:
1.  **[FIELD] 데이터 확장**: `events` 테이블 구조에 `externalId` (G Calendar ID), `externalEtag`, `googleLastSyncedAt` 필드 추가.
2.  **[READ] 구글 일정 Pull**:
    *   `hub` 서버에 새로운 API 엔드포인트 구현 (`/v1/google/pull`) - `syncToken` 기반 증감(Incremental) 로직 구현.
    *   `hub`가 Pull한 구글 일정을 DB에 저장하고, `externalId`로 매핑하여 `events` 테이블 업데이트.
    *   Pull된 이벤트에 'G (Google)' 배지 알림 로직 구현.
3.  **[WRITE] 로컬->구글 Push**:
    *   `app/src/lib/db.ts`의 `saveEvent` 후처리기에 구글 Push 요청 추가.
    *   `hub` 서버에 `PATCH` & `POST` 요청 처리 로직 구현. **`If-Match` (Etag) 기반 충돌 감지 로직** 구현.
4.  **[CONFLICT] 충돌 처리 로직**:
    *   Etag 충돌 시, 서버는 **DB의 `updatedAt`이 구글의 `lastSyncAt`보다 최신**인지 비교.
    *   최신인 쪽이 승리하고, 해당 일정에 '구글 수정됨' 워닝 플래그를 설정.
5.  **[RECURRING] 반복 일정 전개**:
    *   구글 Pull 시, 반복 규칙이 감지되면, 180일치 단일 이벤트를 생성(`events` 테이블에 `isRepetition: 0`).
    *   이 단일 일정에 `isRepetition: 1` 필드를 추가하여 '반복 패턴'임을 표시.

### 🔴 Phase 3: 안정화 및 마감 (🔒 **[Final Polish]**)
**목표**: 전체 시스템의 완성도를 높이고, 배포 가능한 상태로 만듭니다.
**구현 주체**: 전반적 수정 및 테스트.
**주요 작업**:
1.  **[UX] 선택적 동기화 구현**: 앱 UI에 '구글 동기화 스위치'를 완성하고, 스위치 상태에 따라 `saveEvent`의 로직을 분기.
2.  **[CLEAN] 안전성 강화**: 동기화 해제 시, 데이터 삭제 대신 '구글 사본 유지' 기본 정책을 완벽히 보장.
3.  **[TEST] 종합 검증**:
    *   **성공 케이스**: 로컬->구글->앱 (원활한 양방향)<br>
    *   **충돌 케이스**: 구글->로컬 (버전 1) $\rightarrow$ 로컬->구글 (버전 2) $\rightarrow$ 구글->로컬 (버전 3) 시, 3번이 승리하고 충돌 감지 로그가 남는지 확인.
    *   **실패 케이스**: 키체인 등록 실패, API Rate Limit(`429`) 시 백오프 구현 확인.
4.  **[DOC] 최종 문서화**: `README.md`에 구글 연동의 장단점, 설정 방법, 보안 정책을 상세히 기재.

---

## 📈 실행 완료 체크리스트
1.  **[✅] Phase 0 완료**: macOS 키체인 등록 스크립트(`npm run google:setup`), 키체인 전용 로더(`hub/src/google.ts`), `/v1/google/health` 및 `useSession` 연동 구현 완료.
2.  **[✅] Phase 1 완료**: `review.tsx` 및 `schedule.tsx`에 "🔍 구글 캘린더에 추가" 템플릿 URL 생성 및 외부 브라우저 연동(`app/src/lib/google-calendar.ts`) 구현 완료.
3.  **[✅] Phase 2 완료**: `events` 테이블 확장(`externalId`, `externalEtag`, `googleLastSyncedAt`, `googleSync`, `isRepetition`, `googleWarning`), `syncToken` 증분 Pull, 180일 반복 일정 전개(READ-ONLY), `If-Match`(ETag) 기반 충돌 해결 및 Push 구현 완료.
4.  **[✅] Phase 3 완료**: 일정별 구글 동기화 스위치(해제 시 구글 사본 보존 정책), `429`/`5xx` 지수 백오프 재시도, `README.md` 문서화 및 검증 완료.
