# docpilot

Markdown 문서 디렉토리를 브라우저 기반 편집기로 열고, Claude와 Codex로 문서를 편집한다.

## 사용법

```
/docpilot [/path/to/docs]
```

인자 없이 호출하면 현재 디렉토리(`$PWD`) 하위에서 `.md` 파일이 있는 후보 디렉토리를 찾아 선택지를 제안한다.

## 실행 절차

Claude는 아래 순서로 실행한다.

### 케이스 A — 인자 없이 호출

현재 디렉토리(`$PWD`) 하위에서 `.md` 파일이 존재하는 디렉토리를 찾아 후보 목록을 제시한다.

```bash
find "$PWD" -maxdepth 3 -name "*.md" | sed 's|/[^/]*$||' | sort -u
```

- `$PWD` 자체도 후보에 포함한다.
- 후보가 없으면 "현재 디렉토리에 .md 파일이 없습니다"라고 안내 후 종료.
- 후보가 1개면 바로 그 경로로 케이스 B 진행.
- 후보가 2개 이상이면 번호 목록을 보여주고 사용자가 선택한 경로로 케이스 B 진행.

예시 출력:
```
.md 파일이 있는 디렉토리:
  1) /Users/foo/docs
  2) /Users/foo/docs/api
  3) /Users/foo/docs/guides

어느 디렉토리를 열까요? (번호 입력)
```

### 케이스 B — 경로가 결정된 후

#### 1. 경로 유효성 확인

```bash
ROOT="/path/to/docs"
[ -d "$ROOT" ] || { echo "오류: $ROOT 는 존재하지 않는 디렉토리입니다"; exit 1; }
```

#### 2. bridge 상태 확인 — root가 다르면 재시작

```bash
DOCPILOT_DIR="/Users/youngsang.kwon/01_private/docpilot"
PING=$(curl -s --max-time 1 http://localhost:7474/ping)

if echo "$PING" | grep -q '"ok":true'; then
  CURRENT_ROOT=$(echo "$PING" | sed 's/.*"root":"\([^"]*\)".*/\1/')
  if [ "$CURRENT_ROOT" != "$ROOT" ]; then
    echo "bridge root 변경: $CURRENT_ROOT → $ROOT"
    kill $(pgrep -f bridge.js) 2>/dev/null
    sleep 0.5
    node "$DOCPILOT_DIR/bridge.js" --root "$ROOT" &
    sleep 1
  else
    echo "bridge 이미 실행 중 (root 일치)"
  fi
else
  echo "bridge 시작 중..."
  node "$DOCPILOT_DIR/bridge.js" --root "$ROOT" &
  sleep 1
fi

curl -s --max-time 2 http://localhost:7474/ping | grep -q '"ok":true' \
  && echo "bridge 준비 완료" \
  || echo "경고: bridge 응답 없음"
```

#### 3. editor.html 열기

```bash
open "$DOCPILOT_DIR/editor.html"
```

#### 4. 완료 메시지

```
docpilot 시작됨
  root   : /path/to/docs
  bridge : http://localhost:7474
  editor : file:///Users/youngsang.kwon/01_private/docpilot/editor.html

bridge 종료: kill $(pgrep -f bridge.js)
```

## 파일 구조

```
docpilot/
  SKILL.md      ← 이 파일 (스킬 정의)
  bridge.js     ← Node.js HTTP 서버 (port 7474)
  editor.html   ← 브라우저 UI (v0.7.0)
  README.md     ← 프로젝트 문서
  docs/         ← 마크다운 예시 문서
```

## 요구사항

- Node.js 18 이상
- Claude Code CLI (`claude` 명령이 PATH에 있어야 함)
- Codex CLI (선택 — 있으면 Claude+Codex 병렬 실행)
- macOS: `open` 명령 (기본 제공)

## 에디터 주요 기능 (v0.7.0)

| 기능 | 설명 |
|------|------|
| 파일 트리 | `.md` 파일 자동 탐색, 폴더 토글, 문서 아이콘 |
| 목차 패널 | 헤딩 파싱, 스크롤 스파이, 더블클릭 → 칩 추가 |
| 선택 칩 | 드래그·클릭·섹션 선택, 번호 배지, 압정 고정 |
| 드로우 모드 | 레이저 포인터로 영역 그려서 텍스트 선택 (Cmd+D) |
| AI 편집 | Claude 단독 또는 Claude+Codex 병렬 수정안 생성 |
| 패널 조절 | 파일 트리·목차·히스토리 패널 접기/펼치기 및 폭 조절 |

## 동작 원리

```
editor.html (browser)
  └─ GET /files          → 파일 트리 로드
  └─ GET /file?id=...    → 파일 내용 로드
  └─ POST /save          → 파일 저장
  └─ POST /instruct      → SSE 스트리밍
         bridge.js (localhost:7474)
               ├─ spawn('claude', ['-p', prompt])
               └─ spawn('codex', ['exec', '--json', ...])  ← codex 설치 시
```

## 주의사항

- bridge는 `--root` 경로 바깥의 파일을 차단한다 (path traversal 방지).
- CORS는 `null` origin만 허용 (`file://`로 열린 HTML 전용).
- bridge는 localhost:7474에서만 열린다. 외부 네트워크에 노출되지 않는다.
