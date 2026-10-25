import { readFile } from 'node:fs/promises';
import {
  deleteGoogleCredentialsFromKeychain,
  googleHealthCheck,
  KEYCHAIN_ACCOUNT,
  KEYCHAIN_SERVICE,
  loadGoogleCredentialsFromKeychain,
  saveGoogleCredentialsToKeychain,
} from '../src/google.ts';
import { firstFamily, setMeta } from '../src/db.ts';

function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const wantsClear = process.argv.includes('--clear');
const wantsStatus = process.argv.includes('--status');
const keyPath = arg('--key');
const calendarId = arg('--calendar');

if (wantsClear) {
  await deleteGoogleCredentialsFromKeychain();
  const fam = firstFamily();
  if (fam) setMeta(`google.syncToken.${fam.id}`, '');
  console.log('✓ macOS 키체인에서 구글 서비스 계정 정보를 삭제했습니다.');
  process.exit(0);
}

if (wantsStatus || (!keyPath && !calendarId)) {
  const existing = await loadGoogleCredentialsFromKeychain();
  if (!existing) {
    console.log('\n[구글 캘린더 키체인 미등록]');
    console.log('사용법:');
    console.log('  npm run google:setup -- --key /path/to/service-account.json --calendar <캘린더ID>');
    console.log('  npm run google:setup -- --status   (연결 상태 확인)');
    console.log('  npm run google:setup -- --clear    (키체인에서 삭제)\n');
    process.exit(wantsStatus ? 0 : 1);
  }
  const health = await googleHealthCheck(firstFamily()?.id);
  console.log('\n──────────────────────────────────────────────');
  console.log(`  키체인 서비스: ${KEYCHAIN_SERVICE} (${KEYCHAIN_ACCOUNT})`);
  console.log(`  서비스 계정:   ${health.serviceAccountEmail}`);
  console.log(`  캘린더 ID:     ${health.calendarIdMasked}`);
  console.log(`  연결 상태:     ${health.ok ? `✓ 정상 (${health.calendarSummary})` : `✗ 오류 (${health.error})`}`);
  console.log('──────────────────────────────────────────────\n');
  process.exit(health.ok ? 0 : 1);
}

if (!keyPath || !calendarId) {
  console.error('오류: --key <서비스계정.json> 과 --calendar <캘린더ID> 를 모두 지정해 주세요.');
  process.exit(1);
}

const rawJson = await readFile(keyPath, 'utf8');
const parsed = JSON.parse(rawJson) as {
  client_email?: string;
  private_key?: string;
  project_id?: string;
  token_uri?: string;
};

if (!parsed.client_email || !parsed.private_key) {
  console.error('오류: 올바른 Google 서비스 계정 JSON 파일이 아닙니다 (client_email / private_key 누락).');
  process.exit(1);
}

await saveGoogleCredentialsToKeychain({
  calendarId: calendarId.trim(),
  clientEmail: parsed.client_email.trim(),
  privateKey: parsed.private_key,
  projectId: parsed.project_id,
  tokenUri: parsed.token_uri,
});

const family = firstFamily();
if (family) {
  setMeta(`google.syncToken.${family.id}`, '');
}

console.log('✓ macOS 키체인에 구글 서비스 계정 자격 증명을 등록했습니다.');
console.log('  원본 JSON 파일은 안전한 곳에 백업 후 디스크에서 삭제하셔도 됩니다.\n');

const check = await googleHealthCheck(family?.id);
if (check.ok) {
  console.log(`✓ 구글 캘린더 연결 확인 완료: "${check.calendarSummary}" (${check.calendarIdMasked})`);
} else {
  console.warn(`⚠ 키체인은 등록되었으나 캘린더 접근 확인에 실패했습니다: ${check.error}`);
  console.warn(`  구글 캘린더 설정에서 "${parsed.client_email}" 계정에 '일정 변경 권한'을 공유했는지 확인하세요.`);
  process.exit(1);
}
