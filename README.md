# Interview Pilot — 실시간 AI 면접 코치

카메라와 마이크를 이용해 모의면접을 진행하고, 답변 내용과 전달 방식을 함께 분석하는 React/Vite 웹앱입니다.

## 핵심 기능

- 직무·회사·경력·채용공고 기반 면접 질문 생성
- Web Speech API를 이용한 실시간 음성 전사
- Web Audio API를 이용한 말속도, 침묵 비율, 음성 에너지, 군더더기 표현 측정
- MediaPipe Face Landmarker를 이용한 얼굴 존재, 프레이밍, 시선 정렬 근사치, 움직임 안정성 분석
- 답변별 내용·구조·구체성·전달력·자신감 피드백
- 답변을 STAR/PREP 구조로 재작성한 개선 예시
- 전체 점수, 강점, 우선 개선과제, 7일 훈련계획이 포함된 최종 리포트

## 개인정보 처리 원칙

- 카메라 프레임은 브라우저 내 MediaPipe에서 처리하며 서버로 업로드하지 않습니다.
- 서버에는 사용자가 말한 전사문과 요약된 수치 지표만 전달합니다.
- 외모, 성별, 나이, 인종, 장애, 건강상태 또는 감정을 추론하거나 평가하지 않습니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 Vite가 표시한 주소로 접속합니다. 카메라·마이크는 보안 컨텍스트가 필요하므로 배포 환경에서는 HTTPS를 사용해야 합니다.

## 환경변수

Vercel 프로젝트에 다음 환경변수를 설정합니다.

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
```

`OPENAI_MODEL`은 선택 사항입니다. 미설정 시 `gpt-4o-mini`를 사용합니다. API 키는 브라우저에 저장하지 않고 `api/chat.js` 서버리스 함수에서만 사용합니다.

## 호출 경로

1. `src/App.jsx`의 `beginInterview()`가 `InterviewCoachService.startSession()`을 호출합니다.
2. `src/services/chatgptService.js`가 `/api/chat`으로 요청합니다.
3. `api/chat.js`가 입력을 길이 제한·정규화한 뒤 OpenAI Responses API를 호출합니다.
4. 답변 제출 시 `submitAnswer()`가 음성·영상 텔레메트리와 전사문을 함께 전송합니다.
5. 마지막 질문 또는 수동 종료 시 `finishInterview()`가 종합 리포트를 요청합니다.

## 브라우저 지원

- Chrome 또는 Edge 권장
- Web Speech API가 없는 브라우저에서는 직접 텍스트 입력 가능
- MediaPipe 로딩이 실패하면 카메라 미리보기와 음성 분석만으로 계속 진행

## 빌드

```bash
npm run build
```
