# Interview Pilot — 실시간 AI 면접 코치

카메라와 마이크를 이용해 모의면접을 진행하고, 답변 내용과 전달 방식을 함께 분석하는 React/Vite 웹앱입니다.

## 이번 구조

- **기기 내 실시간 분석**: MediaPipe와 Web Audio API로 프레이밍, 카메라 방향 시선 근사치, 움직임 안정성, 말속도, 침묵, 음성 에너지를 계산합니다.
- **AI 화상 코칭**: 사용자가 켜 둔 경우 답변마다 최대 10초의 저용량 무음 영상 표본과 최대 4장의 프레임을 AI에 전달합니다.
- **AI 답변 코칭**: 직무·회사·경력·채용공고를 반영해 질문, 답변별 피드백, 개선 답변, 최종 리포트를 생성합니다.
- **설정 자동 저장**: 목표 직무, 회사, 면접 유형, 경력, 질문 수, 경력·공고 내용, AI 화상 분석 여부를 브라우저 `localStorage`에 저장합니다.
- **모바일 대응**: 화면 안전영역, 가상 키보드 높이, 1열 폼, 하단 시작 버튼 영역을 반영합니다.

## AI 모델 선택

기본 우선순위는 다음과 같습니다.

1. `GEMINI_API_KEY`가 있으면 `gemini-2.5-flash-lite`
2. Gemini가 없거나 `AI_PROVIDER=openai`이면 `gpt-4o-mini`
3. `AI_PROVIDER=auto`에서 Gemini 호출이 실패하고 OpenAI 키가 있으면 OpenAI로 자동 대체

Gemini는 영상 입력을 직접 처리합니다. OpenAI 대체 경로에서는 현재 모델의 영상 입력 제한 때문에 추출 프레임만 사용합니다.

## 환경변수

```text
# 권장
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash-lite

# 선택: auto | gemini | openai
AI_PROVIDER=auto

# 선택적 대체 경로
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
```

## 개인정보 처리

- 원본 전체 면접 영상은 서버에 저장하지 않습니다.
- AI 화상 코칭을 켠 경우에만 답변당 최대 10초의 저용량 영상 표본과 최대 4장의 프레임을 전송합니다.
- AI 화상 코칭은 설정 화면에서 끌 수 있습니다.
- 외모, 성별, 나이, 인종, 장애, 건강상태, 성격, 감정을 추론하거나 평가하지 않도록 서버 지침에서 제한합니다.

## 실행 및 빌드

```bash
npm install
npm run dev
npm run build
```

카메라와 마이크는 보안 컨텍스트가 필요하므로 배포 환경에서는 HTTPS를 사용해야 합니다. Chrome 또는 Edge를 권장합니다.

## 호출 경로

1. `src/App.jsx`의 `beginInterview()`가 질문 생성을 요청합니다.
2. `beginQuestion()`이 실시간 지표를 초기화하고 저용량 영상 표본·프레임 수집을 시작합니다.
3. `submitAnswer()`가 전사문, 수치 텔레메트리, 영상 표본을 `InterviewCoachService.evaluateAnswer()`로 전달합니다.
4. `src/services/chatgptService.js`가 `/api/chat`을 호출합니다.
5. `api/chat.js`가 Gemini 우선·OpenAI 대체 정책으로 AI를 호출합니다.
6. 마지막 질문 또는 수동 종료 시 `finishInterview()`가 종합 리포트를 요청합니다.
