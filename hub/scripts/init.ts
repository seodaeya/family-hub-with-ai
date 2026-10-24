import { networkInterfaces } from 'node:os';
import { createFamily, createPairingCode, firstFamily, getMeta, setMeta } from '../src/db.ts';
import { config } from '../src/config.ts';

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const name = arg('--family') ?? '우리 가족';

let family = firstFamily();
if (family) {
  console.log(`이미 가족이 있습니다: ${family.name} (${family.id})`);
} else {
  family = createFamily(name);
  console.log(`가족을 만들었습니다: ${family.name} (${family.id})`);
}

const ttlHours = Number(arg('--hours') ?? 24);
const code = createPairingCode({
  familyId: family.id,
  kind: 'bootstrap',
  ttlMs: ttlHours * 60 * 60 * 1000,
});
setMeta('initializedAt', String(Date.now()));

const addresses = lanAddresses();
console.log('');
console.log('──────────────────────────────────────────────');
console.log('  첫 기기 연결 코드 (부모 기기로 등록됩니다)');
console.log('');
console.log(`      ${code.code}`);
console.log('');
console.log(`  유효 시간: ${ttlHours}시간`);
console.log('');
console.log('  앱 → "서버 연결" 에서 아래 주소를 입력하세요:');
for (const address of addresses) console.log(`      http://${address}:${config.port}`);
console.log('');
console.log('  같은 Wi-Fi가 아니면 Tailscale 주소를 사용하세요:');
console.log('      tailscale ip -4   (100.x.y.z)');
console.log('──────────────────────────────────────────────');
if (getMeta('initializedAt')) {
  console.log('\n이 코드는 한 번만 사용할 수 있습니다. 새 기기는 앱의 "기기 관리"에서 초대하세요.');
}

function lanAddresses(): string[] {
  const out: string[] = ['127.0.0.1'];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}
