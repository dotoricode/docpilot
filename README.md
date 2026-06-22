# docpilot

로컬 마크다운 문서를 Claude와 Codex로 편집하는 경량 AI 문서 에디터입니다.

## 개요

docpilot은 브라우저에서 로컬 마크다운 파일을 열고, 선택한 문맥에 대해 AI 편집 지시를 보내고, 생성된 수정안을 미리본 뒤 적용할 수 있게 해줍니다.

프로젝트는 두 가지 핵심 파일로 구성됩니다.

- **`bridge.js`** — Node.js 로컬 서버. 마크다운 파일을 읽고 저장하며, Claude CLI와 Codex CLI에 편집 지시를 전달하고 결과를 SSE로 스트리밍합니다.
- **`editor.html`** — 브라우저에서 직접 열리는 단일 파일 에디터. 파일 트리, 목차, 보기/편집 모드, 선택 칩, 드로우 모드, 작업 히스토리, 수정안 미리보기와 적용 흐름을 제공합니다.

## 요구 사항

- Node.js 18 이상
- [Claude Code](https://claude.ai/code) CLI — `claude` 명령어가 PATH에 있어야 합니다
- Codex CLI (선택) — `codex` 명령어가 있으면 Claude와 Codex가 병렬로 수정안을 생성합니다

## 시작하기

### 0. Claude Code 스킬 설치

한 번만 실행하면 `/docpilot` 스킬이 `~/.claude/skills/docpilot`에 설치됩니다.

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/docpilot.ps1 install-skill
```

macOS/Linux:

```bash
sh scripts/docpilot.sh install-skill
```

Claude Code가 이미 실행 중이면 재시작한 뒤 사용할 수 있습니다.

```
/docpilot /path/to/docs
```

인자 없이 `/docpilot`만 실행하면 현재 디렉터리 하위에서 `.md` 파일이 있는 폴더를 찾아 선택하게 해줍니다.

### 1. bridge 서버 실행

```bash
node bridge.js --root /path/to/your/docs
```

`--root`를 생략하면 현재 디렉터리를 루트로 사용합니다. 서버는 `127.0.0.1:7474`에서 실행됩니다.

### 2. 에디터 열기

```bash
open editor.html
```

헤더의 상태 표시등이 **bridge on**으로 바뀌면 연결이 완료됩니다. Claude와 Codex CLI가 감지되면 각각의 표시등도 켜집니다.

### 스크립트로 한 번에 열기

스킬 없이도 아래 명령으로 bridge 실행과 에디터 열기를 한 번에 처리할 수 있습니다.

PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/docpilot.ps1 open /path/to/docs
```

macOS/Linux:

```bash
sh scripts/docpilot.sh open /path/to/docs
```

인자 없이 호출하면 현재 디렉터리 하위에서 `.md` 파일이 있는 후보를 찾아 선택하게 해줍니다.

## 사용법

### 기본 흐름

1. 왼쪽 파일 트리에서 마크다운 파일을 클릭해 엽니다.
2. **보기** 모드에서 텍스트를 드래그하거나 문단을 클릭해 선택 칩을 만듭니다.
3. 칩을 선택하거나 고정한 뒤 **✦ 지시하기** 버튼을 눌러 수정 지시를 입력합니다.
4. Claude(와 Codex)가 수정안을 생성합니다.
5. 오른쪽 작업 히스토리에서 각 제안을 **미리보기**, **적용**, **거부**합니다.
6. Claude와 Codex 제안이 모두 완료되면 **조합**으로 두 결과를 병합한 최종안을 만들 수 있습니다.

### 지침 패널

왼쪽 **지침** 패널에서 문서 작성 시 반드시 지킬 규칙을 등록할 수 있습니다. 지침은 문서 루트의 `.docpilot/instructions.json`에 저장되며, 활성화된 지침은 이후 모든 **지시하기**와 **조합** 프롬프트에 자동으로 포함됩니다.

- **직접 입력** — 제목과 본문을 입력한 뒤 추가합니다.
- **AI 정리** — 자연어로 적은 요구를 AI가 짧고 검증 가능한 지침으로 정리합니다. 정리된 내용은 저장 전 직접 확인할 수 있습니다.
- **파일에서 가져오기** — 현재 문서 루트의 마크다운 파일을 선택해 지침 본문으로 가져옵니다.
- **ON/OFF** — 지침을 삭제하지 않고 적용 여부만 전환합니다.

### 선택 칩

텍스트를 드래그하거나 문단을 클릭하면 프리뷰 우측 상단에 **선택 칩**이 생성됩니다.

- **번호 배지** — 선택 순서를 표시합니다.
- **클릭** — 칩을 활성화/비활성화합니다. 활성 칩만 지시 대상에 포함됩니다.
- **압정 아이콘** — 클릭하면 칩을 고정합니다. 고정된 칩은 지시 후에도 삭제되지 않습니다.
- **✕** — 칩을 즉시 삭제합니다.
- **전체 선택** — 현재 문서 전체를 칩으로 추가합니다.

### 목차 (TOC)

파일을 열면 파일 트리 오른쪽에 목차 패널이 자동으로 나타납니다.

- **클릭** — 해당 헤딩 위치로 스크롤합니다.
- **더블클릭** — 해당 섹션 전체를 칩으로 추가합니다.

### 드로우 모드

툴바의 **✦ 드로우** 버튼이나 **Cmd+D** 를 누르고 있으면 드로우 모드가 활성화됩니다.

- 화면에 레이저 포인터가 나타납니다.
- 마우스를 드래그하면 빨간 레이저 선이 그려집니다.
- 선에 교차하는 텍스트 블록이 실시간으로 하이라이트됩니다.
- 마우스 버튼을 놓으면 선택된 텍스트가 칩으로 추가됩니다.

> Cmd+D 홀드는 누르는 동안만 드로우 모드가 유지됩니다. 버튼 클릭은 고정 토글입니다.

### 패널 조정

각 패널은 접기/펼치기와 폭 조절이 가능합니다.

- 패널 헤더의 **‹ / ›** 버튼으로 접고 펼칩니다.
- 패널 경계의 드래그 핸들로 폭을 조절합니다.

### 편집 모드

**편집** 버튼으로 전환하면 원문 textarea와 라이브 프리뷰를 나란히 볼 수 있습니다. **저장** 버튼으로 파일에 씁니다.

## 주요 기능

| 기능 | 설명 |
|------|------|
| 파일 트리 | 루트 하위 `.md` 파일 자동 탐색, 폴더 토글 |
| 목차 패널 | 헤딩 자동 파싱, 스크롤 스파이, 더블클릭 칩 추가 |
| 지침 패널 | 프로젝트 지침 등록, AI 정리, 파일에서 가져오기, 활성 지침 강제 적용 |
| 선택 칩 | 드래그·클릭·섹션 선택, 번호 배지, 고정, 다중 선택 |
| 드로우 모드 | 레이저 포인터로 화면 영역을 직접 그려서 텍스트 선택 |
| AI 편집 | Claude 단독 또는 Claude+Codex 병렬 수정안 생성 |
| 조합 | Claude/Codex 결과를 하나의 최종안으로 병합 |
| 작업 히스토리 | 진행 중인 작업, 완료된 수정안, 미리보기·적용·거부 |
| 패널 조절 | 파일 트리·목차·히스토리 패널 접기/펼치기 및 폭 드래그 |

## Bridge API

| Method | Path | 설명 |
|--------|------|------|
| `GET` | `/ping` | 서버 상태 및 루트 경로 확인 |
| `GET` | `/status` | `claude`, `codex` 명령어 사용 가능 여부 |
| `GET` | `/files` | 루트 하위 마크다운 파일 목록 |
| `GET` | `/file?id=<path>` | 파일 내용 반환 |
| `POST` | `/save` | 파일 저장 `{ id, content }` |
| `GET` | `/instructions` | `.docpilot/instructions.json` 지침 목록 반환 |
| `POST` | `/instructions` | 지침 추가 또는 수정 |
| `POST` | `/instructions/delete` | 지침 삭제 |
| `POST` | `/instructions/normalize` | 자연어 지침을 AI로 정리 |
| `POST` | `/instruct` | AI 편집 지시 전달 및 SSE 스트리밍 |

`POST /instruct` 페이로드:

```json
{
  "fileId": "docs/README.md",
  "context": "선택된 텍스트",
  "instruction": "더 간결하게 다듬어줘",
  "content": "전체 파일 내용"
}
```

`combine: true`, `claudeProposed`, `codexProposed`를 함께 전달하면 두 수정안을 조합한 최종안을 생성합니다.

## 구조

```text
docpilot/
├── bridge.js       # 로컬 HTTP 서버 (포트 7474)
├── editor.html     # 단일 파일 브라우저 에디터
├── SKILL.md        # Claude Code /docpilot 스킬 정의
├── scripts/
│   ├── docpilot.ps1
│   ├── docpilot.sh
│   ├── install-skill.ps1
│   ├── install-skill.sh
│   ├── open-editor.ps1
│   ├── open-editor.sh
│   ├── install-skill.js
│   └── launch-docpilot.js
├── README.md
└── docs/           # 마크다운 문서 예시
    └── getting-started.md
```

## 보안

- bridge 서버는 `--root`로 지정된 디렉터리 바깥으로 파일 접근을 차단합니다 (path traversal 방지).
- 서버는 `127.0.0.1`에만 바인딩되므로 외부 네트워크에서 접근할 수 없습니다.
- CORS는 `file://` origin만 허용합니다.
