import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3, Briefcase, Camera, CameraOff, Check, CheckCircle2, ChevronRight, CircleStop,
  Eye, EyeOff, Gauge, ListChecks, Loader2, Mic, MicOff, Play, RefreshCw, RotateCcw, Save,
  Sparkles, Target, TrendingUp, Video,
} from 'lucide-react';
import InterviewCoachService from './services/chatgptService.js';

const coach = new InterviewCoachService();
const SETTINGS_KEY = 'interview-pilot-settings-v3';
const LEGACY_SETTINGS_KEY = 'interview-pilot-settings-v2';
const SESSION_HISTORY_KEY = 'interview-pilot-session-history-v1';
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
  focusCompetencies: '',
  sessionMode: 'coach',
  aiVisionEnabled: true,
};

const EMPTY_LIVE_METRICS = {
  facePresence: 0, framing: 0, eyeContact: 0, stability: 0, voiceEnergy: 0, visionMode: '대기',
};

const FALLBACK_QUESTIONS = [
  '본인을 가장 잘 보여주는 경력과 이 직무에 지원한 이유를 1분 안에 말씀해 주세요.',
  '최근 가장 어려웠던 업무 문제를 어떻게 해결했는지 구체적으로 설명해 주세요.',
  '의견이 다른 동료나 이해관계자를 설득했던 경험을 말씀해 주세요.',
  '실패하거나 기대한 성과를 내지 못한 경험과 이후 바꾼 행동은 무엇입니까?',
  '입사 후 90일 동안 가장 먼저 확인하고 실행할 일은 무엇입니까?',
];

const DEFAULT_QUESTION_META = {
  questionType: '경험·역량',
  competency: '직무 적합성',
  framework: 'STAR',
  targetSeconds: 60,
  rubric: ['질문에 직접 답했는가', '구체적인 행동과 근거가 있는가', '결과·학습을 직무와 연결했는가'],
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const wordCount = (text) => text.trim() ? text.trim().split(/\s+/).length : 0;
const fillerCount = (text) => {
  const normalized = ` ${text.toLowerCase()} `;
  const patterns = [/(^|\s)(음+|어+|그+|저+)(?=\s|[,.!?]|$)/g, /\b(um+|uh+|erm+|like|you know|actually|basically)\b/g];
  return patterns.reduce((count, pattern) => count + (normalized.match(pattern)?.length || 0), 0);
};
const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const normalizeQuestionMeta = (meta = {}, intent = '') => ({
  ...DEFAULT_QUESTION_META,
  ...(meta || {}),
  competency: String(meta?.competency || intent || DEFAULT_QUESTION_META.competency),
  rubric: Array.isArray(meta?.rubric) && meta.rubric.length ? meta.rubric.slice(0, 4) : DEFAULT_QUESTION_META.rubric,
  targetSeconds: clamp(Number(meta?.targetSeconds) || DEFAULT_QUESTION_META.targetSeconds, 30, 180),
});

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem(LEGACY_SETTINGS_KEY) || '{}';
    const parsed = JSON.parse(raw);
    return {
      profile: { ...DEFAULT_PROFILE, ...(parsed.profile || {}) },
      totalQuestions: [3, 5, 7].includes(Number(parsed.totalQuestions)) ? Number(parsed.totalQuestions) : 5,
    };
  } catch {
    return { profile: DEFAULT_PROFILE, totalQuestions: 5 };
  }
};

const loadSessionHistory = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_HISTORY_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
};

function ScoreBar({ label, value, hint }) {
  const score = clamp(Number(value) || 0);
  return (
    <div className="score-bar">
      <div><strong>{label}</strong><span>{Math.round(score)}</span></div>
      <div className="score-bar__track"><i style={{ width: `${score}%` }} /></div>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function ScorePill({ label, value }) {
  return <div className="score-pill"><span>{label}</span><strong>{Math.round(Number(value) || 0)}</strong></div>;
}

function LiveSignal({ label, value, goodAt = 70, warningAt = 52, detail }) {
  const numeric = Math.round(Number(value) || 0);
  const state = numeric >= goodAt ? 'good' : numeric >= warningAt ? 'watch' : 'adjust';
  const stateLabel = state === 'good' ? '양호' : state === 'watch' ? '주의' : '조정';
  return (
    <div className={`live-signal is-${state}`}>
      <span className="live-signal__dot" />
      <div><strong>{label}</strong><small>{detail}</small></div>
      <em>{stateLabel} · {numeric}</em>
    </div>
  );
}

function FrameworkCoverage({ frameworkAnalysis }) {
  const coverage = frameworkAnalysis?.coverage;
  if (!Array.isArray(coverage) || !coverage.length) return null;
  return (
    <div className="framework-card">
      <div className="subsection-title">
        <strong>{frameworkAnalysis.framework || '답변 구조'} 점검</strong>
        <span>구조화 답변</span>
      </div>
      <div className="framework-grid">
        {coverage.map((item, index) => (
          <div key={`${item.element}-${index}`} className={`framework-step is-${item.status || 'partial'}`}>
            <strong>{item.element || `STEP ${index + 1}`}</strong>
            <span>{item.status === 'met' ? '충족' : item.status === 'missing' ? '누락' : '부분'}</span>
            {item.evidence && <small>{item.evidence}</small>}
          </div>
        ))}
      </div>
      {frameworkAnalysis.missing?.length > 0 && (
        <p className="framework-missing">보완: {frameworkAnalysis.missing.join(' · ')}</p>
      )}
    </div>
  );
}

function RubricAssessment({ items }) {
  if (!Array.isArray(items) || !items.length) return null;
  return (
    <div className="rubric-results">
      <div className="subsection-title"><strong>평가기준별 근거</strong><span>Structured rubric</span></div>
      {items.slice(0, 4).map((item, index) => (
        <div className="rubric-row" key={`${item.criterion}-${index}`}>
          <div className="rubric-row__head"><strong>{item.criterion}</strong><span>{Math.round(Number(item.score) || 0)}</span></div>
          <p>{item.evidence || '명확한 근거가 부족합니다.'}</p>
          {item.action && <small>다음 답변: {item.action}</small>}
        </div>
      ))}
    </div>
  );
}

function RecentSessions({ sessions }) {
  if (!sessions.length) {
    return <div className="empty-history">첫 면접을 완료하면 같은 직무의 점수 변화와 반복 약점이 여기에 쌓입니다.</div>;
  }
  return (
    <div className="recent-sessions">
      {sessions.slice(0, 4).map((item) => (
        <div key={item.id} className="recent-session">
          <div><strong>{item.targetRole || '면접 연습'}</strong><span>{item.company || item.interviewType || '개인 연습'}</span></div>
          <div><strong>{Math.round(item.overallScore || 0)}</strong><span>{new Date(item.createdAt).toLocaleDateString('ko-KR')}</span></div>
        </div>
      ))}
    </div>
  );
}

function App() {
  const initialSettings = useMemo(loadSettings, []);
  const [phase, setPhase] = useState('setup');
  const [profile, setProfile] = useState(initialSettings.profile);
  const [totalQuestions, setTotalQuestions] = useState(initialSettings.totalQuestions);
  const [settingsSaved, setSettingsSaved] = useState(true);
  const [question, setQuestion] = useState('');
  const [questionIntent, setQuestionIntent] = useState('');
  const [questionMeta, setQuestionMeta] = useState(DEFAULT_QUESTION_META);
  const [questionNumber, setQuestionNumber] = useState(1);
  const [answer, setAnswer] = useState('');
  const [interimAnswer, setInterimAnswer] = useState('');
  const [history, setHistory] = useState([]);
  const [latestFeedback, setLatestFeedback] = useState(null);
  const [pendingNext, setPendingNext] = useState(null);
  const [report, setReport] = useState(null);
  const [modelMeta, setModelMeta] = useState(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [permissionError, setPermissionError] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState(EMPTY_LIVE_METRICS);
  const [showSelfView, setShowSelfView] = useState(true);
  const [sessionHistory, setSessionHistory] = useState(loadSessionHistory);
  const [previousScore, setPreviousScore] = useState(null);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const shouldListenRef = useRef(false);
  const audioContextRef = useRef(null);
  const audioTimerRef = useRef(null);
  const faceLandmarkerRef = useRef(null);
  const visionTimerRef = useRef(null);
  const frameTimerRef = useRef(null);
  const videoRecorderRef = useRef(null);
  const videoTracksRef = useRef([]);
  const videoChunksRef = useRef([]);
  const videoSampleRef = useRef('');
  const videoFinalizePromiseRef = useRef(Promise.resolve(''));
  const visionFramesRef = useRef([]);
  const questionStartedAtRef = useRef(0);
  const answerCaptureStartedRef = useRef(false);
  const metricsRef = useRef(null);
  const previousFaceCenterRef = useRef(null);

  const updateProfile = (patch) => {
    setSettingsSaved(false);
    setProfile((current) => ({ ...current, ...patch }));
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ profile, totalQuestions }));
      setSettingsSaved(true);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [profile, totalQuestions]);

  useEffect(() => {
    const updateViewport = () => {
      const height = window.visualViewport?.height || window.innerHeight;
      document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
    };
    updateViewport();
    window.visualViewport?.addEventListener('resize', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    return () => {
      window.visualViewport?.removeEventListener('resize', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
    };
  }, []);

  const resetMetricAccumulator = useCallback(() => {
    metricsRef.current = {
      audioSamples: 0, voiceSamples: 0, energyValues: [],
      faceSamples: 0, facePresentSamples: 0, framingValues: [], eyeContactValues: [], stabilityValues: [],
    };
    previousFaceCenterRef.current = null;
    setLiveMetrics((current) => ({ ...EMPTY_LIVE_METRICS, visionMode: current.visionMode }));
  }, []);

  useEffect(() => { resetMetricAccumulator(); }, [resetMetricAccumulator]);

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

  const stopVideoSample = useCallback(async () => {
    const recorder = videoRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignored */ }
    }
    try {
      return await videoFinalizePromiseRef.current;
    } catch {
      return videoSampleRef.current;
    }
  }, []);

  const stopMedia = useCallback(() => {
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    recognitionRef.current = null;
    setIsListening(false);
    [audioTimerRef, visionTimerRef, frameTimerRef].forEach((ref) => {
      if (ref.current) window.clearInterval(ref.current);
      ref.current = null;
    });
    const recorder = videoRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch { /* ignored */ }
    }
    videoTracksRef.current.forEach((track) => track.stop());
    videoTracksRef.current = [];
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
      if (!['no-speech', 'aborted'].includes(event.error)) setPermissionError(`음성 인식 오류: ${event.error}`);
    };
    recognition.onend = () => {
      if (shouldListenRef.current) {
        window.setTimeout(() => {
          try { recognition.start(); } catch { /* restart race */ }
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
      });
      setLiveMetrics((current) => ({ ...current, visionMode: '기기 내 실시간 분석 + AI 답변 표본' }));
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
        const framingScore = clamp(100 - Math.abs(width - 0.34) * 260 - Math.abs(height - 0.48) * 180 - centerOffset * 160);
        const nose = landmarks[1] || center;
        const leftEye = landmarks[468] || landmarks[33];
        const rightEye = landmarks[473] || landmarks[263];
        const eyeMid = leftEye && rightEye
          ? { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 }
          : center;
        const gazeOffset = Math.abs(nose.x - eyeMid.x) + Math.abs((nose.y - eyeMid.y) - 0.075) * 0.7;
        const eyeContactScore = clamp(100 - gazeOffset * 520 - centerOffset * 45);
        const previous = previousFaceCenterRef.current;
        const stabilityScore = clamp(100 - (previous ? Math.hypot(center.x - previous.x, center.y - previous.y) : 0) * 1800);
        previousFaceCenterRef.current = center;
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
      setLiveMetrics((current) => ({ ...current, visionMode: '카메라 + AI 답변 표본' }));
    }
  }, []);

  const captureFrame = useCallback(() => {
    if (!profile.aiVisionEnabled || visionFramesRef.current.length >= 4) return;
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = Math.round(480 * (video.videoHeight / video.videoWidth));
    const context = canvas.getContext('2d');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frame = canvas.toDataURL('image/jpeg', 0.5);
    if (frame.length < 450000) visionFramesRef.current.push(frame);
  }, [profile.aiVisionEnabled]);

  const startVideoSample = useCallback(() => {
    videoSampleRef.current = '';
    videoChunksRef.current = [];
    videoFinalizePromiseRef.current = Promise.resolve('');
    if (!profile.aiVisionEnabled || !window.MediaRecorder || !streamRef.current) return;

    const tracks = streamRef.current.getVideoTracks().map((track) => track.clone());
    if (!tracks.length) return;

    videoTracksRef.current = tracks;
    const sampleStream = new MediaStream(tracks);
    const mimeType = ['video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)) || '';

    let finalizeResolve;
    videoFinalizePromiseRef.current = new Promise((resolve) => { finalizeResolve = resolve; });

    try {
      const recorder = new MediaRecorder(sampleStream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 160000,
      });
      videoRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) videoChunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        try {
          const blob = new Blob(videoChunksRef.current, { type: recorder.mimeType || 'video/webm' });
          if (blob.size > 0 && blob.size < 1300000) videoSampleRef.current = await blobToDataUrl(blob);
        } catch {
          videoSampleRef.current = '';
        }
        videoTracksRef.current.forEach((track) => track.stop());
        videoTracksRef.current = [];
        videoRecorderRef.current = null;
        finalizeResolve?.(videoSampleRef.current);
      };
      recorder.start(1000);
      window.setTimeout(() => {
        if (recorder.state !== 'inactive') {
          try { recorder.stop(); } catch { /* ignored */ }
        }
      }, 10000);
    } catch {
      tracks.forEach((track) => track.stop());
      videoTracksRef.current = [];
      finalizeResolve?.('');
    }
  }, [profile.aiVisionEnabled]);

  const enableMedia = useCallback(async () => {
    setPermissionError('');
    try {
      stopMedia();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
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
      setPermissionError('실시간 음성 인식은 Chrome 또는 Edge에서 사용해 주세요. 직접 입력은 가능합니다.');
      return;
    }

    if (!answerCaptureStartedRef.current) {
      answerCaptureStartedRef.current = true;
      questionStartedAtRef.current = Date.now();
      setElapsedSeconds(0);
      resetMetricAccumulator();
      visionFramesRef.current = [];
      captureFrame();
      if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
      frameTimerRef.current = window.setInterval(captureFrame, 3000);
      window.setTimeout(startVideoSample, 350);
    }

    shouldListenRef.current = true;
    setIsListening(true);
    try { recognitionRef.current.start(); } catch { /* already active */ }
  }, [captureFrame, initializeSpeechRecognition, resetMetricAccumulator, startVideoSample]);

  const stopListening = useCallback(() => {
    shouldListenRef.current = false;
    try { recognitionRef.current?.stop(); } catch { /* ignored */ }
    setInterimAnswer('');
    setIsListening(false);
  }, []);

  const beginQuestion = useCallback((nextQuestion, intent = '', meta = {}) => {
    setQuestion(nextQuestion);
    setQuestionIntent(intent);
    setQuestionMeta(normalizeQuestionMeta(meta, intent));
    setAnswer('');
    setInterimAnswer('');
    setLatestFeedback(null);
    setPendingNext(null);
    setElapsedSeconds(0);
    resetMetricAccumulator();
    visionFramesRef.current = [];
    videoSampleRef.current = '';
    videoFinalizePromiseRef.current = Promise.resolve('');
    answerCaptureStartedRef.current = false;
    questionStartedAtRef.current = Date.now();
    if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;
  }, [resetMetricAccumulator]);

  const beginInterview = async (event) => {
    event.preventDefault();
    if (!profile.targetRole.trim()) return;
    setIsBusy(true);
    setPermissionError('');
    try {
      if (!cameraReady) await enableMedia();
      const response = await coach.startSession(profile);
      setModelMeta(response.meta || null);
      setPhase('interview');
      setQuestionNumber(1);
      setHistory([]);
      setPreviousScore(null);
      beginQuestion(
        response.question || FALLBACK_QUESTIONS[0],
        response.intent || '지원 동기와 핵심 경력 확인',
        response.questionMeta || DEFAULT_QUESTION_META,
      );
    } catch (error) {
      setPermissionError(`AI 연결 오류: ${error.message}. 기본 질문으로 진행합니다.`);
      setPhase('interview');
      setQuestionNumber(1);
      setHistory([]);
      beginQuestion(FALLBACK_QUESTIONS[0], '지원 동기와 핵심 경력 확인', DEFAULT_QUESTION_META);
    } finally {
      setIsBusy(false);
    }
  };

  const buildTelemetry = useCallback((answerText = answer) => {
    const metrics = metricsRef.current;
    const durationSeconds = Math.max(1, Math.round((Date.now() - questionStartedAtRef.current) / 1000));
    return {
      durationSeconds,
      wordsPerMinute: Math.round((wordCount(answerText) / durationSeconds) * 60),
      fillerCount: fillerCount(answerText),
      silenceRatio: metrics.audioSamples ? Number((1 - metrics.voiceSamples / metrics.audioSamples).toFixed(3)) : 0,
      voiceEnergy: Math.round(average(metrics.energyValues)),
      facePresence: Math.round(metrics.faceSamples ? (metrics.facePresentSamples / metrics.faceSamples) * 100 : 0),
      framing: Math.round(average(metrics.framingValues)),
      eyeContact: Math.round(average(metrics.eyeContactValues)),
      stability: Math.round(average(metrics.stabilityValues)),
      visionMode: liveMetrics.visionMode,
    };
  }, [answer, liveMetrics.visionMode]);

  const saveSession = useCallback((finalReport, sessionMetrics, completedHistory) => {
    const roleKey = profile.targetRole.trim().toLowerCase();
    const prior = sessionHistory.find((item) => String(item.targetRole || '').trim().toLowerCase() === roleKey);
    setPreviousScore(Number.isFinite(Number(prior?.overallScore)) ? Number(prior.overallScore) : null);

    const record = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      targetRole: profile.targetRole,
      company: profile.company,
      interviewType: profile.interviewType,
      sessionMode: profile.sessionMode,
      overallScore: Number(finalReport?.overallScore) || 0,
      scorecard: finalReport?.scorecard || {},
      sessionMetrics,
      questionCount: completedHistory.length,
      topPriority: finalReport?.priorities?.[0] || '',
    };
    setSessionHistory((current) => {
      const next = [record, ...current].slice(0, 20);
      localStorage.setItem(SESSION_HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, [profile, sessionHistory]);

  const finishInterview = useCallback(async (completedHistory) => {
    if (!completedHistory.length) return;
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
      setModelMeta(finalReport.meta || modelMeta);
      setReport(finalReport);
      saveSession(finalReport, sessionMetrics, completedHistory);
    } catch (error) {
      setReport({
        overallScore: Math.round(average(completedHistory.map((item) => item.feedback?.overallScore || 0))),
        verdict: 'AI 종합 리포트를 불러오지 못해 세션 점수만 표시합니다.',
        readiness: { level: '확인 필요', summary: '최종 분석 응답을 확인해 주세요.' },
        scorecard: {},
        competencyMatrix: [],
        communication: {},
        strengths: ['각 답변별 피드백을 확인해 주세요.'],
        priorities: [error.message],
        practiceQueue: [],
        sevenDayPlan: [],
        sampleClosing: '',
        finalComment: '서버 환경변수와 배포 로그를 확인해 주세요.',
      });
    } finally {
      setPhase('report');
      setIsBusy(false);
      stopMedia();
    }
  }, [liveMetrics.visionMode, modelMeta, profile, saveSession, stopListening, stopMedia]);

  const advanceFromFeedback = useCallback(() => {
    if (!pendingNext || isBusy) return;
    if (pendingNext.finish) {
      finishInterview(pendingNext.completedHistory || history);
      return;
    }
    setQuestionNumber((current) => current + 1);
    beginQuestion(pendingNext.question, pendingNext.intent, pendingNext.meta);
  }, [beginQuestion, finishInterview, history, isBusy, pendingNext]);

  const submitAnswer = async () => {
    const cleanAnswer = `${answer} ${interimAnswer}`.replace(/\s+/g, ' ').trim();
    if (cleanAnswer.length < 2 || isBusy) return;

    stopListening();
    setIsBusy(true);
    captureFrame();
    if (frameTimerRef.current) window.clearInterval(frameTimerRef.current);
    frameTimerRef.current = null;

    const telemetry = buildTelemetry(cleanAnswer);
    const videoSample = await stopVideoSample();

    try {
      const response = await coach.evaluateAnswer({
        profile,
        question,
        questionIntent,
        questionMeta,
        transcript: cleanAnswer,
        history,
        telemetry,
        questionNumber,
        totalQuestions,
        visionFrames: visionFramesRef.current,
        videoSample,
      });
      setModelMeta(response.meta || null);

      const turn = {
        question,
        intent: questionIntent,
        questionMeta,
        answer: cleanAnswer,
        telemetry,
        feedback: response.feedback,
      };
      const completedHistory = [...history, turn];
      setHistory(completedHistory);
      setLatestFeedback(response.feedback);

      const isLast = questionNumber >= totalQuestions || !response.nextQuestion;
      if (isLast) {
        if (profile.sessionMode === 'coach') {
          setPendingNext({ finish: true, completedHistory });
        } else {
          await finishInterview(completedHistory);
        }
      } else {
        const next = {
          question: response.nextQuestion || FALLBACK_QUESTIONS[Math.min(questionNumber, FALLBACK_QUESTIONS.length - 1)],
          intent: response.nextIntent || '후속 역량 검증',
          meta: normalizeQuestionMeta(response.nextQuestionMeta, response.nextIntent),
        };
        if (profile.sessionMode === 'coach') {
          setPendingNext(next);
        } else {
          setQuestionNumber((current) => current + 1);
          window.setTimeout(() => beginQuestion(next.question, next.intent, next.meta), 850);
        }
      }
    } catch (error) {
      setLatestFeedback({
        overallScore: 0,
        summary: `AI 피드백 생성 실패: ${error.message}`,
        strengths: [],
        improvements: ['서버 환경변수와 API 응답을 확인하세요.'],
        scores: {},
        betterAnswer: '',
        deliveryNote: '',
        frameworkAnalysis: null,
        rubricAssessment: [],
        visualAssessment: null,
      });
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
    setQuestionMeta(DEFAULT_QUESTION_META);
    setQuestionNumber(1);
    setAnswer('');
    setInterimAnswer('');
    setHistory([]);
    setLatestFeedback(null);
    setPendingNext(null);
    setReport(null);
    setPermissionError('');
    setElapsedSeconds(0);
    setPreviousScore(null);
    resetMetricAccumulator();
  };

  const resetSettings = () => {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(LEGACY_SETTINGS_KEY);
    setProfile(DEFAULT_PROFILE);
    setTotalQuestions(5);
    setSettingsSaved(true);
  };

  const displayAnswer = `${answer}${interimAnswer ? ` ${interimAnswer}` : ''}`;
  const progress = ((questionNumber - 1) / totalQuestions) * 100;
  const feedbackScores = latestFeedback?.scores || {};
  const reportScorecard = report?.scorecard || {};
  const scoreMap = {
    relevance: reportScorecard.relevance ?? reportScorecard.content,
    structure: reportScorecard.structure,
    evidence: reportScorecard.evidence ?? reportScorecard.specificity,
    delivery: reportScorecard.delivery,
    jobFit: reportScorecard.jobFit ?? reportScorecard.confidence,
  };
  const liveStatus = useMemo(
    () => !cameraReady ? '카메라 대기' : isListening ? '답변 인식 중' : isBusy ? 'AI 분석 중' : pendingNext ? '코칭 확인 중' : '면접 진행',
    [cameraReady, isBusy, isListening, pendingNext],
  );
  const liveNudge = useMemo(() => {
    if (!answerCaptureStartedRef.current) return '질문을 들은 뒤 답변이 시작되면 분석이 시작됩니다.';
    if ((metricsRef.current?.faceSamples || 0) > 8 && liveMetrics.facePresence < 70) return '얼굴이 화면에서 자주 벗어납니다. 카메라 정면으로 돌아오세요.';
    if ((metricsRef.current?.faceSamples || 0) > 8 && liveMetrics.framing < 58) return '얼굴 크기와 화면 중앙 위치를 조금 조정하세요.';
    if ((metricsRef.current?.faceSamples || 0) > 8 && liveMetrics.eyeContact < 55) return '화면보다 카메라 렌즈 방향을 조금 더 자주 보세요.';
    if ((metricsRef.current?.faceSamples || 0) > 8 && liveMetrics.stability < 55) return '상체 움직임을 줄이고 문장 끝에서 잠깐 멈춰보세요.';
    const pace = elapsedSeconds > 8 ? Math.round((wordCount(displayAnswer) / elapsedSeconds) * 60) : 0;
    if (pace > 190) return '말속도가 빠릅니다. 핵심 문장 뒤에 1초 정도 쉬어가세요.';
    if (pace > 0 && pace < 65) return '답변 속도가 다소 느립니다. 결론 문장을 먼저 말해보세요.';
    return '현재 전달 상태가 안정적입니다. 답변의 행동·결과 근거에 집중하세요.';
  }, [displayAnswer, elapsedSeconds, liveMetrics]);

  const communicationMetrics = report?.communication || {};
  const scoreDelta = previousScore == null ? null : Math.round((Number(report?.overallScore) || 0) - previousScore);

  return (
    <div className={`app-shell phase-${phase}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark"><Sparkles size={20} /></span>
          <div><strong>Interview Pilot</strong><small>Structured AI Interview Coach</small></div>
        </div>
        <div className="topbar__meta">
          {sessionHistory.length > 0 && <span><TrendingUp size={14} /> 누적 연습 {sessionHistory.length}회</span>}
          <span className="privacy-note">실시간 지표는 기기에서 처리 · AI 영상은 답변 표본만 전송</span>
        </div>
      </header>

      {phase === 'setup' && (
        <main className="setup-layout">
          <section className="setup-overview">
            <span className="eyebrow">INTERVIEW TRAINING SYSTEM</span>
            <h1>실전처럼 답하고,<br />평가기준으로 고칩니다.</h1>
            <p>뷰인터식 구조화 면접과 Yoodli식 말하기 코칭을 결합해 질문의 의도, STAR/PREP 구조, 직무 근거, 말하기·화상 전달을 한 번에 점검합니다.</p>

            <div className="mode-preview-grid">
              <button
                type="button"
                className={`mode-preview ${profile.sessionMode === 'coach' ? 'is-selected' : ''}`}
                onClick={() => updateProfile({ sessionMode: 'coach' })}
              >
                <Sparkles size={21} />
                <strong>코칭 모드</strong>
                <span>매 답변 뒤 평가근거·구조 누락·개선답변을 확인하고 다음 질문으로 진행</span>
              </button>
              <button
                type="button"
                className={`mode-preview ${profile.sessionMode === 'simulation' ? 'is-selected' : ''}`}
                onClick={() => updateProfile({ sessionMode: 'simulation' })}
              >
                <Video size={21} />
                <strong>실전 모드</strong>
                <span>중간 점수를 숨기고 연속 면접 후 최종 리포트에서 한 번에 복기</span>
              </button>
            </div>

            <div className="research-inspired">
              <div><ListChecks size={18} /><span><strong>구조화 평가</strong> 질문별 역량·평가기준·근거</span></div>
              <div><Target size={18} /><span><strong>BEI/STAR</strong> 상황보다 행동과 결과를 중심으로 분석</span></div>
              <div><Mic size={18} /><span><strong>전달 데이터</strong> 말속도·침묵·군더더기 표현</span></div>
              <div><TrendingUp size={18} /><span><strong>향상 추적</strong> 같은 직무의 이전 점수와 반복 약점 비교</span></div>
            </div>

            <div className="recent-panel">
              <div className="panel-heading"><div><span>최근 연습</span><h2>내 면접 변화</h2></div><TrendingUp size={20} /></div>
              <RecentSessions sessions={sessionHistory} />
            </div>
          </section>

          <section className="setup-card">
            <div className="section-heading">
              <span>01</span>
              <div><h2>면접 시나리오 설정</h2><p>평가기준을 만들 수 있도록 직무·공고·경험을 입력하세요.</p></div>
              <div className={`save-state ${settingsSaved ? 'is-saved' : ''}`}>
                {settingsSaved ? <Check size={14} /> : <Save size={14} />}
                {settingsSaved ? '저장됨' : '저장 중'}
              </div>
            </div>

            <form onSubmit={beginInterview}>
              <label htmlFor="targetRole">목표 직무 *</label>
              <input id="targetRole" value={profile.targetRole} onChange={(event) => updateProfile({ targetRole: event.target.value })} placeholder="예: 공기업 사내변호사, 데이터 분석가" required />

              <div className="two-column">
                <div>
                  <label htmlFor="company">지원 회사</label>
                  <input id="company" value={profile.company} onChange={(event) => updateProfile({ company: event.target.value })} placeholder="회사명 또는 산업군" />
                </div>
                <div>
                  <label htmlFor="interviewType">면접 유형</label>
                  <select id="interviewType" value={profile.interviewType} onChange={(event) => updateProfile({ interviewType: event.target.value })}>
                    <option>직무·인성 혼합</option>
                    <option>BEI 역량면접</option>
                    <option>직무 심층</option>
                    <option>임원·리더십</option>
                    <option>압박 면접</option>
                    <option>영어 면접</option>
                  </select>
                </div>
              </div>

              <div className="two-column">
                <div>
                  <label htmlFor="experience">경력 수준</label>
                  <select id="experience" value={profile.experience} onChange={(event) => updateProfile({ experience: event.target.value })}>
                    <option>신입</option><option>경력 1~3년</option><option>경력 3~7년</option><option>경력 7~12년</option><option>리더·임원</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="totalQuestions">질문 수</label>
                  <select id="totalQuestions" value={totalQuestions} onChange={(event) => { setSettingsSaved(false); setTotalQuestions(Number(event.target.value)); }}>
                    <option value={3}>3문항 · 빠른 점검</option><option value={5}>5문항 · 표준</option><option value={7}>7문항 · 심층</option>
                  </select>
                </div>
              </div>

              <label htmlFor="focusCompetencies">집중 평가 역량</label>
              <input id="focusCompetencies" value={profile.focusCompetencies} onChange={(event) => updateProfile({ focusCompetencies: event.target.value })} placeholder="예: 갈등관리, 문제해결, 리더십, 이해관계자 설득" />

              <label htmlFor="resumeHighlights">핵심 경력·성과</label>
              <textarea id="resumeHighlights" value={profile.resumeHighlights} onChange={(event) => updateProfile({ resumeHighlights: event.target.value })} placeholder="프로젝트, 본인 행동, 성과 수치, 실패/회복 경험 등을 적어 주세요." rows={4} />

              <label htmlFor="jobDescription">채용공고 또는 요구역량</label>
              <textarea id="jobDescription" value={profile.jobDescription} onChange={(event) => updateProfile({ jobDescription: event.target.value })} placeholder="주요 업무·자격요건·우대사항을 붙여 넣으면 질문과 평가기준이 정밀해집니다." rows={4} />

              <label className="toggle-row">
                <input type="checkbox" checked={profile.aiVisionEnabled} onChange={(event) => updateProfile({ aiVisionEnabled: event.target.checked })} />
                <span><strong>AI 화상 전달 코칭</strong><small>답변이 시작된 뒤 최대 10초의 저용량 무음 영상 표본과 프레임만 Gemini에 전송합니다. 전체 영상은 저장하지 않습니다.</small></span>
              </label>

              {permissionError && <div className="alert">{permissionError}</div>}

              <div className="setup-actions">
                <button className="secondary-button" type="button" onClick={resetSettings}><RotateCcw size={17} /> 설정 초기화</button>
                <button className="primary-button" type="submit" disabled={isBusy || !profile.targetRole.trim()}>
                  {isBusy ? <Loader2 className="spin" size={19} /> : <Play size={19} />} 면접 시작
                </button>
              </div>
              <p className="browser-note">Chrome 또는 Edge 권장 · 시작 시 카메라와 마이크 권한을 허용하세요.</p>
            </form>
          </section>
        </main>
      )}

      {phase === 'interview' && (
        <main className="interview-layout">
          <div className="interview-context">
            <div>
              <span className="context-kicker">{profile.sessionMode === 'coach' ? 'COACHING SESSION' : 'REALISTIC SIMULATION'}</span>
              <h1>{profile.targetRole}</h1>
              <p>{profile.company || '회사 미지정'} · {profile.interviewType}</p>
            </div>
            <div className="interview-progress-summary">
              <span>Q{questionNumber} / {totalQuestions}</span>
              <div className="progress-track"><span style={{ width: `${Math.max(progress, 6)}%` }} /></div>
              <strong>{formatTime(elapsedSeconds)}</strong>
            </div>
          </div>

          <section className="stage-panel">
            <div className="stage-toolbar">
              <div className="live-badge"><span /> {liveStatus}</div>
              <button className="self-view-button" type="button" onClick={() => setShowSelfView((value) => !value)}>
                {showSelfView ? <EyeOff size={15} /> : <Eye size={15} />} {showSelfView ? '내 화면 숨기기' : '내 화면 보기'}
              </button>
            </div>

            <div className={`video-frame ${showSelfView ? '' : 'is-self-hidden'}`}>
              <video ref={videoRef} playsInline muted autoPlay />
              {!cameraReady && <div className="video-placeholder"><CameraOff size={40} /><span>카메라 연결 대기</span></div>}
              {!showSelfView && <div className="self-hidden-message"><Camera size={25} /><strong>내 화면 숨김</strong><span>분석은 계속 진행됩니다.</span></div>}
              <div className="framing-guide"><span /></div>
              <div className="video-status"><Camera size={15} /> {liveMetrics.visionMode}</div>
            </div>

            <div className={`live-coach-strip ${profile.sessionMode === 'simulation' ? 'is-minimal' : ''}`}>
              {profile.sessionMode === 'coach' ? (
                <>
                  <div className="live-nudge"><Sparkles size={18} /><span>{liveNudge}</span></div>
                  <div className="live-signals">
                    <LiveSignal label="프레이밍" value={liveMetrics.framing} detail="중앙·거리" />
                    <LiveSignal label="시선" value={liveMetrics.eyeContact} detail="렌즈 방향" />
                    <LiveSignal label="안정성" value={liveMetrics.stability} detail="움직임" />
                    <LiveSignal label="음성" value={liveMetrics.voiceEnergy} goodAt={35} warningAt={18} detail="입력 에너지" />
                  </div>
                </>
              ) : (
                <div className="live-nudge"><Video size={18} /><span>실전 모드에서는 중간 코칭과 점수를 숨깁니다. 면접이 끝난 뒤 한 번에 복기합니다.</span></div>
              )}
            </div>
          </section>

          <section className="coach-panel">
            <div className="question-meta-row">
              <span>{questionMeta.questionType}</span>
              <span><Target size={13} /> {questionMeta.competency}</span>
              <span>{questionMeta.framework}</span>
              <span>권장 {questionMeta.targetSeconds}초</span>
            </div>

            <article className="question-card">
              <div className="ai-avatar"><Sparkles size={21} /></div>
              <div>
                <span className="question-intent">{questionIntent || '면접 질문'}</span>
                <h2>{question}</h2>
              </div>
            </article>

            {profile.sessionMode === 'coach' && questionMeta.rubric?.length > 0 && !latestFeedback && (
              <div className="rubric-preview">
                <div className="subsection-title"><strong>이 질문의 평가 포인트</strong><span>연습 모드에서만 표시</span></div>
                <ul>{questionMeta.rubric.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}

            <div className="answer-box">
              <div className="answer-box__header">
                <span>답변 전사</span>
                <span>{wordCount(displayAnswer)} 어절 · {elapsedSeconds > 8 ? Math.round((wordCount(displayAnswer) / elapsedSeconds) * 60) : 0}/분</span>
              </div>
              <textarea
                value={displayAnswer}
                onChange={(event) => { setAnswer(event.target.value); setInterimAnswer(''); }}
                placeholder="질문 음성이 끝나면 마이크가 자동으로 켜집니다. 직접 입력도 가능합니다."
              />
              <div className="answer-actions">
                <button className={`mic-button ${isListening ? 'is-listening' : ''}`} type="button" onClick={isListening ? stopListening : startListening}>
                  {isListening ? <MicOff size={18} /> : <Mic size={18} />} {isListening ? '인식 중지' : '음성 인식'}
                </button>
                <button className="submit-button" type="button" onClick={submitAnswer} disabled={isBusy || displayAnswer.trim().length < 2 || Boolean(pendingNext)}>
                  {isBusy ? <Loader2 className="spin" size={18} /> : <ChevronRight size={18} />} 답변 제출
                </button>
              </div>
            </div>

            {latestFeedback && profile.sessionMode === 'coach' && (
              <article className="feedback-card">
                <div className="feedback-card__title">
                  <div><CheckCircle2 size={20} /><strong>답변 코칭</strong></div>
                  <span>{Math.round(latestFeedback.overallScore || 0)}<small>/100</small></span>
                </div>
                <p className="feedback-summary">{latestFeedback.summary}</p>

                <div className="score-row">
                  <ScorePill label="관련성" value={feedbackScores.relevance ?? feedbackScores.content} />
                  <ScorePill label="구조" value={feedbackScores.structure} />
                  <ScorePill label="근거" value={feedbackScores.evidence ?? feedbackScores.specificity} />
                  <ScorePill label="전달" value={feedbackScores.delivery} />
                  <ScorePill label="직무연결" value={feedbackScores.jobFit ?? feedbackScores.confidence} />
                </div>

                <FrameworkCoverage frameworkAnalysis={latestFeedback.frameworkAnalysis} />
                <RubricAssessment items={latestFeedback.rubricAssessment} />

                <div className="feedback-columns">
                  <div>
                    <strong>잘된 점</strong>
                    {(latestFeedback.strengths || []).slice(0, 3).map((item) => <p key={item}>+ {item}</p>)}
                  </div>
                  <div>
                    <strong>우선 개선</strong>
                    {(latestFeedback.improvements || []).slice(0, 3).map((item) => <p key={item}>• {item}</p>)}
                  </div>
                </div>

                {latestFeedback.visualAssessment?.summary && (
                  <div className="visual-feedback">
                    <strong>화상 전달</strong>
                    <p>{latestFeedback.visualAssessment.summary}</p>
                    <small>{latestFeedback.visualAssessment.evidenceLimit}</small>
                  </div>
                )}

                {latestFeedback.betterAnswer && (
                  <details className="model-answer">
                    <summary>개선 답변 예시 보기</summary>
                    <p>{latestFeedback.betterAnswer}</p>
                  </details>
                )}

                {pendingNext && (
                  <button className="next-question-button" type="button" onClick={advanceFromFeedback} disabled={isBusy}>
                    {pendingNext.finish ? '최종 리포트 보기' : '피드백 확인 완료 · 다음 질문'} <ChevronRight size={18} />
                  </button>
                )}
              </article>
            )}

            {profile.sessionMode === 'simulation' && isBusy && (
              <div className="simulation-processing"><Loader2 className="spin" size={18} /><span>답변을 기록하고 다음 질문을 준비하고 있습니다.</span></div>
            )}

            {modelMeta && <div className="model-badge">AI: {modelMeta.provider} / {modelMeta.model}{modelMeta.videoUsed ? ' · 영상 표본 사용' : ''}</div>}
            {permissionError && <div className="alert">{permissionError}</div>}

            <button className="ghost-button" type="button" onClick={() => finishInterview(history)} disabled={isBusy || history.length === 0}>
              <CircleStop size={17} /> 현재까지로 종료
            </button>
          </section>
        </main>
      )}

      {phase === 'report' && (
        <main className="report-layout">
          <section className="report-hero">
            <div>
              <span className="eyebrow">INTERVIEW READINESS REPORT</span>
              <h1>{profile.targetRole}</h1>
              <p>{profile.company || profile.interviewType}</p>
            </div>
            <div className="readiness-score">
              <span>{report?.readiness?.level || '준비도'}</span>
              <strong>{Math.round(report?.overallScore || 0)}</strong>
              <small>/100</small>
              {scoreDelta !== null && (
                <em className={scoreDelta >= 0 ? 'is-up' : 'is-down'}>{scoreDelta >= 0 ? '+' : ''}{scoreDelta}점 vs 이전 연습</em>
              )}
            </div>
            <div className="report-verdict">
              <h2>{report?.verdict || '면접 세션이 완료되었습니다.'}</h2>
              <p>{report?.readiness?.summary || report?.finalComment}</p>
              {modelMeta && <div className="model-badge">AI: {modelMeta.provider} / {modelMeta.model}</div>}
            </div>
          </section>

          <section className="report-content">
            <article className="report-card scorecard-panel">
              <div className="panel-heading"><div><span>01 · SCORECARD</span><h2>핵심 평가</h2></div><BarChart3 size={20} /></div>
              <div className="scorecard-grid">
                <ScoreBar label="질문 관련성" value={scoreMap.relevance} hint="질문의 의도에 직접 답했는가" />
                <ScoreBar label="답변 구조" value={scoreMap.structure} hint="STAR·PREP 흐름과 논리" />
                <ScoreBar label="근거 밀도" value={scoreMap.evidence} hint="행동·수치·결과의 구체성" />
                <ScoreBar label="전달력" value={scoreMap.delivery} hint="속도·침묵·명료한 표현" />
                <ScoreBar label="직무 연결" value={scoreMap.jobFit} hint="경험을 역할 요구와 연결" />
              </div>
            </article>

            <article className="report-card">
              <div className="panel-heading"><div><span>02 · COMPETENCIES</span><h2>역량 매트릭스</h2></div><Target size={20} /></div>
              <div className="competency-matrix">
                {(report?.competencyMatrix || []).length ? report.competencyMatrix.map((item, index) => (
                  <div className="competency-row" key={`${item.name}-${index}`}>
                    <div><strong>{item.name}</strong><span>{item.evidence}</span></div>
                    <div className="competency-score"><strong>{Math.round(Number(item.score) || 0)}</strong><div><i style={{ width: `${clamp(Number(item.score) || 0)}%` }} /></div></div>
                    <small>{item.nextDrill}</small>
                  </div>
                )) : <p className="muted">역량별 데이터가 충분하지 않습니다.</p>}
              </div>
            </article>

            <div className="report-columns">
              <article className="report-card">
                <div className="panel-heading"><div><span>03 · DELIVERY</span><h2>말하기·화상 지표</h2></div><Mic size={20} /></div>
                <div className="communication-stats">
                  <div><strong>{Math.round(Number(communicationMetrics.wordsPerMinute ?? report?.sessionMetrics?.wordsPerMinute) || 0)}</strong><span>평균 어절/분</span></div>
                  <div><strong>{Math.round(Number(communicationMetrics.fillerCount ?? 0))}</strong><span>군더더기 표현</span></div>
                  <div><strong>{Math.round((Number(communicationMetrics.silenceRatio ?? 0)) * 100)}%</strong><span>침묵 비율</span></div>
                  <div><strong>{Math.round(Number(communicationMetrics.eyeContact ?? 0))}</strong><span>시선 정렬</span></div>
                </div>
                {communicationMetrics.summary && <p className="communication-summary">{communicationMetrics.summary}</p>}
              </article>

              <article className="report-card priority">
                <div className="panel-heading"><div><span>04 · PRIORITY</span><h2>가장 먼저 고칠 것</h2></div><Gauge size={20} /></div>
                <ol>{report?.priorities?.map((item) => <li key={item}>{item}</li>)}</ol>
              </article>
            </div>

            <article className="report-card">
              <div className="panel-heading"><div><span>05 · PRACTICE QUEUE</span><h2>다음 연습 메뉴</h2></div><ListChecks size={20} /></div>
              <div className="practice-queue">
                {(report?.practiceQueue || []).map((item, index) => (
                  <div key={`${item.drill}-${index}`}>
                    <span>#{index + 1} {item.priority}</span>
                    <strong>{item.drill}</strong>
                    <small>성공 기준: {item.successMetric}</small>
                  </div>
                ))}
              </div>
            </article>

            {report?.sevenDayPlan?.length > 0 && (
              <article className="report-card">
                <div className="panel-heading"><div><span>06 · 7 DAYS</span><h2>7일 훈련 계획</h2></div><TrendingUp size={20} /></div>
                <div className="plan-grid">{report.sevenDayPlan.map((item, index) => <div key={item}><span>DAY {index + 1}</span><p>{item}</p></div>)}</div>
              </article>
            )}

            <article className="report-card">
              <div className="panel-heading"><div><span>07 · REVIEW</span><h2>문항별 복기</h2></div><Briefcase size={20} /></div>
              <div className="history-list">
                {history.map((item, index) => (
                  <details key={`${item.question}-${index}`}>
                    <summary>
                      <span>Q{index + 1}</span>
                      <strong>{item.question}</strong>
                      <em>{item.questionMeta?.competency || item.intent}</em>
                      <b>{item.feedback?.overallScore || 0}점</b>
                    </summary>
                    <div className="history-detail">
                      <section><strong>내 답변</strong><p>{item.answer}</p></section>
                      <section><strong>핵심 피드백</strong><p>{item.feedback?.summary}</p></section>
                      <FrameworkCoverage frameworkAnalysis={item.feedback?.frameworkAnalysis} />
                      <RubricAssessment items={item.feedback?.rubricAssessment} />
                      {item.feedback?.betterAnswer && <section><strong>개선 답변</strong><p>{item.feedback.betterAnswer}</p></section>}
                    </div>
                  </details>
                ))}
              </div>
            </article>

            <div className="report-actions">
              <button className="secondary-button" type="button" onClick={restart}><RefreshCw size={18} /> 조건 다시 설정</button>
              <button className="primary-button compact" type="button" onClick={restart}><Play size={18} /> 같은 설정으로 다시 연습</button>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
