# 갤러리 저장소가 막히면 "없음"이 아니라 장애로 알린다 · 새 저장소로 옮김

확인일: 2026-10-27 · 선행: [채널 이원화·갤러리 코드](2026-06-28-channel-secondary-password.md), [직접 써 보며 찾은 버그](2026-10-07-hands-on-audit-fixes.md)(로컬 갤러리는 API 없을 때만)

## 결론

"갤러리 새로 만들기가 안 된다"는 문의의 원인은 Vercel Blob 저장소 `hwaeum-gallery2`(bps 무료 계정)가 사용 한도를 넘어 **정지**(`limits-exceeded-suspended`)된 것이었다.
정지된 저장소는 파일 목록(`list`)은 주지만, 파일 읽기(공개 주소·SDK `get` 모두)는 `403 Your store is blocked`, 쓰기(`put`)는 `This store has been suspended`로 막힌다.

옛 코드는 읽기 실패를 "없음"으로 바꿔 장애를 숨겼다.

- `loadChannelMeta()`가 `channel.json`을 못 읽으면 `null`(갤러리 없음)을 돌려줬다. 그래서 잠긴 갤러리가 코드 검사 없이 열리고, 작품 읽기도 하나하나 실패해 **빈 갤러리**로 보였다.
- 같은 `null` 때문에 `channel-claim`은 이미 있는 갤러리를 새 갤러리로 보고 **다른 선생님의 주인 정보를 덮어쓸 수 있었다**(정지 중에는 쓰기도 막혀 실제로 덮이지는 않았다).

두 가지를 정했다.

1. **코드: 못 읽음 ≠ 없음.** 목록에 있는 파일을 못 읽으면 예외로 올려 생성·공유·복사·삭제를 그 자리에서 멈춘다. 저장소 정지·연결 실패는 `503`과 쉬운 한국어로 알린다.
   - 정지: "갤러리 저장소 이용이 일시 중지되어 갤러리를 열거나 저장할 수 없어요. 관리자가 저장소 이용 상태를 확인해야 해요."
   - 연결 실패: "갤러리 저장소에 연결하지 못했어요. 잠시 뒤 다시 해 주세요."
   - 작품 목록에서 건너뛰는 것은 **깨진 JSON(`SyntaxError`) 하나**뿐이다.
2. **운영: 새 저장소로 옮기고 옛 데이터는 포기**(사용자 결정). 프로젝트 `hwaeum`을 dohyun 계정의 Pro 팀(`dohyuns-projects-e2679ecb`)으로 옮겼다.
   그 팀에 새 저장소 `hwaeum-gallery-dohyun-20261027`을 만들어 연결했다. 옛 갤러리 23개·작품 188개(파일 930개, 약 99 MB)는 새 저장소에 없으므로, 선생님이 갤러리를 다시 만들어야 한다.

## 비교

| 방법 | 결과 |
| --- | --- |
| 옛 저장소를 Pro 팀으로 이전 | Vercel이 거절(`400 Must be a member … on the target team`). bps 계정을 Pro 팀 멤버로 넣으면 유료 좌석이 늘어 "추가 비용 없이" 조건에 맞지 않음 |
| 정지 중 데이터를 복사해 옮기기 | 읽기가 모두 403이라 불가(목록만 남김: `output/transfer-20261027/blob-manifest-before.json`) |
| Vercel 지원팀에 무료 이전·읽기 허용 요청 | 초안만 작성, 보내지 않음(답을 기다리는 동안 갤러리를 못 씀) |
| **새 저장소 연결(채택)** | 바로 복구. 옛 데이터는 잃음 |

옛 저장소와 그 데이터는 지우지 않았다(bps 계정에 정지된 채 남아 있음). dohyun 팀의 다른 저장소 `hwaeum-share-prod`는 이번 일과 무관하므로 그대로 둔다.

## 적용 방향

- **서버**: `api/share/_utils.cjs`
  - `readJsonUrl()`: 403 `Your store is blocked`이면 `SHARE_STORAGE_SUSPENDED`, 그 밖의 HTTP·연결 실패는 `SHARE_STORAGE_UNAVAILABLE`로 바꿔 던진다. 깨진 JSON은 `SyntaxError` 그대로 던진다.
  - `loadChannelMeta()`: 목록에 없을 때만 `null`. 읽은 내용의 `channel`이 맞지 않으면 오류로 본다.
  - `sendError()`: 정지(코드·`@vercel/blob`의 "store has been suspended" 메시지)와 연결 실패는 `503`, 나머지는 `500`.
  - `api/share/channel.js`: 작품 읽기에서 `SyntaxError`만 건너뛴다.
- **브라우저**: `js/share-store.js`는 바꾸지 않았다. 이미 JSON 오류가 담긴 503은 그 문구를 보여 주고 로컬 갤러리로 빠지지 않는다(10-07 규칙).
- **연결 설정**: Vercel의 새 연결 창은 기본으로 `BLOB_STORE_ID`만 만든다. 앱의 `@vercel/blob` 2.6.1은 `BLOB_READ_WRITE_TOKEN`을 읽으므로 **"Add a read-write token env var to this connection"을 켜야 한다**. 토큰은 Sensitive이고 Production·Preview에만 있다. 연결한 뒤에는 **다시 배포해야** 새 토큰이 쓰인다.
- **배포**: 프로젝트가 dohyun 팀에 있으므로 Vercel CLI를 dohyun 계정으로 로그인해 배포한다. `.vercel/project.json`의 `orgId`는 `team_HEtn9lLEzSXDyOcokt6wD7nX`이다(프로젝트 ID는 그대로).
- **옛 작품 되살리기**(10-28 추가): Vercel에 정지 해제를 요청했다(지원 요청 `CSE_01smh5t2gIqUHj3y`). 무료 계정의 한도 초과 정지는 30일 뒤 풀린다고 문서에 있으므로, 늦어도 11월 말에는 다시 읽힌다.
  - 풀리면 `tools/migrate-gallery-store.cjs`로 옮긴다. 먼저 `backup`으로 930개를 `output/`에 받아 두고, 그다음 `upload`로 새 저장소에 올린다. 미리 보기 후 `--write`.
  - 그 사이 선생님이 같은 번호로 갤러리를 다시 만들었으면 다음 규칙을 따른다(`decideChannelConflict`).
    - 같은 브라우저(주인 해시)이거나 같은 갤러리 코드면, 새 갤러리 그대로 옛 작품을 합친다.
    - 둘 다 다르면 남의 반에 작품이 보이지 않게 건너뛰고 알린다.
  - 그래서 선생님께는 **옛 번호와 옛 코드 그대로** 다시 만들기를 권한다.
- **확인**: `test/share-storage-outage.test.js`가 다음을 검사한다.
  - 정지 저장소의 목록·생성은 503이고 아무것도 쓰지 않는다.
  - 권한 정보 읽기의 연결 실패·잘못된 정보도 덮어쓰기를 막는다.
  - 정말 없는 갤러리는 만들 수 있다.
  - 작품 읽기 실패는 빈 목록이 아니다.
  - 깨진 JSON 하나만 건너뛴다.
  - 잠긴 갤러리는 코드가 있어야 열린다.

  `test/share-store-fallback.test.js`는 정지 응답에서 로컬 갤러리로 빠지지 않는지 본다. 전체 `npm test` 435개 통과.
