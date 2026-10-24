import { createPairingCode, firstFamily } from '../src/db.ts';

const family = firstFamily();
if (!family) {
  console.error('먼저 `npm run init` 을 실행하세요.');
  process.exit(1);
}

const minutes = Number(process.argv[2] ?? 10);
const code = createPairingCode({
  familyId: family.id,
  kind: 'invite',
  ttlMs: minutes * 60_000,
});

console.log(`초대 코드: ${code.code}  (${minutes}분 유효)`);
console.log('앱 → 설정 → 기기 관리 → 기기 추가 에서 입력하세요. 승인 후 사용할 수 있습니다.');
