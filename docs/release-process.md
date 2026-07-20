# DocPilot 릴리즈 프로세스

DocPilot 릴리즈는 macOS 앱, GitHub Release, GitHub Pages 공개 매뉴얼과 Vercel 공개 매뉴얼을 하나의 배포 단위로 다룹니다.

현재 공개 빌드는 Developer ID 서명과 Apple 공증이 없는 ad-hoc 배포입니다. 따라서 앱은 새 DMG의 다운로드와 SHA-256 검증, DMG 열기까지만 수행합니다. 자동 종료, Applications 교체, 자동 재시작은 릴리즈 기능으로 제공하거나 성공했다고 표현하지 않습니다.

미서명·미공증 빌드를 배포할 때는 모든 공개 설치 안내에 Apple 공식 첫 실행 절차를 반드시 제공합니다. 사용자가 Applications의 DocPilot을 한 번 실행해 차단 상태를 만든 다음 `시스템 설정 → 개인정보 보호 및 보안 → 확인 없이 열기`를 누르고, 다시 나타난 경고에서 `열기`를 선택하도록 안내합니다. `xattr`, `spctl --master-disable` 또는 Gatekeeper 전체 비활성화 같은 터미널 우회 방법은 제공하지 않습니다.

## 배포 대상

| 대상 | 원본 | 공개 경로 |
|---|---|---|
| macOS 앱 | 저장소 루트와 `app/` | GitHub Release의 x64/arm64 DMG |
| 공개 매뉴얼 | `prototypes/manual-v2/` | `https://dotoricode.github.io/docpilot/` |
| 공개 매뉴얼 | `prototypes/manual-v2/` | `https://docpilot-manual.vercel.app/` |

`docs/`와 `prototypes/manual-v2/dist/`는 생성물입니다. 문구, 릴리즈 노트, 다운로드 동작과 스타일은 반드시 `prototypes/manual-v2/`에서 먼저 수정합니다.

## 버전 상태를 판단하는 기준

| 확인하려는 상태 | 기준 |
|---|---|
| 코드가 병합됐는가 | GitHub PR과 `main` commit |
| 앱이 공개됐는가 | GitHub **Latest Release** tag와 x64/arm64 DMG |
| 설치된 앱 버전 | About DocPilot과 앱 bundle의 `CFBundleShortVersionString` |
| 매뉴얼이 배포됐는가 | GitHub Pages/Vercel deployment |
| 매뉴얼 Download가 가리키는 앱 | GitHub Latest Release의 공개 DMG |

매뉴얼 Production이 새로 배포돼도 GitHub Latest Release가 이전 버전이면 Download는 이전 DMG를 내려받습니다. package version이나 매뉴얼 화면에 표시되는 릴리즈 후보만 보고 앱 배포가 완료됐다고 판단하지 않습니다.

## 1. 릴리즈 PR 준비

1. 루트 및 매뉴얼 package version을 동일하게 올립니다.
2. 앱의 release notice, `prototypes/manual-v2/src/releases.mjs`, changelog evidence와 버전별 릴리즈 노트를 갱신합니다. 공개 전 항목은 `unreleased: true`인 릴리즈 후보로 둡니다.
3. x64/arm64 DMG 이름과 공개 다운로드 선택 흐름을 확인합니다.
4. 앱 내부 업데이트가 공식 repository, 더 높은 stable semver, 현재 arch, 정확한 DMG 이름, 허용 크기와 GitHub SHA-256 digest만 허용하는지 확인합니다.
5. Developer ID 서명과 Apple 공증이 없다면 설치 페이지, 업데이트 페이지와 릴리즈 노트에 `확인 없이 열기` 공식 UI 절차가 있고 터미널 우회 명령은 없는지 확인합니다.
6. 매뉴얼 계약과 production build를 실행합니다.

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
- 설치 페이지의 `시스템 설정 → 개인정보 보호 및 보안 → 확인 없이 열기` 절차
- `/changelog/<version>/` 직접 접근
- 이미지, 동영상, 글꼴 및 모바일 레이아웃

Preview 확인 전에는 Production을 갱신하지 않습니다.

Preview는 앱 공개가 아닙니다. 이 단계에서 앱의 업데이트 카드나 공개 매뉴얼 Download가 새 버전을 제공할 것이라고 안내하지 않습니다.

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
npm run check:update-flow
npm run check:renderer-security
npm audit --audit-level=low
npm run build
node scripts/check-packaged-app.js
DOCPILOT_ELECTRON_EXECUTABLE='dist/package/mac/DocPilot.app/Contents/MacOS/DocPilot' npm run check:terminal:create
```

`check-packaged-app.js`는 x64/arm64 DMG를 각각 마운트해 bundle version과 앱/volume ICNS의 alpha를 검사합니다. 설치 화면에서 아이콘 바깥쪽 검은 사각형이 없는지도 Finder에서 직접 확인합니다.

마지막 명령은 패키지 내부 `node-pty`가 실제 `app.asar.unpacked`의 `spawn-helper`로 셸을 생성하는지 확인하므로 생략하지 않습니다. 가능하면 Intel 호스트에서 x64, Apple Silicon 호스트에서 arm64 packaged smoke를 각각 실행합니다. DMG별 SHA-256을 릴리즈 노트에 기록합니다.

서명 게이트는 현재 `codesign --verify --deep --strict`로 ad-hoc signature의 구조적 무결성을 확인합니다. Developer ID identity, hardened runtime과 notarization이 준비되지 않은 상태에서 Sparkle, Squirrel, `electron-updater`, `quitAndInstall()` 기반 자동 설치로 전환하지 않습니다.

## 5. 병합, 태그와 GitHub Release

1. `unreleased: true`인 릴리즈 후보 PR을 main에 병합합니다.
2. 검증한 tree와 main tree가 같은지 확인합니다.
3. 매뉴얼 소스의 `unreleased: true`를 제거하고 evidence를 `release`로 바꾸는 작은 릴리즈 확정 PR을 열어 병합합니다.
4. 확정 PR의 main 병합 커밋을 다시 검증합니다.
5. `v<version>` annotated tag를 그 main 병합 커밋에 생성합니다.
6. Draft GitHub Release에 x64/arm64 DMG와 blockmap을 업로드합니다.
7. GitHub가 계산한 각 asset의 `sha256:` digest와 로컬 SHA-256을 비교합니다. digest가 없거나 다르면 게시하지 않습니다.
8. Draft를 Latest Release로 게시합니다.
9. GitHub API의 Latest Release tag, 두 DMG 이름과 bundle version을 다시 확인합니다.

기존 태그를 이동하거나 공개 DMG를 같은 이름으로 교체하지 않습니다. 결함은 다음 patch version으로 수정합니다.

Latest Release 게시 전에는 이전 버전 앱이 새 버전을 감지하지 않으며, 공개 매뉴얼 Download도 새 DMG를 선택하지 않습니다. 이것이 정상적인 승인 경계입니다.

## 6. Vercel Production 배포

GitHub Release 자산이 공개된 뒤 같은 main tree에서 GitHub Pages와 Vercel Production을 배포합니다.

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

이후 두 아키텍처 중 현재 Mac에 맞는 DMG를 공개 매뉴얼에서 실제로 내려받아 다음을 확인합니다.

- DMG 안의 About/bundle version이 Latest Release tag와 같은가
- New terminal이 기본 로그인 셸을 생성하는가
- 설치 화면과 Dock 아이콘 바깥쪽에 검은 사각 배경이 없는가
- Finder와 DMG 설치 화면의 앱 아이콘 바깥쪽에 불필요한 밝은 림이나 외곽 그림자가 없는가
- GitHub Pages와 Vercel 설치 페이지에 `확인 없이 열기` 절차가 있고 터미널 Gatekeeper 우회 명령이 없는가
- 이전 버전에서 업데이트 카드가 나타나고 다운로드 완료 뒤에도 terminal·agent·미저장 문서가 유지되는가
- `DMG 열기`가 앱을 자동 종료하거나 기존 Applications 앱을 자동 교체하지 않는가

## 8. Vercel 롤백

Vercel 매뉴얼만 잘못 배포됐다면 직전 정상 deployment URL 또는 ID로 alias를 되돌립니다.

```bash
npx --yes vercel@56.3.1 rollback <deployment-url-or-id> --yes --scope wpfhks-projects
npm run manual:verify:public
```

앱 릴리즈 자체의 문제라면 Vercel만 되돌려 숨기지 않고 새 patch release를 준비합니다.
