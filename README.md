# 🍌 English Conversation with Nanobana

나노바나나와 함께하는 영어회화 연습 앱입니다. 실시간 음성 인식과 문법 교정 기능을 통해 자연스러운 영어 대화를 연습할 수 있습니다.

## ✨ 주요 기능

- **🤖 ChatGPT AI 통합**: OpenAI의 ChatGPT API를 사용한 자연스러운 대화
- **🎤 실시간 음성 인식**: 마이크를 통해 영어로 말하면 자동으로 텍스트로 변환
- **📝 AI 문법 교정**: ChatGPT가 문법을 분석하고 상세한 설명과 함께 교정
- **🍌 나노바나나 선생님**: 귀여운 나노바나나가 대화를 자연스럽게 이끌어감
- **🗣️ 원어민 음성 합성**: 고품질 원어민 음성으로 자연스러운 발음
- **💬 유기적 대화**: 미리 정해진 응답이 아닌 실제 AI와의 자연스러운 대화
- **🧠 대화 기억**: 이전 대화 내용을 기억하여 연속적인 대화 가능
- **💬 다양한 주제**: 일반, 일상생활, 음식, 여행, 직업, 취미 등 다양한 주제
- **📱 반응형 디자인**: 모바일과 데스크톱에서 모두 사용 가능
- **🎨 화상전화 느낌**: 실제 화상통화하는 것 같은 UI/UX

## 🚀 설치 및 실행

### 1. 프로젝트 클론
```bash
git clone <repository-url>
cd english-conversation-app
```

### 2. 의존성 설치
```bash
npm install
```

### 3. 개발 서버 실행
```bash
npm run dev
```

### 4. OpenAI API 키 설정
1. [OpenAI Platform](https://platform.openai.com/api-keys)에서 API 키를 발급받으세요
2. 앱 실행 후 우측 상단의 설정 버튼(⚙️)을 클릭하세요
3. API 키를 입력하고 "Save & Start" 버튼을 클릭하세요

### 5. 브라우저에서 확인
브라우저에서 `http://localhost:3000`으로 접속하여 앱을 사용할 수 있습니다.

## 🎯 사용 방법

1. **API 키 설정**: 우측 상단 설정 버튼을 클릭하여 OpenAI API 키를 입력하세요
2. **음성 입력**: 마이크 버튼을 클릭하고 영어로 말하세요
3. **텍스트 입력**: 키보드로 직접 입력할 수도 있습니다
4. **AI 문법 교정**: ChatGPT가 문법을 분석하고 상세한 설명과 함께 교정해줍니다
5. **자연스러운 대화**: 나노바나나가 실제 AI처럼 자연스럽게 대화를 이어갑니다
6. **주제 변경**: 좌측의 주제 버튼을 클릭하여 대화 주제를 바꿀 수 있습니다
7. **대화 초기화**: Reset 버튼으로 대화를 새로 시작할 수 있습니다

## 🛠️ 기술 스택

- **Frontend**: React 18, Vite
- **AI**: OpenAI ChatGPT API (GPT-3.5-turbo)
- **Styling**: CSS3 with animations
- **Icons**: Lucide React
- **Animations**: Framer Motion
- **Speech**: Web Speech API (음성 인식 & 합성)

## 📱 브라우저 지원

- Chrome (권장)
- Edge
- Safari
- Firefox

> **참고**: 음성 인식 기능은 HTTPS 환경에서만 작동합니다.

## 🎨 주요 컴포넌트

- **App.jsx**: 메인 앱 컴포넌트
- **index.css**: 전체 스타일링
- **package.json**: 프로젝트 설정 및 의존성

## 🔧 커스터마이징

### 문법 검사 규칙 추가
`App.jsx`의 `checkGrammar` 함수에서 더 많은 문법 규칙을 추가할 수 있습니다.

### 대화 응답 추가
`generateNanobanaResponse` 함수에서 나노바나나의 응답을 커스터마이징할 수 있습니다.

### 새로운 주제 추가
`changeTopic` 함수와 관련 응답 배열에 새로운 주제를 추가할 수 있습니다.

## 📄 라이선스

MIT License

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📞 문의

프로젝트에 대한 문의사항이 있으시면 이슈를 생성해 주세요.

---

🍌 **Happy English Learning with Nanobana!** 🍌

