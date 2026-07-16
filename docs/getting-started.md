# Getting Started

DocPilot은 로컬 문서 폴더를 열어 Markdown을 편집하고, 오른쪽 Agent 세션에서 Claude/Codex로 검토와 수정을 진행하는 데스크톱 앱입니다.

## 1. 준비

```bash
node --version
claude --version
codex --version
```

`codex`는 선택 사항입니다. Claude만 있어도 기본 Agent 세션을 사용할 수 있습니다.

## 2. 실행

```bash
npm install
npm start
```

시작 화면에서 문서 폴더를 선택합니다.

## 3. 문서 편집

- 왼쪽에서 파일을 선택합니다.
- 가운데 CodeMirror editor에서 수정합니다.
- `⌘ + S` 또는 저장 버튼으로 저장합니다.
- 오른쪽 preview에서 렌더링 결과를 확인합니다.

## 4. Agent 세션

- 오른쪽 Agent panel에서 Claude/Codex 세션을 만듭니다.
- 입력창에 바로 요청을 적고 전송합니다.
- 기본 전송은 최소 문맥만 포함합니다.
- 필요한 경우 context mode를 선택 문맥, 최근 대화, 현재 문서, 프로젝트 범위로 바꿉니다.
- 선택한 문맥은 chip으로 추가할 수 있고, 중복 chip은 전송 시 제거됩니다.

## 5. 변경 검토

Agent가 파일 변경을 만들면 Changed Files panel에 review item이 생깁니다.

- `열기`: 대상 파일을 엽니다.
- `크게 보기`: before/after diff를 넓게 봅니다.
- `빠른 수정`: 병합본을 직접 편집합니다.
- `수락`: 변경 후 내용을 저장합니다.
- `거부`: 변경 전 내용을 유지합니다.

사용자가 편집 중인 파일은 Agent나 외부 변경으로 자동 덮어쓰지 않습니다.

## 6. 패키지 확인

```bash
npm run renderer:build
npm run build
node scripts/check-packaged-app.js
```

DMG는 `dist/package/DocPilot-<version>.dmg`에 생성됩니다.
