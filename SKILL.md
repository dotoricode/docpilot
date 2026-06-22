# docpilot

Markdown 문서 디렉토리를 브라우저 기반 편집기로 열고, Claude Code로 문서를 편집한다.

## 사용법

```
/docpilot /path/to/docs
```

인자 없이 호출하면 현재 디렉토리(`$PWD`)를 root로 사용한다.

## 실행 절차

Claude는 아래 순서로 실행한다.

### 1. 인자 확인

- 인자가 있으면 `ROOT=$1`
- 없으면 `ROOT=$PWD`
- ROOT가 존재하는 디렉토리인지 확인. 없으면 오류 메시지 출력 후 중단.

### 2. bridge 상태 확인

```bash
curl -s --max-time 1 http://localhost:7474/ping
```

- 응답이 `{"ok":true}` 이면 이미 실행 중 → 3단계로
- 응답 없으면 bridge 실행 필요 → 아래 실행

```bash
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
node "$SKILL_DIR/bridge.js" --root "$ROOT" &
sleep 1
```

`SKILL_DIR`은 이 SKILL.md가 있는 디렉토리 (bridge.js와 editor.html이 함께 있다).

### 3. editor.html 열기

```bash
open "$SKILL_DIR/editor.html"
```

macOS 외 환경:
- Linux: `xdg-open "$SKILL_DIR/editor.html"`
- Windows: `start "$SKILL_DIR/editor.html"`

### 4. 완료 메시지 출력

```
docpilot 시작됨
  root    : /path/to/docs
  bridge  : http://localhost:7474
  editor  : file:///path/to/editor.html

bridge를 종료하려면: kill $(pgrep -f bridge.js)
```

## 파일 구조

```
docpilot/
  SKILL.md      ← 이 파일 (스킬 정의)
  bridge.js     ← Node.js HTTP 서버 (port 7474)
  editor.html   ← 브라우저 UI
```

## 요구사항

- Node.js (bridge.js 실행)
- Claude Code CLI (`claude` 명령이 PATH에 있어야 함)
- macOS: `open` 명령 (기본 제공)

## 동작 원리

```
editor.html (browser)
  └─ GET /files          → 파일 트리 로드
  └─ GET /file?id=...    → 파일 내용 로드
  └─ POST /save          → 파일 저장
  └─ POST /instruct      → claude -p 실행 → SSE 스트리밍
         bridge.js (localhost:7474)
               └─ spawn('claude', ['-p', prompt])
```

## 주의사항

- bridge는 `--root` 경로 바깥의 파일을 차단한다 (path traversal 방지).
- CORS는 `null` origin만 허용 (`file://`로 열린 HTML 전용). 외부 웹사이트에서는 접근 불가.
- bridge는 localhost:7474에서만 열린다. 외부 네트워크에 노출되지 않는다.
