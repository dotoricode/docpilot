export const RELEASES_ENDPOINT = 'https://api.github.com/repos/dotoricode/docpilot/releases';

export const FALLBACK_RELEASES = Object.freeze([
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

export function selectDmgAsset(assets = []) {
  return assets.find(asset => /\.dmg$/i.test(asset.name) && !/\.blockmap$/i.test(asset.name) && asset.url) || null;
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

export async function resolveLatestDmg(fetcher = fetch) {
  const releases = await fetchReleases(fetcher);
  for (const release of releases) {
    const asset = selectDmgAsset(release.assets);
    if (asset) return { ...asset, version: release.version };
  }
  throw new Error('최신 macOS DMG를 찾지 못했습니다.');
}

function firstReleaseParagraph(markdown) {
  return String(markdown || '')
    .split(/\n\s*\n/)
    .map(block => block.replace(/^#{1,6}\s+/gm, '').replace(/^[-*]\s+/gm, '').replace(/[`*_]/g, '').trim())
    .find(Boolean)
    ?.slice(0, 220) || '';
}
