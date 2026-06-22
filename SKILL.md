# docpilot

Markdown 문서 디렉토리를 브라우저 기반 편집기로 열고, Claude와 Codex로 문서를 편집한다.

## 사용법

```
/docpilot [/path/to/docs]
```

인자 없이 호출하면 현재 디렉토리(`$PWD`) 하위에서 `.md` 파일이 있는 후보 디렉토리를 찾아 선택지를 제안한다.

## 실행 절차

Claude는 아래 명령을 실행한다.

```sh
node "__DOCPILOT_DIR__/scripts/launch-docpilot.js" [/path/to/docs]
```

설치 스크립트가 `__DOCPILOT_DIR__`를 실제 docpilot 설치 경로로 치환한다. 이 파일을 직접 복사해 설치했다면 `__DOCPILOT_DIR__`를 docpilot 저장소의 절대 경로로 바꾼다.

## 동작

- 지정한 경로가 있으면 그 디렉토리를 문서 루트로 사용한다.
- 경로가 없으면 현재 디렉토리 하위 3단계 안에서 `.md` 파일이 있는 디렉토리를 찾는다.
- 후보가 여러 개면 번호 목록을 보여주고 선택하게 한다.
- `bridge.js`가 이미 같은 루트로 실행 중이면 재사용한다.
- 설치 스크립트가 시작한 bridge가 다른 루트로 실행 중이면 재시작한다.
- 브라우저에서 `editor.html`을 연다.

성공하면 아래 형식으로 출력된다.

```text
docpilot ready
  root   : /path/to/docs
  bridge : http://127.0.0.1:7474
  editor : file:///.../docpilot/editor.html
```

## 파일 구조

```text
docpilot/
  SKILL.md      <- 이 파일 (스킬 정의)
  bridge.js     <- Node.js HTTP 서버 (port 7474)
  editor.html   <- 브라우저 UI
  scripts/
    docpilot.ps1      <- PowerShell 엔트리포인트
    docpilot.sh       <- shell 엔트리포인트
    install-skill.js   <- Claude Code 스킬 설치
    launch-docpilot.js <- OS 공통 실행 래퍼
```

## 요구사항

- Node.js 18 이상
- Claude Code CLI (`claude` 명령이 PATH에 있어야 함)
- Codex CLI (선택 - 있으면 Claude+Codex 병렬 실행)

## 에디터 주요 기능

| 기능 | 설명 |
|------|------|
| 파일 트리 | `.md` 파일 자동 탐색, 폴더 토글, 문서 아이콘 |
| 목차 패널 | 헤딩 파싱, 스크롤 스파이, 더블클릭으로 칩 추가 |
| 지침 패널 | 프로젝트 지침 등록, AI 정리, 파일에서 가져오기, 활성 지침 강제 적용 |
| 선택 칩 | 드래그, 클릭, 섹션 선택, 번호 배지, 압정 고정 |
| 드로우 모드 | 레이저 포인터로 영역을 그려서 텍스트 선택 |
| AI 편집 | Claude 단독 또는 Claude+Codex 병렬 수정안 생성 |
| 패널 조절 | 파일 트리, 목차, 히스토리 패널 접기/펼치기 및 폭 조절 |

## 동작 원리

```text
editor.html (browser)
  -> GET /files          -> 파일 트리 로드
  -> GET /file?id=...    -> 파일 내용 로드
  -> POST /save          -> 파일 저장
  -> POST /instruct      -> SSE 스트리밍
         bridge.js (localhost:7474)
               -> spawn('claude', ['-p', prompt])
               -> spawn('codex', ['exec', '--json', ...])  # codex 설치 시
```

## 주의사항

- bridge는 `--root` 경로 바깥의 파일을 차단한다 (path traversal 방지).
- CORS는 `null` origin만 허용한다 (`file://`로 열린 HTML 전용).
- bridge는 `127.0.0.1:7474`에서만 열린다.
