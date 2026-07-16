# DocPilot

로컬 마크다운 문서를 편집하고 Claude/Codex Agent 세션으로 검토, 수정, 정리하는 Electron 데스크톱 앱입니다.

## Current Stack

- Electron desktop shell
- Vite + React + TypeScript renderer
- CodeMirror 6 Markdown editor
- markdown-it preview
- xterm.js Agent console
- node-pty backed interactive Agent terminal
- electron-builder DMG packaging

## Run

```bash
npm install
npm start
```

시작 화면에서 문서 폴더를 선택하면 로컬 bridge와 React editor가 함께 열립니다.

## Build DMG

```bash
npm run renderer:build
npm run build
node scripts/check-packaged-app.js
```

현재 체크포인트 DMG:

```txt
dist/package/DocPilot-2.0.0.dmg
```

## Main Workflow

1. 왼쪽 파일 트리에서 마크다운 파일을 엽니다.
2. 가운데 CodeMirror editor에서 수정하고 저장합니다.
3. 필요한 문맥을 선택해 Agent context chip으로 추가합니다.
4. 오른쪽 Agent 세션에서 Claude 또는 Codex에 바로 메시지를 보냅니다.
5. Agent가 만든 파일 변경은 Changed Files review에서 확인합니다.
6. diff를 확인한 뒤 수락, 거부, 병합 저장 중 하나를 선택합니다.

기본 전송은 최소 문맥만 포함합니다. 필요할 때만 선택 문맥, 최근 대화, 현재 문서, 프로젝트 범위로 확장합니다.

## Verification

주요 검증 명령:

```bash
npm run renderer:typecheck
npm run renderer:build
node scripts/check-core-modules.js
node scripts/check-prompt-package.js
node scripts/check-agent-session-bridge.js
node scripts/check-fake-agent-session.js
node scripts/check-project-chat-wrapper.js
node scripts/check-terminal-session.js
node scripts/check-react-renderer-smoke.js
node scripts/check-react-editor-workflow.js
node scripts/check-react-external-conflict.js
node scripts/check-editor-navigation-guard.js
node scripts/check-packaged-app.js
```

## Safety Model

- Renderer는 직접 filesystem/process 권한을 갖지 않습니다.
- Bridge가 workspace root guard를 적용합니다.
- Agent가 만든 파일 변경은 자동 적용되지 않습니다.
- 사용자 편집 중인 파일이 외부/Agent에 의해 바뀌면 review conflict로 표시합니다.
- 패키지에는 React renderer만 포함되며 legacy browser editor는 포함하지 않습니다.
