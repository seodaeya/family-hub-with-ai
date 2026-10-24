import { createPairingCode, firstFamily, listDevices } from '../src/db.ts';

// Recovery path: physical access to the Mac can mint a new parent device code.
// Use this if the original parent phone is lost.

const family = firstFamily();
if (!family) {
  console.error('먼저 `npm run init` 을 실행하세요.');
  process.exit(1);
}

const hours = Number(process.argv[2] ?? 1);
const code = createPairingCode({
  familyId: family.id,
  kind: 'bootstrap',
  ttlMs: hours * 60 * 60 * 1000,
});

const devices = listDevices(family.id);
console.log(`가족: ${family.name}`);
console.log(`부모 기기 코드: ${code.code}  (${hours}시간 유효)`);
console.log(`현재 기기: ${devices.map((device) => `${device.name}(${device.status})`).join(', ')}`);
console.log('이 코드로 연결하면 보호자 권한을 가진 기기로 등록됩니다. Mac에 직접 접근한 사람만 실행할 수 있습니다.');
