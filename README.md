# Interview Pilot — 구조화 AI 면접 코치

웹캠과 마이크를 이용해 실제 면접 흐름으로 연습하고 **질문별 평가기준·답변 근거·STAR/PREP 구조·말하기·화상 전달·사람 면접관 인상**을 함께 분석하는 React/Vite 웹앱입니다.

## 핵심 기능

### 구조화 면접과 질문은행

- 직무·회사·경력·채용공고·집중 역량을 기반으로 AI 질문을 생성합니다.
- 공통질문 60개 + 업무관련 질문 50개의 기본 질문은행을 제공합니다.
- PDF/DOCX/TXT/MD/RTF 이력서에서 직무·프로젝트·성과 근거를 뽑아 맞춤 꼬리질문을 생성합니다.
- 공기업/NCS 맥락에서는 경험면접·상황면접·직무기술서 기반 질문을 섞습니다.
- 각 질문은 `questionType`, `competency`, `framework`, `targetSeconds`, `rubric`을 갖습니다.
- BEI는 Situation/Task보다 실제 Action·판단 근거·Result를 우선 검증합니다.

### 답변 내용 분석

답변마다 다음 축을 구조적으로 평가합니다.

- 질문 관련성
- STAR / PREP / CAR 구조
- 구체적 행동·수치·결과 근거
- 전달력
- 직무 연결
- 질문별 rubric 점수와 근거
- 핵심 역량 및 후속 질문

`/api/chat`은 현재 Gemini 3.1 Flash-Lite를 우선 사용하고 OpenAI를 선택적 fallback으로 사용합니다. 따라서 UI에서는 특정 모델 이름이 아니라 **내용 평가 점수**와 **사람 면접관 인상 점수**를 별도 축으로 취급합니다.

## 실제 사람 면접관 관점 코칭

`src/App.jsx`의 실제 React 상태는 `src/InterviewRuntimeContext.jsx`를 통해 공유됩니다. `src/HumanInterviewEvaluator.jsx`는 더 이상 다른 컴포넌트의 DOM을 `querySelector` 또는 텍스트 정규식으로 읽지 않으며 250ms DOM polling도 하지 않습니다.

사람면접 evaluator는 다음 데이터를 사용합니다.

- 질문을 듣는 장면 최대 3프레임
- 답변 장면 최대 4프레임
- App의 MediaPipe 시선·프레이밍·안정성 상태
- Web Audio 기반 평균 음성 에너지·강약 변화·말하는 비율·침묵·속도

평가 축:

- 첫인상/기본 전문성
- 시선
- 표정
- 자세
- 제스처
- 경청
- 목소리 강약
- 말 빠르기·pause
- 종합 면접관 인상

외모의 매력, 얼굴 생김새, 나이, 성별, 인종, 장애, 건강상태, 사회경제적 배경을 평가하지 않으며 성격·감정·정직성·자신감을 영상에서 추론하지 않습니다.

### 근거 신뢰도 표시

사람면접 결과에는 `evidenceConfidence`를 점수 옆 경고 배지로 항상 표시합니다. 분석에 사용한 경청/답변 프레임 수와 `limitations`도 접지 않고 노출합니다. 최대 몇 장의 저해상도 스냅샷과 보조 텔레메트리로 평가한다는 한계를 명확히 보여 줍니다.

### 내용 점수와 인상 점수 괴리

두 점수가 30점 이상 벌어지면 별도 설명 카드가 나타납니다.

- 내용 점수가 높고 인상 점수가 낮음 → 시선·자세·강약·속도 등 전달 방식을 우선 개선
- 인상 점수가 높고 내용 점수가 낮음 → 질문 적합성·근거·답변 구조를 우선 개선

두 점수는 합산하지 않으며 한 축이 다른 축을 무효화하지 않습니다.

## MediaPipe

브라우저 의존성을 `@mediapipe/tasks-vision@0.10.35`로 고정하고 Face Landmarker model asset도 `float16/1`로 고정합니다.

현재 Tasks Face Landmarker의 478-point output을 기준으로 `landmarks.length >= 478`일 때만 468/473 홍채 landmark를 사용합니다. 그렇지 않으면 33/263 눈 landmark로 명시적으로 fallback합니다.

## 음성 인식

### Chrome / Edge

Web Speech API가 있으면 기존 실시간 SpeechRecognition을 사용합니다.

### Safari / Firefox fallback

Web Speech API가 없으면 `MediaRecorder`로 답변 오디오를 녹음합니다. 사용자가 마이크를 중지하면 `/api/transcribe`가 Gemini 3.1 Flash-Lite에 오디오를 보내 정확한 전사를 반환하고 textarea를 채웁니다.

- 최대 약 2분 녹음
- 클라이언트에서 2.5MB를 초과하는 녹음은 거부
- 서버에서 약 3.9MB request-body 제한 재검증
- AI 전사 중에는 답변 제출 비활성화

## 영어 발음·억양 평가

선택적으로 Azure Speech Pronunciation Assessment를 사용할 수 있습니다. 영어 면접 유형에서는 답변 중 수집한 PCM을 16kHz mono WAV로 변환해 `/api/pronunciation`으로 전송합니다.

표시 항목:

- Pronunciation score
- Accuracy
- Fluency
- Completeness
- Prosody(강세·억양·속도·리듬)
- 우선 교정할 단어

Azure 환경변수가 없으면 일반 면접 기능은 그대로 동작하며 UI에 발음평가 미설정 상태만 표시합니다. 브라우저에는 Azure key를 노출하지 않습니다.

## API 보안

모든 비용 발생 POST 경로는 `server/requestGuard.js`를 공유합니다.

- 클라이언트 IP 기반 1분 window rate limit
- same-origin 또는 `ALLOWED_ORIGINS`에 명시된 Origin만 허용
- `application/json` Content-Type 검증
- Content-Length 및 직렬화된 요청 크기 제한
- Vercel API와 Sites/Worker adapter에 동일 정책 적용

기본 제한:

- `/api/chat`: 24 requests/min/IP
- `/api/human-interview`: 12 requests/min/IP
- `/api/question-bank`: 8 requests/min/IP
- `/api/transcribe`: 15 requests/min/IP
- `/api/pronunciation`: 8 requests/min/IP
- `/api/chat` diagnostics GET: 30 requests/min/IP

현재 limiter는 각 서버리스 인스턴스의 메모리 Map을 사용하므로 **즉시 비용 폭주 방어용 최소 보호장치**입니다. 여러 인스턴스를 아우르는 강한 전역 quota가 필요하면 Vercel Firewall 또는 Redis/KV 기반 distributed rate limiter로 교체해야 합니다.

## 로컬/민감 아티팩트

`.gitignore`에는 다음이 포함됩니다.

```text
node_modules/
dist/
.env
.env.*
!.env.example
%AppData%/
.openai/
```

현재 HEAD에서는 `%AppData%/`와 `.openai/`를 제거합니다. 기존 Git 커밋 객체에서까지 완전히 제거하려면 별도의 history rewrite가 필요합니다. 히스토리 재작성은 모든 clone/PR ref에 영향을 주므로 정상적인 코드 변경과 분리해서 수행해야 합니다.

## 환경변수

```text
AI_PROVIDER=auto
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-3.1-flash-lite

# optional OpenAI fallback
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini

# optional comma-separated extra browser origins
ALLOWED_ORIGINS=

# optional English pronunciation/prosody
AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
```

## 주요 호출 경로

### 면접 내용 평가

`App.submitAnswer()` → `InterviewCoachService.evaluateAnswer()` → `/api/chat` → `api/chat.js` 또는 `server/index.js` → `server/coach.js` → Gemini 우선 / OpenAI fallback

### 사람 면접관 인상 평가

`App state` → `InterviewRuntimeContext` → `HumanInterviewEvaluator` → `/api/human-interview` → `server/humanInterview.js` → Gemini 3.1 Flash-Lite

### Web Speech 미지원 fallback

`App.startListening()` → MediaRecorder → `InterviewCoachService.transcribeAudio()` → `/api/transcribe` → `server/transcribe.js` → Gemini 3.1 Flash-Lite

### 영어 발음평가

`HumanInterviewEvaluator` → 16kHz WAV → `/api/pronunciation` → `server/pronunciation.js` → Azure Speech (설정 시)

## 실행

```bash
npm install
npm run dev
npm run build
```

카메라와 마이크는 HTTPS secure context가 필요합니다.

## 회귀 테스트

1. Chrome/Edge에서 3문항 코칭모드 시작 → 질문 종료 후 브라우저 STT 자동 시작 확인.
2. Safari/Firefox 또는 SpeechRecognition을 비활성화한 환경 → 마이크 시작/중지 후 Gemini 전사로 textarea가 채워지는지 확인.
3. 답변 제출 → 기존 내용/rubric/STAR 피드백과 별도로 사람 면접관 패널이 생성되는지 확인.
4. 사람면접 패널에 `근거 신뢰도 N/100`, 실제 프레임 수, limitations가 항상 보이는지 확인.
5. 내용점수와 사람 인상점수를 의도적으로 30점 이상 벌어지게 답변 → 괴리 설명 카드 확인.
6. 영어 면접 + Azure env 설정 → 발음/유창성/Prosody 점수 확인. env 미설정 → 일반 면접은 정상이고 발음평가만 unavailable 확인.
7. 다른 Origin에서 API POST → 403 확인.
8. 동일 IP에서 각 route 제한 초과 → 429 확인.
9. `/api/chat?probe=1` → Gemini generation probe가 계속 성공하는지 확인.
10. MediaPipe 표시가 `0.10.35` 기반이고 478-point/eye fallback 코드가 빌드되는지 확인.
