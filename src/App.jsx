import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Camera,
  CameraOff,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Gauge,
  Loader2,
  Mic,
  MicOff,
  Play,
  RefreshCw,
  Sparkles,
  Target,
  Video,
} from 'lucide-react';
import InterviewCoachService from './services/chatgptService.js';

const coach = new InterviewCoachService();
const MEDIAPIPE_MODULE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/+esm';
const MEDIAPIPE_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

const DEFAULT_PROFILE = {
  targetRole: '',
  company: '',
  experience: '경력 3~7년',
  interviewType: '직무·인성 혼합',
  language: 'ko-KR',
  resumeHighlights: '',
  jobDescription: '',
};

const EMPTY_LIVE_METRICS = {
  facePresence: 0,
  framing: 0,
  eyeContact: 0,
  stability: 0,
  voiceEnergy: 0,
  visionMode: '대기',
};

const FALLBACK_QUESTIONS = [
  '본인을 가장 잘 보여주는 경력과 이 직무에 지원한 이유를 1분 안에 말씀해 주세요.',
  '최근 가장 어려웠던 업무 문제를 어떻게 해결했는지 구체적으로 설명해 주세요.',
  '의견이 다른 동료나 이해관계자를 설득했던 경험을 말씀해 주세요.',
  '실패하거나 기대한 성과를 내지 못한 경험과 이후 바꾼 행동은 무엇입니까?',
  '입사 후 90일 동안 가장 먼저 확인하고 실행할 일은 무엇입니까?',
];

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const wordCount = (text) => text.trim() ? text.trim().split(/\s+/).length : 0;
const fillerCount = (text) => {
  const normalized = ` ${text.toLowerCase()} `;
  const patterns = [/(^|\s)(음+|어+|그+|저+)(?=\s|[,.!?]|$)/g, /\b(um+|uh+|erm+|like|you know|actually|basically)\b/g];
  return patterns.reduce((count, pattern) => count + (normalized.match(pattern)?.length || 0), 0);
};

function MetricCard({ icon, label, value, hint }) {
  return (
    <div className="metric-card">
      <div className="metric-card__header">
        <span className="metric-card__icon">{icon}</span>
        <span>{label}</span>
      </div>
      <strong>{Math.round(value)}</strong>
      <div className="metric-bar"><span style={{ width: `${clamp(value)}%` }} /></div>
      <small>{hint}</small>
    </div>
  );
}

function ScorePill({ label, value }) {
  return (
    <div className="score-pill">
      <span>{label}</span>
      <strong>{Math.round(Number(value) || 0)}</strong>
    </div>
  );
}

function App() {
  const [phase, setPhase] = useState('setup');
  const [profile, setProfile] = useState(DEFAULT_PROFILE);
  const [question, setQuestion] = useState('');
  const [questionIntent, setQuestionIntent] = useState('');
  const [questionNumber, setQuestionNumber] = useState(1);
  const [totalQuestions, setTotalQuestions] = useState(5);
  const [answer, setAnswer] = useState('');
  const [interimAnswer, setInterimAnswer] = useState('');
  const [history, setHistory] = useState([]);
  const [latestFeedback, setLatestFeedback] = useState(null);
  const [report, setReport] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState(EMPTY_LIVE_METRICS);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const audioContextRef = useRef(null);
  const audioTimerRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const visionTimerRef = useRef(null);
  const questionStartedAtRef = useRef(0);
  const metricsRef = useRef(null);
  const previousFaceCenterRef = useRef(null);

  const resetMetricAccumulator = useCallback(() => {
    metricsRef.current = {
      audioSamples: 0,
      voiceSamples: 0,
      energyValues: [],
      faceSamples: 0,
      facePresentSamples: 0,
      framingValues: [],
      eyeContactValues: [],
      stabilityValues: [],
    };
    previousFaceCenterRef.current = null;
    setLiveMetrics((current) => ({ ...EMPTY_LIVE_METRICS, visionMode: current.visionMode }));
  }, []);

  useEffect(() => {
    resetMetricAccumulator();
  }, [resetMetricAccumulator]);

  useEffect(() => {
    if (phase !== 'interview' || !questionStartedAtRef.current) return undefined;
    const timer = window.setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - questionStartedAtRef.current) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, questionNumber]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (phase !== 'interview' || !video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch(() => {});
  }, [phase, cameraReady]);

  const stopMedia = useCallback(() => {
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
    setIsListening(false);

    if (audioTimerRef.current) window.clearInterval(audioTimerRef.current);
    if (visionTimerRef.current) window.clearInterval(visionTimerRef.current);
    audioTimerRef.current = null;
    visionTimerRef.current = null;

    audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
    faceLandmarkerRef.current?.close?.();
    faceLandmarkerRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraReady(false);
  }, []);

  useEffect(() => () => stopMedia(), [stopMedia]);

  const initializeSpeechRecognition = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return false;

    const recognition = new SpeechRecognition();
    recognition.lang = profile.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) finalText += `${text} `;
        else interimText += text;
      }
      if (finalText) setAnswer((current) => `${current} ${finalText}`.replace(/\s+/g, ' ').trimStart());
      setInterimAnswer(interimText);
    };

    recognition.onerror = (event) => {
      if (!['no-speech', 'aborted'].includes(event.error)) {
        setPermissionError(`음성 인식 오류: ${event.error}`);
      }
    };

    recognition.onend = () => {
      if (shouldListenRef.current) {
        window.setTimeout(() => {
          try { recognition.start(); } catch { /* browser restart race */ }
        }, 250);
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;
    return true;
  }, [profile.language]);

  const initializeAudioMeter = useCallback((stream) => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.72;
    context.createMediaStreamSource(stream).connect(analyser);
    const buffer = new Uint8Array(analyser.fftSize);
    audioContextRef.current = context;

    audioTimerRef.current = window.setInterval(() => {
      analyser.getByteTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) {
        const normalized = (value - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / buffer.length);
      const energy = clamp(rms * 620);
      const metrics = metricsRef.current;
      metrics.audioSamples += 1;
      if (rms > 0.025) metrics.voiceSamples += 1;
      metrics.energyValues.push(energy);
      if (metrics.energyValues.length > 3000) metrics.energyValues.shift();
      setLiveMetrics((current) => ({ ...current, voiceEnergy: average(metrics.energyValues.slice(-30)) }));
    }, 100);
  }, []);

  const initializeVision = useCallback(async () => {
    try {
      const { FaceLandmarker, FilesetResolver } = await import(/* @vite-ignore */ MEDIAPIPE_MODULE);
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
      faceLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.55,
        minFacePresenceConfidence: 0.55,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: true,
      });
      setLiveMetrics((current) => ({ ...current, visionMode: 'MediaPipe 실시간 분석' }));

      visionTimerRef.current = window.setInterval(() => {
        const video = videoRef.current;
        const landmarker = faceLandmarkerRef.current;
        if (!video || !landmarker || video.readyState < 2) return;
        const result = landmarker.detectForVideo(video, performance.now());
        const metrics = metricsRef.current;
        metrics.faceSamples += 1;
        const landmarks = result?.faceLandmarks?.[0];
        if (!landmarks?.length) {
          setLiveMetrics((current) => ({
            ...current,
            facePresence: metrics.faceSamples ? (metrics.facePresentSamples / metrics.faceSamples) * 100 : 0,
          }));
          return;
        }

        metrics.facePresentSamples += 1;
        const xs = landmarks.map((point) => point.x);
        const ys = landmarks.map((point) => point.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const width = maxX - minX;
        const height = maxY - minY;
        const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        const centerOffset = Math.hypot(center.x - 0.5, center.y - 0.43);
        const sizeScore = clamp(100 - Math.abs(width - 0.34) * 260 - Math.abs(height - 0.48) * 180);
        const framingScore = clamp(sizeScore - centerOffset * 160);

        const nose = landmarks[1] || center;
        const leftEye = landmarks[468] || landmarks[33];
        const rightEye = landmarks[473] || landmarks[263];
        const eyeMid = leftEye && rightEye
          ? { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 }
          : center;
        const gazeOffset = Math.abs(nose.x - eyeMid.x) + Math.abs((nose.y - eyeMid.y) - 0.075) * 0.7;
        const eyeContactScore = clamp(100 - gazeOffset * 520 - centerOffset * 45);

        const previous = previousFaceCenterRef.current;
        const movement = previous ? Math.hypot(center.x - previous.x, center.y - previous.y) : 0;
        previousFaceCenterRef.current = center;
        const stabilityScore = clamp(100 - movement * 1800);

        metrics.framingValues.push(framingScore);
        metrics.eyeContactValues.push(eyeContactScore);
        metrics.stabilityValues.push(stabilityScore);
        [metrics.framingValues, metrics.eyeContactValues, metrics.stabilityValues].forEach((array) => {
          if (array.length > 1500) array.shift();
        });

        setLiveMetrics((current) => ({
          ...current,
          facePresence: (metrics.facePresentSamples / metrics.faceSamples) * 100,
          framing: average(metrics.framingValues.slice(-25)),
          eyeContact: average(metrics.eyeContactValues.slice(-25)),
          stability: average(metrics.stabilityValues.slice(-25)),
        }));
      }, 220);
    } catch (error) {
      console.warn('MediaPipe 초기화 실패:', error);
      setLiveMetrics((current) => ({ ...current, visionMode: '카메라 미리보기만 사용' }));
    }
  }, []);

  const enableMedia = useCallback(async () => {
    setPermissionError('');
    try {
      stopMedia();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraReady(true);
      initializeAudioMeter(stream);
      initializeSpeechRecognition();
      await initializeVision();
    } catch (error) {
      setPermissionError(error?.message || '카메라와 마이크 권한을 확인해 주세요.');
      stopMedia();
    }
  }, [initializeAudioMeter, initializeSpeechRecognition, initializeVision, stopMedia]);

  const startListening = useCallback(() => {
    if (!recognitionRef.current && !initializeSpeechRecognition()) {
      setPermissionError('이 브라우저는 실시간 음성 인식을 지원하지 않습니다. Chrome 또는 Edge를 사용해 주세요.');
      return;
    }
    shouldListenRef.current = true;
    setIsListening(true);
    try { recognitionRef.current.start(); } catch { /* already active */ }
  }, [initializeSpeechRecognition]);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    setInterimAnswer('');
    setIsListening(false);
  }, []);

  const beginQuestion = useCallback((nextQuestion, intent = '') => {
    setQuestion(nextQuestion);
    setQuestionIntent(intent);
    setAnswer('');
    setInterimAnswer('');
    setLatestFeedback(null);
    setElapsedSeconds(0);
    resetMetricAccumulator();
    questionStartedAtRef.current = Date.now();
    window.setTimeout(startListening, 350);
  }, [resetMetricAccumulator, startListening]);

  const beginInterview = async (event) => {
    event.preventDefault();
    if (!profile.targetRole.trim()) return;
    setIsBusy(true);
    setPermissionError('');
    try {
      if (!cameraReady) await enableMedia();
      const response = await coach.startSession(profile);
      setPhase('interview');
      setQuestionNumber(1);
      setHistory([]);
      beginQuestion(response.question || FALLBACK_QUESTIONS[0], response.intent || '지원 동기와 핵심 경력 확인');
    } catch (error) {
      setPermissionError(`AI 연결 오류: ${error.message}. 기본 질문으로 진행합니다.`);
      setPhase('interview');
      setQuestionNumber(1);
      setHistory([]);
      beginQuestion(FALLBACK_QUESTIONS[0], '지원 동기와 핵심 경력 확인');
    } finally {
      setIsBusy(false);
    }
  };

  const buildTelemetry = useCallback(() => {
    const metrics = metricsRef.current;
    const durationSeconds = Math.max(1, Math.round((Date.now() - questionStartedAtRef.current) / 1000));
    const words = wordCount(answer);
    return {
      durationSeconds,
      wordsPerMinute: Math.round((words / durationSeconds) * 60),
      fillerCount: fillerCount(answer),
      silenceRatio: metrics.audioSamples ? Number((1 - metrics.voiceSamples / metrics.audioSamples).toFixed(3)) : 0,
      voiceEnergy: Math.round(average(metrics.energyValues)),
      facePresence: Math.round(metrics.faceSamples ? (metrics.facePresentSamples / metrics.faceSamples) * 100 : 0),
      framing: Math.round(average(metrics.framingValues)),
      eyeContact: Math.round(average(metrics.eyeContactValues)),
      stability: Math.round(average(metrics.stabilityValues)),
      visionMode: liveMetrics.visionMode,
    };
  }, [answer, liveMetrics.visionMode]);

  const finishInterview = useCallback(async (completedHistory) => {
    setIsBusy(true);
    stopListening();
    try {
      const allTelemetry = completedHistory.map((item) => item.telemetry || {});
      const sessionMetrics = {
        durationSeconds: allTelemetry.reduce((sum, item) => sum + (item.durationSeconds || 0), 0),
        wordsPerMinute: average(allTelemetry.map((item) => item.wordsPerMinute || 0)),
        fillerCount: allTelemetry.reduce((sum, item) => sum + (item.fillerCount || 0), 0),
        silenceRatio: average(allTelemetry.map((item) => item.silenceRatio || 0)),
        voiceEnergy: average(allTelemetry.map((item) => item.voiceEnergy || 0)),
        facePresence: average(allTelemetry.map((item) => item.facePresence || 0)),
        framing: average(allTelemetry.map((item) => item.framing || 0)),
        eyeContact: average(allTelemetry.map((item) => item.eyeContact || 0)),
        stability: average(allTelemetry.map((item) => item.stability || 0)),
        visionMode: liveMetrics.visionMode,
      };
      const finalReport = await coach.finishSession({ profile, history: completedHistory, sessionMetrics });
      setReport(finalReport);
    } catch (error) {
      setReport({
        overallScore: Math.round(average(completedHistory.map((item) => item.feedback?.overallScore || 0))),
        verdict: 'AI 종합 리포트를 불러오지 못해 세션 점수만 표시합니다.',
        scorecard: {},
        strengths: ['각 답변별 피드백을 다시 확인해 주세요.'],
        priorities: [error.message],
        sevenDayPlan: [],
        sampleClosing: '',
        finalComment: 'OPENAI_API_KEY와 배포 로그를 확인해 주세요.',
      });
    } finally {
      setPhase('report');
      setIsBusy(false);
      stopMedia();
    }
  }, [liveMetrics.visionMode, profile, stopListening, stopMedia]);

  const submitAnswer = async () => {
    const cleanAnswer = `${answer} ${interimAnswer}`.replace(/\s+/g, ' ').trim();
    if (cleanAnswer.length < 2 || isBusy) return;
    stopListening();
    setIsBusy(true);
    const telemetry = buildTelemetry();
    try {
      const response = await coach.evaluateAnswer({
        profile,
        transcript: cleanAnswer,
        history,
        telemetry,
        questionNumber,
        totalQuestions,
      });
      const turn = {
        question,
        intent: questionIntent,
        answer: cleanAnswer,
        telemetry,
        feedback: response.feedback,
      };
      const completedHistory = [...history, turn];
      setHistory(completedHistory);
      setLatestFeedback(response.feedback);

      const isLast = questionNumber >= totalQuestions || !response.nextQuestion;
      if (isLast) {
        await finishInterview(completedHistory);
      } else {
        setQuestionNumber((current) => current + 1);
        window.setTimeout(() => {
          beginQuestion(
            response.nextQuestion || FALLBACK_QUESTIONS[Math.min(questionNumber, FALLBACK_QUESTIONS.length - 1)],
            response.nextIntent || '후속 역량 검증',
          );
        }, 1300);
      }
    } catch (error) {
      const fallbackFeedback = {
        overallScore: 0,
        summary: `AI 피드백 생성 실패: ${error.message}`,
        strengths: [],
        improvements: ['서버 환경변수와 API 응답을 확인한 뒤 다시 평가하세요.'],
        scores: {},
        betterAnswer: '',
        deliveryNote: '',
      };
      setLatestFeedback(fallbackFeedback);
      setPermissionError(error.message);
    } finally {
      setIsBusy(false);
    }
  };

  const restart = () => {
    stopMedia();
    setPhase('setup');
    setQuestion('');
    setQuestionIntent('');
    setQuestionNumber(1);
    setAnswer('');
    setInterimAnswer('');
    setHistory([]);
    setLatestFeedback(null);
    setReport(null);
    setPermissionError('');
    setElapsedSeconds(0);
    resetMetricAccumulator();
  };

  const displayAnswer = `${answer}${interimAnswer ? ` ${interimAnswer}` : ''}`;
  const progress = ((questionNumber - 1) / totalQuestions) * 100;
  const feedbackScores = latestFeedback?.scores || {};
  const reportScorecard = report?.scorecard || {};
  const liveStatus = useMemo(() => {
    if (!cameraReady) return '카메라 대기';
    if (isListening) return '답변 인식 중';
    if (isBusy) return 'AI 분석 중';
    return '면접 준비 완료';
  }, [cameraReady, isBusy, isListening]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark"><Sparkles size={20} /></span>
          <div>
            <strong>Interview Pilot</strong>
            <small>실시간 AI 면접 코치</small>
          </div>
        </div>
        <div className="privacy-note">영상은 브라우저에서 분석되며 서버로 전송하지 않습니다.</div>
      </header>

      {phase === 'setup' && (
        <main className="setup-layout">
          <section className="hero-panel">
            <span className="eyebrow">LIVE INTERVIEW SIMULATOR</span>
            <h1>말의 내용과 전달 방식을<br />동시에 교정합니다.</h1>
            <p>직무별 질문, 실시간 전사, 시선·프레이밍·말속도 분석, 답변 재작성과 최종 훈련계획을 한 세션에서 제공합니다.</p>
            <div className="feature-grid">
              <div><Video size={20} /><strong>화상 분석</strong><span>얼굴 위치·시선 정렬·움직임</span></div>
              <div><Mic size={20} /><strong>음성 분석</strong><span>말속도·침묵·군더더기 표현</span></div>
              <div><Target size={20} /><strong>직무 맞춤 질문</strong><span>경력·공고 기반 후속 질문</span></div>
              <div><BarChart3 size={20} /><strong>정량 리포트</strong><span>콘텐츠·구조·전달력 점수</span></div>
            </div>
          </section>

          <section className="setup-card">
            <div className="section-heading">
              <span>01</span>
              <div><h2>면접 조건 설정</h2><p>최소한 목표 직무를 입력하세요.</p></div>
            </div>
            <form onSubmit={beginInterview}>
              <label>목표 직무 *</label>
              <input value={profile.targetRole} onChange={(event) => setProfile({ ...profile, targetRole: event.target.value })} placeholder="예: 공기업 사내변호사, 백엔드 개발자" required />
              <div className="two-column">
                <div><label>지원 회사</label><input value={profile.company} onChange={(event) => setProfile({ ...profile, company: event.target.value })} placeholder="회사명 또는 산업군" /></div>
                <div><label>면접 유형</label><select value={profile.interviewType} onChange={(event) => setProfile({ ...profile, interviewType: event.target.value })}><option>직무·인성 혼합</option><option>직무 심층</option><option>임원 면접</option><option>압박 면접</option><option>영어 면접</option></select></div>
              </div>
              <div className="two-column">
                <div><label>경력 수준</label><select value={profile.experience} onChange={(event) => setProfile({ ...profile, experience: event.target.value })}><option>신입</option><option>경력 1~3년</option><option>경력 3~7년</option><option>경력 7~12년</option><option>리더·임원</option></select></div>
                <div><label>질문 수</label><select value={totalQuestions} onChange={(event) => setTotalQuestions(Number(event.target.value))}><option value={3}>3문항 · 빠른 점검</option><option value={5}>5문항 · 표준</option><option value={7}>7문항 · 심층</option></select></div>
              </div>
              <label>핵심 경력·성과</label>
              <textarea value={profile.resumeHighlights} onChange={(event) => setProfile({ ...profile, resumeHighlights: event.target.value })} placeholder="프로젝트, 성과 수치, 담당 역할, 강점 등을 입력하세요." rows={4} />
              <label>채용공고 또는 요구역량</label>
              <textarea value={profile.jobDescription} onChange={(event) => setProfile({ ...profile, jobDescription: event.target.value })} placeholder="주요 업무와 자격요건을 붙여 넣으면 질문 정밀도가 높아집니다." rows={4} />
              {permissionError && <div className="alert">{permissionError}</div>}
              <button className="primary-button" type="submit" disabled={isBusy || !profile.targetRole.trim()}>
                {isBusy ? <Loader2 className="spin" size={19} /> : <Play size={19} />} 면접 시작
              </button>
              <p className="browser-note">카메라·마이크·음성 인식을 위해 HTTPS의 Chrome 또는 Edge 사용을 권장합니다.</p>
            </form>
          </section>
        </main>
      )}

      {phase === 'interview' && (
        <main className="interview-layout">
          <section className="stage-panel">
            <div className="stage-toolbar">
              <div className="live-badge"><span /> {liveStatus}</div>
              <div className="timer">{formatTime(elapsedSeconds)}</div>
            </div>
            <div className="video-frame">
              <video ref={videoRef} playsInline muted autoPlay />
              {!cameraReady && <div className="video-placeholder"><CameraOff size={40} /><span>카메라 연결 대기</span></div>}
              <div className="framing-guide"><span /></div>
              <div className="video-status"><Camera size={15} /> {liveMetrics.visionMode}</div>
            </div>
            <div className="live-metrics">
              <MetricCard icon={<Camera size={17} />} label="프레이밍" value={liveMetrics.framing} hint="화면 중심·거리" />
              <MetricCard icon={<Target size={17} />} label="시선 정렬" value={liveMetrics.eyeContact} hint="카메라 방향 근사치" />
              <MetricCard icon={<Gauge size={17} />} label="안정성" value={liveMetrics.stability} hint="과도한 움직임 억제" />
              <MetricCard icon={<Mic size={17} />} label="음성 에너지" value={liveMetrics.voiceEnergy} hint="마이크 입력 강도" />
            </div>
          </section>

          <section className="coach-panel">
            <div className="progress-header">
              <div><span>QUESTION {questionNumber}</span><strong>{questionNumber} / {totalQuestions}</strong></div>
              <div className="progress-track"><span style={{ width: `${Math.max(progress, 4)}%` }} /></div>
            </div>

            <article className="question-card">
              <div className="ai-avatar"><Sparkles size={21} /></div>
              <div><span className="question-intent">{questionIntent || '면접 질문'}</span><h2>{question}</h2></div>
            </article>

            <div className="answer-box">
              <div className="answer-box__header"><span>실시간 답변 전사</span><span>{wordCount(displayAnswer)} words</span></div>
              <textarea value={displayAnswer} onChange={(event) => { setAnswer(event.target.value); setInterimAnswer(''); }} placeholder="마이크 버튼을 누르고 답변하거나 직접 입력하세요." />
              <div className="answer-actions">
                <button className={`mic-button ${isListening ? 'is-listening' : ''}`} type="button" onClick={isListening ? stopListening : startListening}>
                  {isListening ? <MicOff size={18} /> : <Mic size={18} />} {isListening ? '인식 중지' : '음성 인식'}
                </button>
                <button className="submit-button" type="button" onClick={submitAnswer} disabled={isBusy || displayAnswer.trim().length < 2}>
                  {isBusy ? <Loader2 className="spin" size={18} /> : <ChevronRight size={18} />} 답변 제출·분석
                </button>
              </div>
            </div>

            {latestFeedback && (
              <article className="feedback-card">
                <div className="feedback-card__title"><CheckCircle2 size={20} /><strong>직전 답변 코칭</strong><span>{latestFeedback.overallScore || 0}점</span></div>
                <p>{latestFeedback.summary}</p>
                <div className="score-row">
                  <ScorePill label="내용" value={feedbackScores.content} />
                  <ScorePill label="구조" value={feedbackScores.structure} />
                  <ScorePill label="구체성" value={feedbackScores.specificity} />
                  <ScorePill label="전달" value={feedbackScores.delivery} />
                </div>
                {latestFeedback.improvements?.length > 0 && <div className="feedback-list"><strong>우선 개선</strong>{latestFeedback.improvements.map((item) => <span key={item}>• {item}</span>)}</div>}
              </article>
            )}

            {permissionError && <div className="alert">{permissionError}</div>}
            <button className="ghost-button" type="button" onClick={() => finishInterview(history)} disabled={isBusy || history.length === 0}><CircleStop size={17} /> 현재까지로 종료</button>
          </section>
        </main>
      )}

      {phase === 'report' && (
        <main className="report-layout">
          <section className="report-hero">
            <span className="eyebrow">INTERVIEW REPORT</span>
            <div className="report-score"><strong>{Math.round(report?.overallScore || 0)}</strong><span>/ 100</span></div>
            <h1>{report?.verdict || '면접 세션이 완료되었습니다.'}</h1>
            <p>{report?.finalComment}</p>
            <button className="primary-button compact" onClick={restart}><RefreshCw size={18} /> 새 면접 시작</button>
          </section>

          <section className="report-content">
            <article className="report-card">
              <h2>역량 점수</h2>
              <div className="report-score-grid">
                <MetricCard icon={<Target size={17} />} label="내용" value={reportScorecard.content} hint="질문 적합성" />
                <MetricCard icon={<BarChart3 size={17} />} label="구조" value={reportScorecard.structure} hint="STAR·PREP 구성" />
                <MetricCard icon={<Sparkles size={17} />} label="구체성" value={reportScorecard.specificity} hint="사례·수치·역할" />
                <MetricCard icon={<Mic size={17} />} label="전달력" value={reportScorecard.delivery} hint="속도·명료도" />
                <MetricCard icon={<Gauge size={17} />} label="자신감" value={reportScorecard.confidence} hint="일관성과 안정성" />
              </div>
            </article>

            <div className="report-columns">
              <article className="report-card"><h2>강점</h2><ul>{report?.strengths?.map((item) => <li key={item}>{item}</li>)}</ul></article>
              <article className="report-card priority"><h2>최우선 개선과제</h2><ol>{report?.priorities?.map((item) => <li key={item}>{item}</li>)}</ol></article>
            </div>

            <article className="report-card"><h2>7일 훈련 계획</h2><div className="plan-grid">{report?.sevenDayPlan?.map((item, index) => <div key={item}><span>DAY {index + 1}</span><p>{item}</p></div>)}</div></article>
            {report?.sampleClosing && <article className="report-card sample"><h2>마무리 답변 예시</h2><p>{report.sampleClosing}</p></article>}

            <article className="report-card">
              <h2>문항별 기록</h2>
              <div className="history-list">
                {history.map((item, index) => (
                  <details key={`${item.question}-${index}`}>
                    <summary><span>Q{index + 1}</span><strong>{item.question}</strong><em>{item.feedback?.overallScore || 0}점</em></summary>
                    <div><b>답변</b><p>{item.answer}</p>{item.feedback?.betterAnswer && <><b>개선 답변</b><p>{item.feedback.betterAnswer}</p></>}</div>
                  </details>
                ))}
              </div>
            </article>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
