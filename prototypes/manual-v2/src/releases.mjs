export const RELEASES_ENDPOINT = 'https://api.github.com/repos/dotoricode/docpilot/releases';

export const FALLBACK_RELEASES = Object.freeze([
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
