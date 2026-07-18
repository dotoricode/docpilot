# DocPilot 릴리즈 프로세스

DocPilot 릴리즈는 macOS 앱, GitHub Release, GitHub Pages 공개 매뉴얼과 Vercel 공개 매뉴얼을 하나의 배포 단위로 다룹니다.

## 배포 대상

| 대상 | 원본 | 공개 경로 |
|---|---|---|
| macOS 앱 | 저장소 루트와 `app/` | GitHub Release의 x64/arm64 DMG |
| 공개 매뉴얼 | `prototypes/manual-v2/` | `https://dotoricode.github.io/docpilot/` |
| 공개 매뉴얼 | `prototypes/manual-v2/` | `https://docpilot-manual.vercel.app/` |

`docs/`와 `prototypes/manual-v2/dist/`는 생성물입니다. 문구, 릴리즈 노트, 다운로드 동작과 스타일은 반드시 `prototypes/manual-v2/`에서 먼저 수정합니다.

## 1. 릴리즈 PR 준비

1. 루트 및 매뉴얼 package version을 동일하게 올립니다.
2. 앱의 release notice, `prototypes/manual-v2/src/releases.mjs`, changelog evidence와 버전별 릴리즈 노트를 갱신합니다.
3. x64/arm64 DMG 이름과 공개 다운로드 선택 흐름을 확인합니다.
4. 매뉴얼 계약과 production build를 실행합니다.

```bash
npm run manual:verify
```

Playwright Chromium 등 검증 의존성이 없으면 공식 설치 명령으로 준비하고 같은 검사를 다시 실행합니다.

## 2. Vercel Preview 검토

Vercel CLI 인증 계정은 `wpfhks-projects/docpilot-manual` 프로젝트 접근 권한이 필요합니다. 최초 한 번 프로젝트를 연결합니다. `.vercel/`은 로컬 상태이며 커밋하지 않습니다.

```bash
npm run manual:vercel:link
npm run manual:vercel:preview
```

출력된 Preview URL에서 다음을 확인합니다.

- Docs와 Changelog의 새 버전 문구
- Apple Silicon과 Intel Mac 다운로드 선택
- `/changelog/<version>/` 직접 접근
- 이미지, 동영상, 글꼴 및 모바일 레이아웃

Preview 확인 전에는 Production을 갱신하지 않습니다.

## 3. GitHub Pages 생성물 준비

승인된 매뉴얼 소스로 Pages build를 만들고 `docs/`에 반영합니다.

```bash
npm run manual:pages:stage
git diff -- docs prototypes/manual-v2
```

새 route, hashed JS/CSS와 필요한 media가 포함됐는지 확인한 뒤 릴리즈 PR에 함께 커밋합니다.

## 4. 앱 및 패키지 게이트

```bash
npm run renderer:typecheck
npm test
npm run check:shutdown
npm run check:terminal:create
npm run check:renderer-security
npm audit --audit-level=low
npm run build
node scripts/check-packaged-app.js
DOCPILOT_ELECTRON_EXECUTABLE='dist/package/mac/DocPilot.app/Contents/MacOS/DocPilot' npm run check:terminal:create
```

마지막 명령은 패키지 내부 `node-pty`가 실제 `app.asar.unpacked`의 `spawn-helper`로 셸을 생성하는지 확인하므로 생략하지 않습니다. 가능하면 Intel 호스트에서 x64, Apple Silicon 호스트에서 arm64 packaged smoke를 각각 실행합니다. DMG별 SHA-256을 릴리즈 노트에 기록합니다.

## 5. 병합, 태그와 GitHub Release

1. 릴리즈 PR을 main에 병합합니다.
2. 검증한 tree와 main tree가 같은지 확인합니다.
3. `v<version>` annotated tag를 main 병합 커밋에 생성합니다.
4. Draft GitHub Release에 x64/arm64 DMG와 blockmap을 업로드합니다.
5. GitHub가 계산한 asset digest와 로컬 SHA-256을 비교합니다.
6. Draft를 Latest Release로 게시합니다.

기존 태그를 이동하거나 공개 DMG를 같은 이름으로 교체하지 않습니다. 결함은 다음 patch version으로 수정합니다.

## 6. Vercel Production 배포

GitHub Release 자산이 공개된 뒤 같은 main tree에서 Vercel Production을 배포합니다.

```bash
npm run manual:vercel:production
```

이 명령은 루트 `vercel.json`을 사용해 `prototypes/manual-v2`를 설치·빌드하고 `docpilot-manual` Production domain을 새 배포로 전환합니다. 토큰이나 project ID를 저장소에 기록하지 않습니다.

## 7. 공개 경로 최종 검증

GitHub Pages workflow와 Vercel Production이 모두 Ready인 것을 확인한 뒤 다음 명령을 실행합니다.

```bash
npm run manual:verify:public
```

검사는 두 공개 경로에서 현재 버전 bundle, 버전별 Changelog, arm64/x64 선택 문구를 확인하고 Latest GitHub Release에 두 DMG가 있는지 검증합니다.

## 8. Vercel 롤백

Vercel 매뉴얼만 잘못 배포됐다면 직전 정상 deployment URL 또는 ID로 alias를 되돌립니다.

```bash
npx --yes vercel@56.3.1 rollback <deployment-url-or-id> --yes --scope wpfhks-projects
npm run manual:verify:public
```

앱 릴리즈 자체의 문제라면 Vercel만 되돌려 숨기지 않고 새 patch release를 준비합니다.
