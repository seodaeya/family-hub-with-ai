# 우리집 AI (family-hub-with-ai)

가족을 위한 **로컬 우선(local-first)** AI 앱. 안내문 사진·문자를 넣으면 일정/준비물/장보기 목록으로 정리하고, 가족 기기끼리 집 안의 맥을 통해 동기화합니다.

**사진과 글은 집 밖으로 나가지 않습니다.** OCR은 macOS Apple Vision, 요약은 Ollama 로컬 모델이 맥에서 처리합니다.

---

## 구성

```
iPhone / Android (Expo Go)
        │  같은 Wi-Fi 또는 Tailscale
        ▼
홈 Mac ── hub (Fastify + SQLite)
          ├─ /v1/sync     변경분 push/pull (오프라인 큐 지원)
          ├─ /v1/extract  사진 → Apple Vision OCR → 로컬 LLM → 구조화 JSON
          └─ /v1/devices  기기 승인 · 해제 (허용 기기만 접근)
```

- **오프라인 우선**: 맥이 꺼져 있어도 폰에서 일정·목록을 모두 사용할 수 있고, 다시 연결되면 밀린 변경분을 한 번에 주고받습니다.
- **허용 기기제**: 첫 기기는 부팅 코드로 등록되고, 이후 기기는 초대 코드 → **보호자 승인** 후에만 접근할 수 있습니다. 해제는 즉시 적용됩니다.
- **사진 정책**: 기본은 분석 후 삭제. 보관 기간(즉시/7일/30일/계속)과 품질(간단 50·75·100% 또는 상세 슬라이더)을 설정에서 조절합니다.
- **AI 폴백**: 인식이 어려우면 ① 다시 촬영 ② 직접 입력 ③ 외부 AI에 사진 공유 후 결과 붙여넣기 ④ 나중에 처리.

## 폴더

| 경로 | 설명 |
|---|---|
| `app/` | Expo(React Native) 앱. Expo Go로 iOS·Android 동시 테스트 |
| `hub/` | 맥에서 도는 서버. 동기화 + AI 파이프라인 |
| `ocr/` | Apple Vision OCR CLI (Swift, 온디바이스) |
| `docs/` | 보안·운영 문서 |

---

## 준비물

- macOS (Apple Silicon 권장), Node 22+ (개발 환경은 26), Ollama
- 폰: Expo Go 앱 (App Store / Play Store)
- (선택) Tailscale — 집 밖에서 접속할 때

```bash
# 로컬 모델 (이미 있으면 생략)
ollama pull gemma4:e4b            # 빠른 모드 (기본)
ollama pull qwen2.5:14b-instruct  # 정확 모드
```

## 처음 실행

```bash
# 1) OCR CLI 빌드
cd ocr && ./build.sh && cd ..

# 2) 허브 의존성 + 가족 생성 + 첫 기기 코드
cd hub
npm install
npm run init -- --family "우리 가족"
```

`npm run init` 이 아래를 출력합니다.

```
첫 기기 연결 코드: EKTQBP3D   (24시간 유효)
http://192.168.0.10:4317
```

```bash
# 3) 허브 실행 (맥이 켜져 있는 동안)
npm start
```

처음 실행하면 macOS가 "들어오는 연결을 허용할까요?"라고 물을 수 있습니다. **허용**을 선택해야 폰에서 접속됩니다.

```bash
# 4) 앱 실행
cd ../app
npx expo start
```

폰의 Expo Go로 QR을 찍고, 앱에서 **서버 주소 + 연결 코드**를 입력합니다.

> 첫 기기는 **부모 기기**로 등록됩니다. 이후 기기는 `설정 → 기기 관리 → 초대 코드 만들기` 로 코드를 발급하고, 새 기기에서 입력한 뒤 **보호자 기기에서 승인**해야 합니다.

## 매일 쓰는 흐름

1. 홈 → **사진으로 추가** → 안내문 촬영/선택
2. AI가 6~15초 뒤 일정·준비물·장보기 초안을 만듦
3. **검토 화면**에서 항목 선택·수정 후 저장
4. 가족 기기와 동기화, 일정 알림 자동 예약
5. 목록에서 체크하면 다른 기기에도 반영

## 자주 쓰는 명령

```bash
cd hub
npm run doctor      # OCR·모델·DB·기기 상태 점검
npm run invite 30   # CLI로 초대 코드 발급 (30분)
npm run dev         # 파일 변경 시 자동 재시작
node scripts/bench.ts /tmp/notice.png   # 모델 속도·품질 비교
```

## 집 밖에서 접속 (선택)

1. 맥과 폰에 Tailscale 설치, 같은 계정으로 로그인
2. 맥에서 HTTPS 활성화 후 프록시:

```bash
tailscale serve --bg 4317
tailscale ip -4          # 100.x.y.z 주소를 앱 서버 주소로 사용
```

3. 앱 서버 주소를 `http://100.x.y.z:4317` 로 변경 (또는 serve 주소)

자세한 보안 설정은 [docs/SECURITY.md](docs/SECURITY.md) 참고.

## 상시 실행 (launchd)

```bash
cd hub
./scripts/install-service.sh     # 로그인 시 자동 시작 + 죽으면 재시작
./scripts/uninstall-service.sh   # 해제
tail -f data/hub.log
```

맥이 잠자기로 들어가면 접속이 끊깁니다. 전원 연결 + `시스템 설정 → 잠자기 방지` 또는 `caffeinate -s` 를 권장합니다.

## 문제 해결

| 증상 | 확인 |
|---|---|
| 앱이 서버를 못 찾음 | 맥과 폰이 같은 Wi-Fi인지, `npm start` 중인지, 주소의 IP가 맞는지 |
| `보호자 승인 대기` | 보호자 기기 → 기기 관리 → 승인 |
| AI가 느림 | 정확 모드(14B)는 30초 이상 걸립니다. 빠른 모드로 전환 |
| 모델 없음 | `ollama pull gemma4:e4b` |
| OCR 실패 | `cd ocr && ./build.sh` 로 바이너리 재빌드 |
| 사진이 안 읽힘 | 폴백에서 프롬프트 복사 → 외부 AI → 결과 붙여넣기 |
| 앱이 시작하자마자 빨간 화면 | Expo Go에 없는 네이티브 모듈 문제. 알림은 자동으로 건너뛰도록 처리되어 있으니 최신 코드로 다시 실행 |
| 일정 알림이 안 옴 | 이 빌드에서는 알림을 꺼두었습니다(Expo Go에 필요한 네이티브 모듈이 없음). 앱은 정상 사용 가능하고, 개발 빌드에서 다시 켤 수 있습니다 (`app/src/lib/notify.ts` 주석 참고) |

## 로드맵

- [ ] 음성 입력 (Whisper 로컬)
- [ ] 추억 앨범 + 자동 태깅
- [ ] 아이 모드(PIN)와 연령별 답변 정책
- [ ] 워치: 알림 확인 · 오늘 일정 · 음성 메모
- [ ] 가족 구성원별 담당자 지정
