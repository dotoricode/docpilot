export const RELEASES_ENDPOINT = 'https://api.github.com/repos/dotoricode/docpilot/releases';

export const FALLBACK_RELEASES = Object.freeze([
  {
    version: '2.0.5',
    title: 'DocPilot 2.0.5',
    date: '2026-07-19',
    summary: '렌더링된 Markdown을 Document에서 바로 편집하고, 앱 안에서 최신 버전을 명시적으로 확인하며 좁은 터미널·프리뷰 레이아웃을 개선했습니다.',
    body: `## Added
- Markdown Document에서 렌더링된 결과에 직접 커서를 놓고 제목, 목록, 작업 목록, 인용, 표, 코드, 링크, 이미지, Mermaid와 수식을 편집할 수 있습니다.
- 공식 GitHub Release의 최신 버전을 앱 안에서 명시적으로 확인하고 현재 Mac 아키텍처의 검증된 DMG를 내려받을 수 있습니다.
- Agent Copy를 켜면 선택한 문서 블록과 원문 위치를 터미널 Agent에 전달하기 좋은 형태로 복사할 수 있습니다.

## Changed
- Markdown의 Visual 편집 흐름을 Source와 Document 중심으로 단순화하고, 안전하게 원문을 보존할 수 없는 문서는 읽기 전용으로 엽니다.
- #, ##, ###, -, 번호, 작업 목록, 인용과 표 입력을 블록으로 전환하며 Tab과 Shift+Tab으로 목록 깊이를 조절합니다.
- Document 명령 메뉴는 사용 가능한 위·아래 공간을 계산해 터미널에 가려지지 않는 방향으로 열립니다.

## Fixed
- macOS 한국어 입력기 조합 뒤에도 Markdown 블록 단축 입력이 문자로 남지 않고 의도한 블록으로 변환됩니다.
- 빈 목록 항목의 글머리 기호가 CSS 초기화로 사라지던 문제를 수정했습니다.
- 좁은 터미널 탭에 불필요한 스크롤이 생기거나 NOTE·IMPORTANT 레이블이 본문과 겹치던 문제를 수정했습니다.
- Finder와 DMG 설치 화면에서 앱 아이콘 바깥쪽에 보이던 밝은 외곽 림과 그림자를 제거했습니다.

## Upgrade notes
- 원문과 동일한 Markdown 구조를 증명할 수 없는 고급 문법 또는 매우 큰 문서는 Source와 읽기 전용 Preview를 사용합니다.
- 이 공개 빌드는 Developer ID 서명과 Apple 공증이 없는 ad-hoc 배포입니다. DocPilot은 검증된 DMG를 열지만 앱을 자동 종료하거나 Applications의 앱을 자동 교체하지 않습니다.
- macOS가 실행을 막으면 DocPilot을 한 번 실행한 뒤 시스템 설정 → 개인정보 보호 및 보안 → 확인 없이 열기를 누르고, 다시 나타난 경고에서 열기를 선택합니다. Gatekeeper 비활성화나 터미널 우회 명령은 사용하지 마세요.`,
    assets: [],
    fallback: true,
  },
  {
    version: '2.0.4',
    title: 'DocPilot 2.0.4',
    date: '2026-07-18',
    summary: '내장 터미널에서 fish를 기본 셸로 선택하고 설치할 수 있게 하며, 사용자가 닫은 탭에 연결 오류가 남던 문제를 수정했습니다.',
    body: `## Added
- Terminal 설정에서 Default, fish, zsh, bash 중 내장 터미널 셸을 선택할 수 있습니다.
- Homebrew가 설치된 Mac에서는 설정에서 fish 설치를 확인하고 실행할 수 있습니다.

## Changed
- fish가 설치되어 있으면 새 설치의 기본 터미널 셸로 fish를 사용합니다.
- 설정에서 fish 설치가 완료되면 기존 설정을 보존하면서 기본 터미널 셸을 fish로 전환합니다.

## Fixed
- 사용자가 터미널 탭을 닫았을 때 정상 종료를 연결 끊김으로 오인해 경고가 남던 문제를 수정했습니다.

## Upgrade notes
- 셸 선택은 DocPilot 내장 터미널에 적용되며 Warp나 iTerm2 같은 외부 터미널 앱을 포함하지 않습니다.
- fish 자동 설치는 Homebrew가 있는 macOS에서만 제공하며, 설치 전에 확인을 요청합니다.`,
    assets: [],
    fallback: true,
  },
  {
    version: '2.0.3',
    title: 'DocPilot 2.0.3',
    date: '2026-07-18',
    summary: '공식 DMG를 앱 안에서 안전하게 내려받고 검증하는 수동 업데이트 흐름을 추가하고, 설치 이미지와 Dock 아이콘의 검은 배경을 제거했습니다.',
    body: `## Added
- 새 공개 버전과 현재 Mac 아키텍처를 확인해 앱 안에서 DMG를 다운로드하는 업데이트 카드를 추가했습니다.
- GitHub Release asset의 이름, 크기, 전달 호스트와 SHA-256 digest를 검증합니다.
- 다운로드 가능, 진행 중, 완료와 오류 상태에서 릴리즈 노트와 수동 설치 단계를 안내합니다.

## Fixed
- 투명 PNG·ICNS가 패키지와 마운트된 DMG까지 유지되도록 검사해 설치 화면과 Dock의 검은 사각 배경을 제거했습니다.
- 패키지에서 New terminal을 눌러도 기본 로그인 셸이 생성되지 않던 native PTY 포함 경로를 수정했습니다.

## Upgrade notes
- 이 공개 빌드는 Developer ID 서명과 Apple 공증이 없는 ad-hoc 배포입니다.
- DocPilot은 검증된 DMG를 열어 주지만 자동 종료하거나 Applications의 앱을 자동 교체하지 않습니다.
- 다운로드 중 terminal·agent 세션과 미저장 문서는 유지됩니다. 교체할 때는 작업을 저장하고 사용자가 앱을 종료하세요.`,
    assets: [],
    fallback: true,
  },
  {
    version: '2.0.2',
    title: 'DocPilot 2.0.2',
    date: '2026-07-18',
    summary: '종료 수명주기와 워크스페이스 보안 경계를 강화하고, 동시 저장·외부 변경에서 초안을 보호하며 Intel·Apple Silicon 패키지를 분리했습니다.',
    body: `## Fixed
- Bridge, watcher, worker, 터미널과 Agent 자식 프로세스를 종료 단계에서 정리해 앱 종료가 멈추는 상황을 줄였습니다.
- traversal, symlink, 잘못된 Origin과 malformed 요청을 차단하고 작업공간 밖 파일을 보호합니다.
- 저장 중 디스크 변경과 분할 편집, 외부 변경 충돌에서 사용자 초안을 보존합니다.
- recoverable trash의 cross-volume publish 실패 시 원본을 유지하고 staging 파일을 정리합니다.

## Changed
- Intel Mac(x64)과 Apple Silicon(arm64)용 DMG를 각각 제공합니다.
- 패키지 검사에서 앱 실행 파일과 native PTY 모듈의 아키텍처를 함께 검증합니다.
- 공개 매뉴얼의 Download에서 Mac 유형을 직접 선택할 수 있습니다.

## Upgrade notes
- 배포 파일은 기존 릴리스와 동일하게 ad-hoc 서명되며 Apple 공증은 적용되지 않았습니다.
- 사용 중인 Mac에 맞는 arm64 또는 x64 DMG를 선택하세요.`,
    assets: [],
    fallback: true,
  },
  {
    version: '2.0.1',
    title: 'DocPilot 2.0.1',
    date: '2026-07-16',
    summary: '문서 프리뷰의 제목·NOTE·줄 번호 표시를 보정하고 초기 테마, 본문 폭과 터미널 재열기 동작을 개선했습니다.',
    body: `## Fixed
- Markdown과 AsciiDoc 제목의 크기·굵기와 한국어 글꼴 적용을 일관되게 맞췄습니다.
- AsciiDoc NOTE 안의 긴 인라인 코드와 여러 자리 줄 범위가 겹치거나 본문 밖으로 넘치던 문제를 수정했습니다.
- 닫힌 터미널을 홈과 문서 화면의 우측 하단 Terminal 버튼으로 다시 열 수 있습니다.

## Changed
- Line numbers 스위치를 더보기 메뉴 밖으로 옮기고 기본값을 끔으로 변경했습니다.
- 프리뷰 폭 조절선을 평상시에도 은은하게 표시하고, 새 작업공간의 기본 폭을 최대보다 한 단계 좁게 설정했습니다.
- 첫 실행 테마는 macOS 시스템 설정을 따르며 워크스페이스 이름 옆의 불필요한 화살표를 제거했습니다.
- 실제 앱 동작을 따라가는 새 매뉴얼 데모와 직접 DMG 다운로드 흐름을 배포했습니다.

## Upgrade notes
- 기존 Line numbers 저장값은 새 기본값에 맞춰 한 번 초기화됩니다. 필요하면 상단 스위치에서 다시 켤 수 있습니다.
- Intel Mac용 DMG는 코드 서명·공증되지 않은 내부 배포 빌드입니다.`,
    assets: [],
    fallback: true,
  },
  {
    version: '2.0.0',
    title: 'DocPilot 2.0.0',
    date: '2026-07-15',
    summary: '문서 중심 워크벤치, 형식별 문서 모드, 자유로운 Pane 배치, 기본 로그인 셸 터미널과 렌더링 Diff를 제공합니다.',
    body: `## Added
- 프로젝트, 파일 탐색기, 열린 탭과 문서 캔버스를 하나의 로컬 워크벤치로 구성했습니다.
- Markdown Source·Rich·Preview, AsciiDoc Source·Preview, JSON Source·Tree·Format·Validate를 제공합니다.
- 문서 탭과 터미널 Pane을 상하좌우로 배치하고 놓기 전 결과 영역을 확인할 수 있습니다.
- 프로젝트 기본 로그인 셸과 파일 이름·본문 검색을 제공합니다.

## Changed
- Source와 렌더링 Preview에서 Diff를 검토하고 Changes 레일로 이동할 수 있습니다.
- 특정 Agent 전용 실행 화면 대신 사용자가 원하는 CLI를 직접 실행하는 터미널을 사용합니다.
- Source를 거쳐 Preview로 돌아와도 사용자가 조절한 본문 가로 폭을 유지합니다.
- Docs, Changelog와 직접 다운로드를 제공하는 새 공개 매뉴얼을 추가했습니다.

## Limitations
- 터미널 셸 프로세스는 앱 bridge가 소유하며 전체 앱 재시작 뒤 생존을 보장하지 않습니다.
- Rich 모드는 안전한 왕복 변환이 어려운 문법이나 300,000자보다 큰 Markdown에서 비활성화됩니다.`,
    assets: [],
    fallback: true,
  },
  {
    version: '1.0.28',
    title: 'DocPilot 1.0.28',
    date: '2026-07-10',
    summary: 'AsciiDoc worker 변환, 편집 하이라이트, Preview 렌더링과 관련 매뉴얼을 추가했습니다.',
    body: `## Added
- AsciiDoc 변환을 별도 worker에서 처리해 큰 문서 변환 중 bridge 응답성을 유지합니다.
- AsciiDoc 편집 하이라이트와 렌더링 Preview를 추가했습니다.
- Markdown·AsciiDoc·JSON 작업 흐름을 매뉴얼에 반영했습니다.

## Release evidence
- 공개일: 2026-07-10
- 구현 커밋과 릴리스 대상: 315b5be (2026-07-10)
- 문서 커밋: 91d66bb (2026-07-10)
- GitHub 릴리스 레코드·태그 생성: 2026-07-13
- 태그: v1.0.28 → b7dca9c

## History note
- 태그 이전 계보에 임시 1.0.29 버전 커밋이 있지만 최종 태그의 package version은 1.0.28입니다.`,
    assets: [],
    fallback: true,
    verified: true,
  },
  {
    version: '1.0.27',
    title: 'DocPilot 1.0.27',
    date: '2026-07-08',
    summary: '저장소에서 확인할 수 있는 최초 버전 태그이며 이후 변경을 비교하기 위한 검증 기준선입니다.',
    body: `## Verified baseline
- 태그: v1.0.27 → 461ab0a (2026-07-08)
- 태그가 가리키는 package version은 1.0.27입니다.

## History note
- 저장소에 더 이른 버전 태그가 없어 기능별 이전 차이를 추정해서 작성하지 않습니다.`,
    assets: [],
    fallback: true,
    verified: true,
  },
]);

export function normalizeRelease(input = {}) {
  const version = String(input.tag_name || input.version || '').replace(/^v/i, '') || 'unknown';
  const published = input.published_at || input.date || '';
  const body = String(input.body || input.summary || '').trim();
  return {
    version,
    title: String(input.name || input.title || `DocPilot ${version}`).trim(),
    date: published ? String(published).slice(0, 10) : '',
    summary: firstReleaseParagraph(body) || '변경 내용을 확인하세요.',
    body,
    assets: (Array.isArray(input.assets) ? input.assets : []).map(asset => ({
      name: String(asset.name || ''),
      url: String(asset.browser_download_url || asset.url || ''),
      size: Number(asset.size || 0),
    })),
    prerelease: Boolean(input.prerelease),
    draft: Boolean(input.draft),
    unreleased: Boolean(input.unreleased),
  };
}

export function normalizeReleases(payload) {
  return (Array.isArray(payload) ? payload : [])
    .map(normalizeRelease)
    .filter(release => !release.draft && release.version !== 'unknown');
}

export function selectDmgAssets(assets = []) {
  return assets
    .filter(asset => /\.dmg$/i.test(asset.name) && !/\.blockmap$/i.test(asset.name) && asset.url)
    .map(asset => ({
      ...asset,
      arch: /-arm64\.dmg$/i.test(asset.name) ? 'arm64' : /-x64\.dmg$/i.test(asset.name) ? 'x64' : '',
    }))
    .sort((left, right) => ['arm64', 'x64', ''].indexOf(left.arch) - ['arm64', 'x64', ''].indexOf(right.arch));
}

export function selectDmgAsset(assets = [], preferredArch = 'x64') {
  const dmgs = selectDmgAssets(assets);
  return dmgs.find(asset => asset.arch === preferredArch)
    || dmgs.find(asset => !asset.arch)
    || dmgs[0]
    || null;
}

export async function fetchReleases(fetcher = fetch) {
  const response = await fetcher(RELEASES_ENDPOINT, { headers: { Accept: 'application/vnd.github+json' } });
  if (!response.ok) throw new Error(`릴리스 정보를 불러오지 못했습니다 (${response.status}).`);
  const releases = normalizeReleases(await response.json());
  if (!releases.length) return FALLBACK_RELEASES;
  const remoteByVersion = new Map(releases.map(release => [release.version, release]));
  const knownVersions = new Set(FALLBACK_RELEASES.map(release => release.version));
  const known = FALLBACK_RELEASES.map(curated => {
    const remote = remoteByVersion.get(curated.version);
    if (!remote) return curated;
    if (curated.unreleased) return remote;
    return {
      ...remote,
      title: curated.title,
      summary: curated.summary,
      body: curated.body,
      verified: true,
    };
  });
  return [...known, ...releases.filter(release => !knownVersions.has(release.version))];
}

export async function resolveLatestDmgs(fetcher = fetch) {
  const releases = await fetchReleases(fetcher);
  for (const release of releases) {
    const assets = selectDmgAssets(release.assets);
    if (assets.length) return { version: release.version, assets };
  }
  throw new Error('최신 macOS DMG를 찾지 못했습니다.');
}

export async function resolveLatestDmg(fetcher = fetch, preferredArch = 'x64') {
  const release = await resolveLatestDmgs(fetcher);
  const asset = selectDmgAsset(release.assets, preferredArch);
  return { ...asset, version: release.version };
}

function firstReleaseParagraph(markdown) {
  return String(markdown || '')
    .split(/\n\s*\n/)
    .map(block => block.replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '').replace(/[`*_]/g, '').trim())
    .find(Boolean)
    ?.slice(0, 220) || '';
}
