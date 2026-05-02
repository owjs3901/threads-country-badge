# Chrome Web Store 배포 체크리스트

## GitHub Secrets

Repository Settings → Secrets and variables → Actions에 아래 값을 등록합니다.

- `CHROME_EXTENSION_ID`: Chrome Web Store 개발자 대시보드의 확장 프로그램 ID입니다.
- `GOOGLE_CLIENT_ID`: Chrome Web Store API가 활성화된 Google Cloud OAuth 클라이언트 ID입니다.
- `GOOGLE_CLIENT_SECRET`: 위 OAuth 클라이언트의 secret입니다.
- `GOOGLE_REFRESH_TOKEN`: `https://www.googleapis.com/auth/chromewebstore` scope로 발급한 refresh token입니다.

## Google/Chrome Web Store에서 채워야 하는 항목

1. Google 계정 2단계 인증을 활성화합니다.
2. Chrome Web Store 개발자 계정을 준비하고 최초 등록비를 처리합니다.
3. Chrome Web Store Developer Dashboard에서 새 아이템을 생성합니다.
4. Store listing을 채웁니다.
   - 확장 이름
   - 짧은 설명
   - 자세한 설명
   - 카테고리
   - 언어
   - 아이콘
   - 스크린샷 또는 프로모션 이미지
5. Privacy 탭을 채웁니다.
   - 권한 사용 목적: `storage`, `scripting`, `tabs`, Threads host permission
   - 데이터 수집 여부
   - 개인정보 처리방침 URL이 요구되면 URL 입력
6. Distribution/Visibility를 정합니다.
   - 첫 제출은 보통 비공개 또는 trusted testers로 검수해도 됩니다.
   - 공개 배포 전에는 Store listing과 Privacy 항목이 모두 완료되어야 합니다.
7. Google Cloud Console에서 Chrome Web Store API를 활성화합니다.
8. OAuth 클라이언트를 만들고 OAuth Playground 등으로 refresh token을 발급합니다.

## changepacks로 버전 올리기

릴리스 변경사항은 changepacks 로그로 관리합니다.

```bash
bun run changepacks
```

changepack 로그를 main에 반영하면 quality gate가 먼저 실행되고, 이후 `changepacks/action@v0.1.0`이 `Update Versions` PR을 생성합니다. 이 PR은 changepack 로그를 소비해 `package.json` 버전을 올리고, `src/manifest.json` 버전도 같은 값으로 업데이트하는 릴리스 PR입니다.

릴리스 PR을 merge하면 changepacks action이 GitHub Release를 생성합니다. action output에 `package.json` release가 포함되면 Chrome Web Store 배포 job이 이어서 실행됩니다.

로컬에서 미리 버전을 확인해야 할 때만 아래 명령을 사용합니다.

```bash
bun run changepacks:update
bun run manifest:check
```

## 배포 방법

### 자동 게시

main에 push 또는 PR을 열면 GitHub Actions가 typecheck, lint, test, manifest check, build를 먼저 실행합니다. 그 다음 changepacks action이 changepack 상태를 확인합니다. changepacks action output에 `package.json` release가 포함된 main push에서는 Chrome Web Store job이 build, zip 생성, Web Store 업로드/게시를 실행합니다.

```bash
bun run changepacks
git add .changepacks
git commit -m "docs: add release changepack"
git push origin main
```

수동 tag 생성은 필요하지 않습니다. changepacks action이 release/tag 생성을 담당합니다.

### 수동 dry run

GitHub Actions → Changepacks & Chrome Web Store → Run workflow에서 `publish=false`로 실행하면 현재 커밋된 버전으로 업로드만 확인할 수 있습니다. `publish=true`로 실행하면 수동으로 Web Store 게시까지 진행합니다.

## 출시 전 로컬 확인

```bash
bun install
bun run typecheck
bun run lint
bun run test
bun run manifest:check
bun run build
bun run package
```

그 다음 Chrome `chrome://extensions`에서 `dist/`를 unpacked extension으로 로드해 Threads에서 실제 동작을 확인합니다.

## 업로드 산출물 생성

Chrome Web Store에는 `.crx`가 아니라 `.zip` 파일을 업로드합니다. Web Store가 자체적으로 서명하므로 `.pem` 개인키나 `.crx` 파일을 만들 필요가 없습니다.

로컬에서 업로드용 zip을 만들려면 아래 명령을 실행합니다.

```bash
bun run build
bun run package
```

생성물은 `release/threads-country-badge-<version>.zip`입니다. zip 내부에는 `dist/` 폴더 자체가 아니라 `manifest.json`, 번들 JS, `options.html`, `flags/`가 루트에 들어갑니다.

## 주의사항

- Chrome Web Store는 같은 manifest version을 다시 업로드할 수 없습니다. 매 제출마다 version을 올려야 합니다.
- `.crx`와 `.pem`은 Chrome Web Store 업로드에 필요하지 않으며, 특히 `.pem` 개인키는 저장소에 올리면 안 됩니다.
- 첫 게시 또는 권한 변경이 있으면 심사가 길어질 수 있습니다.
- 이전 버전이 심사 중이면 새 업로드가 거절될 수 있습니다.
- refresh token이 폐기되면 `GOOGLE_REFRESH_TOKEN`을 다시 발급해 GitHub Secret을 갱신해야 합니다.
