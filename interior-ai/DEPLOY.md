# Vercel 배포 가이드

## 1단계 — GitHub에 올리기
```bash
git init
git add .
git commit -m "initial commit"
# GitHub에서 새 repo 만들고:
git remote add origin https://github.com/YOUR_ID/interior-ai.git
git push -u origin main
```

## 2단계 — Vercel 배포
1. https://vercel.com 접속 → GitHub 로그인
2. "New Project" → 방금 만든 repo 선택
3. Deploy 클릭

## 3단계 — 환경변수 설정 (필수!)
Vercel 대시보드 → Settings → Environment Variables에 추가:

| 변수명 | 값 |
|---|---|
| `ANTHROPIC_API_KEY` | sk-ant-... |
| `OPENAI_API_KEY` | sk-... |

## 4단계 — KV 연결 (IP 횟수 제한용)
1. Vercel 대시보드 → Storage 탭
2. "Create Database" → KV 선택
3. 프로젝트에 연결하면 환경변수 자동 주입됨

## 완료!
- 환경변수 저장 후 Redeploy하면 적용됩니다
- KV 없이 배포하면 횟수 제한 없이 동작합니다 (로컬 개발 시)
