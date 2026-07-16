const media = (type, asset, label, alt, evidence = ['entry', 'opened', 'result']) => ({
  type,
  asset,
  label,
  alt,
  evidence,
});

export const guideMedia = Object.freeze({
  overview: [
    media('demo', 'workbench-overview', '문서 중심 워크벤치', '프로젝트 열기와 빠른 열기의 위치부터 README Preview가 열린 결과까지 보여 주는 DocPilot 워크벤치'),
  ],
  install: [
    media('image', 'install-download-launch', '다운로드에서 첫 실행까지', '매뉴얼의 Download 위치, DMG 설치 단계와 DocPilot의 프로젝트 폴더 시작 화면'),
  ],
  'first-workspace': [
    media('image', 'first-workspace-open', '첫 작업공간 열기', '프로젝트 폴더 열기 버튼, 폴더 선택 상태와 첫 문서 Preview 결과'),
  ],
  'workspace/additional-folders': [
    media('image', 'additional-folders', '추가 폴더 연결', 'Project 패널의 폴더 추가 버튼, 폴더 선택과 연결된 보조 루트 결과'),
  ],
  'workspace/file-explorer': [
    media('image', 'file-explorer', '파일 탐색기', 'Project 파일 트리와 이름 필터, 파일 컨텍스트 메뉴와 열린 문서 탭'),
  ],
  'workspace/recent': [
    media('image', 'recent-locations', '최근 위치 다시 열기', '최근 프로젝트와 문서의 위치, 선택 상태와 복원된 작업공간'),
  ],
  'workspace/tabs-panes-splits': [
    media('demo', 'tabs-and-panes-all-directions', '탭과 Pane 상하좌우 배치', '문서 탭과 Terminal 버튼의 위치부터 문서와 터미널 Pane을 상하좌우로 배치한 결과까지 이어지는 흐름'),
  ],
  'find/quick-open': [
    media('demo', 'quick-open-human-typing', '빠른 열기', '빠른 열기를 연 뒤 파일명을 사람 속도로 입력하고 선택한 문서를 여는 흐름'),
  ],
  'find/project-search': [
    media('demo', 'project-search-complete', '프로젝트 본문 검색', 'Search 버튼과 검색 옵션부터 파일 경로와 줄 결과를 선택해 문서를 연 상태까지 보여 주는 흐름'),
  ],
  'editing/source': [
    media('image', 'source-edit-save', 'Source 편집과 저장', 'Source 버튼과 더보기 메뉴, 편집 상태와 저장 후 변경 표시가 사라진 결과'),
  ],
  'editing/markdown': [
    media('image', 'markdown-preview-example', 'Markdown 실제 Preview', 'Markdown의 Source, Rich, Preview 버튼과 제목, 목록, 표, 코드, 이미지가 렌더링된 실제 예시'),
  ],
  'editing/asciidoc': [
    media('image', 'asciidoc-preview-example', 'AsciiDoc 실제 Preview', 'AsciiDoc Preview 버튼과 장문 목차, 표, 코드가 렌더링된 실제 예시', ['entry', 'result']),
    media('demo', 'asciidoc-long-cold-cache', '장문 AsciiDoc 최초 변환과 캐시', '합성 manual.adoc의 최초 Preview 준비 상태와 렌더링 결과, 캐시된 재열기까지 실제 속도로 비교하는 흐름', ['opened', 'result']),
  ],
  'editing/json': [
    media('image', 'json-tree-example', 'JSON 실제 Tree', 'JSON의 Source와 Tree 버튼, 펼친 구조와 포맷 후 유효한 root 결과'),
  ],
  'editing/preview': [
    media('image', 'preview-controls', 'Preview 기능 위치', 'Preview 버튼과 오른쪽 목차, 본문 찾기, 줄 표시와 읽기 폭 조절 위치', ['entry', 'opened']),
    media('demo', 'preview-navigation-width', 'Preview 탐색과 읽기 폭', '긴 문서의 목차와 본문 찾기를 사용하고 읽기 폭을 대칭으로 조절한 결과', ['result']),
  ],
  'review/diff': [
    media('demo', 'diff-edit-to-changes', '편집부터 Changes 검토까지', 'Source에서 실제 문장을 수정한 뒤 Diff와 Summary를 열고 우측 Changes 항목을 확대해 검토하는 전체 흐름'),
  ],
  'review/context-copy': [
    media('demo', 'preview-context-to-claude', 'Preview 문맥을 Claude로 전달', 'Preview 블록을 클릭해 복사한 파일명, 줄 번호와 본문을 실제 Claude 터미널에 붙여넣고 제출하는 흐름'),
  ],
  'review/instructions': [
    media('image', 'instructions-presets', '지침과 프리셋', 'Instructions 버튼, 가져온 지침과 프리셋 선택 UI, 적용된 지침 수 결과'),
  ],
  'terminal/overview': [
    media('demo', 'terminal-open-session', '실제 셸 터미널', 'Terminal 버튼의 위치부터 Pane과 새 PTY 세션을 열고 프로젝트 명령을 사람 속도로 실행한 결과까지 보여 주는 흐름'),
  ],
  'settings/appearance': [
    media('image', 'appearance-theme', '테마 선택', 'Theme 설정 위치, System, Light, Dark 선택 UI와 적용된 화면'),
  ],
  'settings/reference': [
    media('image', 'settings-reference', '설정 참고', 'Settings 버튼과 설정 그룹, 값을 변경한 뒤 다시 열어 유지된 결과'),
  ],
  'install/updates': [
    media('image', 'update-release-flow', '업데이트 확인', 'Changelog와 Download 위치, 선택한 릴리스와 업데이트 뒤 표시된 앱 버전'),
  ],
  'reference/shortcuts': [
    media('image', 'shortcut-reference', '키보드 단축키 위치', '단축키 표와 대표 단축키를 눌러 열린 빠른 열기, 검색, 분할 기능'),
  ],
  troubleshooting: [
    media('image', 'troubleshooting-states', '문제 상태와 복구', '대표 오류 상태, 해당 복구 안내와 기능이 다시 열린 결과'),
  ],
});

export const mergedGuideRoutes = Object.freeze({
  'workspace/pane-layout': 'workspace/tabs-panes-splits',
  'terminal/layout': 'workspace/tabs-panes-splits',
});
