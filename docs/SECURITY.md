# 보안 설계

## 경계

```
[폰]  ── HTTP(같은 Wi-Fi) / HTTPS·WireGuard(Tailscale) ──  [맥: hub]  ──  [Ollama / Apple Vision]
```

- 사진과 OCR 텍스트는 **맥 밖으로 나가지 않습니다.** 외부 AI는 사용자가 폴백 화면에서 명시적으로 선택할 때만 동작합니다.
- 클라우드 계정, 광고 SDK, 분석 도구가 없습니다.
- 허브 자체는 **TLS를 종료하지 않습니다.** 같은 Wi-Fi에서는 HTTP 평문이므로, 신뢰할 수 없는 네트워크에서는 Tailscale 또는 `tailscale serve` HTTPS를 사용하세요.

## 기기 허용제

| 단계 | 동작 |
|---|---|
| 첫 기기 | `npm run init` 이 만든 **8자리 부팅 코드**(24시간, 1회용)로 등록 → 부모 기기 |
| 추가 기기 | 보호자 기기에서 만든 **6자리 초대 코드**(10분, 1회용) 입력 → `pending` |
| 승인 | 보호자 기기의 기기 관리 화면에서 승인해야 `/v1/sync`, `/v1/extract` 접근 가능 |
| 해제 | 즉시 `/v1/*` 전체 거부 (토큰 해시는 DB에 남지만 상태가 `revoked`) |

- 모든 요청은 `Authorization: Bearer <32바이트 난수>`.
- 서버는 토큰을 **SHA-256 해시로만** 저장합니다. 원문은 폰의 `expo-secure-store`(Keychain/Keystore)에만 있습니다.
- 미승인 기기는 `/v1/me` 만 조회할 수 있어 승인 여부를 확인합니다.

## 네트워크

- 기본 바인딩은 `0.0.0.0`(같은 Wi-Fi의 기기에서 접속 허용)입니다. 공유기 밖으로 노출되지 않도록 macOS 방화벽에서 외부 인터페이스를 막아두세요.
- **공인 IP 포트 개방 금지.** 외부 접속이 필요하면 Tailscale(WireGuard)을 사용하세요.
- 같은 Wi-Fi 구간은 기본적으로 **HTTP 평문**입니다. 허브는 TLS 인증서를 직접 관리하지 않습니다. HTTPS가 필요하면 `tailscale serve --bg 4317` 로 Tailscale이 TLS를 종료하게 하고, 앱에는 `https://<맥이름>.<tailnet>.ts.net` 주소를 넣으세요.
- CORS는 `localhost`·사설 대역·Tailscale 대역에서 온 웹 빌드만 허용합니다. 네이티브 앱은 Origin 헤더를 보내지 않아 영향이 없습니다.
- Tailscale 사용 시:
  - 계정 2단계 인증 필수
  - 콘솔에서 **Tailnet Lock** 활성화 (승인된 기기만 가입)
  - 기기 키 만료를 90일로 설정
  - ACL 예시:

```json
{
  "acls": [
    { "action": "accept", "src": ["tag:phone"], "dst": ["tag:hub:4317"] },
    { "action": "accept", "src": ["tag:hub"], "dst": ["tag:phone:*"] }
  ],
  "tagOwners": { "tag:phone": ["autogroup:admin"], "tag:hub": ["autogroup:admin"] }
}
```

## 사진 처리

- 앱에서 **먼저 축소**(기본 원본의 75%)한 뒤 전송합니다.
- 허브는 이미지를 `data/tmp`에 임시 저장 후 OCR 직후 삭제합니다.
- "맥에 보관"을 켠 경우에만 `data/photos`에 남고, 보관 기간이 지나면 자동 삭제됩니다.
- 보관된 사진은 인증된 기기만 `/v1/photos/:id`로 열람할 수 있습니다.
- EXIF(GPS 등)는 리사이즈 과정에서 제거됩니다.

## 데이터 보관·삭제

| 데이터 | 위치 | 삭제 방법 |
|---|---|---|
| 일정·목록 | 폰 SQLite + 맥 `data/hub.db` | 앱에서 항목 삭제(소프트 삭제) |
| 사진 | 설정에 따름 | 보관 기간 만료 시 자동, 또는 `data/photos` 직접 삭제 |
| 기기 토큰 | 폰 SecureStore / 맥 해시 | 기기 해제 또는 연결 해제 |
| 감사 로그 | 맥 `audit_logs` | DB에서 수동 삭제 |

전체 삭제: 허브를 멈추고 `hub/data/` 를 삭제한 뒤 `npm run init` 부터 다시 시작합니다.

## 백업

- `hub/data/hub.db` 가 단일 원본입니다. Time Machine 또는 주 1회 `앱 → 설정 → 가족 데이터 내보내기` 로 JSON 백업을 권장합니다.
- 백업 파일에는 가족 일정이 평문으로 들어갑니다. 안전한 위치에 보관하세요.

## 알려진 한계

- 맥에 로그인할 수 있는 사람은 DB를 직접 읽을 수 있습니다. Mac 계정 잠금 + FileVault 필수.
- **전송 구간**: 허브는 TLS를 직접 종료하지 않습니다. 같은 Wi-Fi에서 기본값은 **HTTP 평문**이므로, 같은 공유기를 쓰는 다른 기기가 Bearer 토큰과 사진을 스니핑할 수 있습니다. 집 밖에서는 Tailscale(WireGuard)로 암호화되고, HTTPS가 필요하면 `tailscale serve`를 쓰세요. 신뢰할 수 없는 Wi-Fi(카페·호텔)에서는 허브를 켜지 마세요.
- 허브 메모리 안에서는 평문입니다(로컬 AI 처리 특성).
- 폰을 잃어버리면 기기 해제 전까지 접근 가능합니다. 화면 잠금과 즉시 해제를 권장합니다.
- 아동 데이터: 이름은 닉네임, 생일은 연도만 저장하는 설계를 권장합니다. 만 14세 미만 아동의 정보를 다룰 때는 보호자 동의를 받으세요.
