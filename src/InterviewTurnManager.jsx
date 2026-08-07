import React, { useCallback, useEffect, useRef, useState } from 'react';
import './InterviewTurnManager.css';

const SETTINGS_KEY = 'interview-pilot-turn-taking-v1';
const DEFAULT_SETTINGS = {
  voiceEnabled: true,
  autoSubmitEnabled: true,
  silenceMs: 4500,
  minAnswerChars: 20,
  minAnswerAgeMs: 7000,
  speechRate: 0.98,
};

const readSettings = () => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return DEFAULT_SETTINGS;
  }
};

const getInterviewDom = () => ({
  interview: document.querySelector('.interview-layout'),
  question: document.querySelector('.question-card h2'),
  mic: document.querySelector('.mic-button'),
  submit: document.querySelector('.submit-button'),
  answer: document.querySelector('.answer-box textarea'),
});

const clickMicTo = (shouldListen) => {
  const { mic } = getInterviewDom();
  if (!mic || mic.disabled) return false;
  const isListening = mic.classList.contains('is-listening');
  if (isListening !== shouldListen) mic.click();
  return true;
};

const chooseVoice = (text) => {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  const isKorean = /[가-힣]/.test(text);
  const languagePrefix = isKorean ? 'ko' : 'en';
  return voices.find((voice) => voice.lang?.toLowerCase().startsWith(languagePrefix)) || null;
};

export default function InterviewTurnManager() {
  const [settings, setSettings] = useState(readSettings);
  const [isInterview, setIsInterview] = useState(false);
  const [status, setStatus] = useState('대기');

  const settingsRef = useRef(settings);
  const currentQuestionRef = useRef('');
  const firstAnswerAtRef = useRef(0);
  const lastAnswerValueRef = useRef('');
  const lastAnswerChangedAtRef = useRef(0);
  const autoSubmittedQuestionRef = useRef('');
  const speakingRef = useRef(false);
  const micGuardRef = useRef(null);
  const utteranceRef = useRef(null);

  useEffect(() => {
    settingsRef.current = settings;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  const clearMicGuard = useCallback(() => {
    if (micGuardRef.current) window.clearInterval(micGuardRef.current);
    micGuardRef.current = null;
  }, []);

  const finishSpeaking = useCallback(() => {
    clearMicGuard();
    speakingRef.current = false;
    utteranceRef.current = null;
    setStatus('답변 대기');
    window.setTimeout(() => clickMicTo(true), 250);
  }, [clearMicGuard]);

  const speakQuestion = useCallback((text) => {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;

    if (!settingsRef.current.voiceEnabled || !window.speechSynthesis || !window.SpeechSynthesisUtterance) {
      setStatus(settingsRef.current.voiceEnabled ? '음성 미지원 · 답변 대기' : '답변 대기');
      window.setTimeout(() => clickMicTo(true), 250);
      return;
    }

    window.speechSynthesis.cancel();
    clearMicGuard();
    speakingRef.current = true;
    setStatus('면접관 질문 중');

    const keepMicOff = () => clickMicTo(false);
    keepMicOff();
    micGuardRef.current = window.setInterval(keepMicOff, 100);

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = /[가-힣]/.test(cleanText) ? 'ko-KR' : 'en-US';
    utterance.rate = settingsRef.current.speechRate;
    utterance.pitch = 1;
    utterance.volume = 1;
    const voice = chooseVoice(cleanText);
    if (voice) utterance.voice = voice;
    utterance.onend = finishSpeaking;
    utterance.onerror = finishSpeaking;
    utteranceRef.current = utterance;

    try {
      window.speechSynthesis.resume();
      window.speechSynthesis.speak(utterance);
    } catch {
      finishSpeaking();
    }
  }, [clearMicGuard, finishSpeaking]);

  const cancelSpeaking = useCallback(({ startMic = true } = {}) => {
    clearMicGuard();
    speakingRef.current = false;
    utteranceRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* ignored */ }
    if (startMic) window.setTimeout(() => clickMicTo(true), 200);
  }, [clearMicGuard]);

  const resetTurnState = useCallback(() => {
    currentQuestionRef.current = '';
    firstAnswerAtRef.current = 0;
    lastAnswerValueRef.current = '';
    lastAnswerChangedAtRef.current = 0;
    autoSubmittedQuestionRef.current = '';
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const dom = getInterviewDom();
      const interviewActive = Boolean(dom.interview);
      setIsInterview((current) => current === interviewActive ? current : interviewActive);

      if (!interviewActive) {
        if (currentQuestionRef.current) {
          cancelSpeaking({ startMic: false });
          resetTurnState();
          setStatus('대기');
        }
        return;
      }

      const questionText = dom.question?.textContent?.trim() || '';
      const now = performance.now();

      if (questionText && questionText !== currentQuestionRef.current) {
        currentQuestionRef.current = questionText;
        firstAnswerAtRef.current = 0;
        lastAnswerValueRef.current = '';
        lastAnswerChangedAtRef.current = now;
        autoSubmittedQuestionRef.current = '';
        window.setTimeout(() => speakQuestion(questionText), 40);
        return;
      }

      const answerValue = dom.answer?.value?.trim() || '';
      if (answerValue !== lastAnswerValueRef.current) {
        lastAnswerValueRef.current = answerValue;
        lastAnswerChangedAtRef.current = now;
        if (answerValue && !firstAnswerAtRef.current) firstAnswerAtRef.current = now;
        if (!speakingRef.current && answerValue) setStatus('답변 인식 중');
      }

      const config = settingsRef.current;
      const isListening = Boolean(dom.mic?.classList.contains('is-listening'));
      const answerOldEnough = firstAnswerAtRef.current && now - firstAnswerAtRef.current >= config.minAnswerAgeMs;
      const silenceLongEnough = now - lastAnswerChangedAtRef.current >= config.silenceMs;
      const enoughText = answerValue.length >= config.minAnswerChars;
      const sameQuestionAlreadySubmitted = autoSubmittedQuestionRef.current === currentQuestionRef.current;
      const submitAvailable = dom.submit && !dom.submit.disabled;

      if (
        config.autoSubmitEnabled &&
        !speakingRef.current &&
        isListening &&
        answerOldEnough &&
        silenceLongEnough &&
        enoughText &&
        submitAvailable &&
        !sameQuestionAlreadySubmitted
      ) {
        autoSubmittedQuestionRef.current = currentQuestionRef.current;
        setStatus('답변 종료 감지 · AI 분석 중');
        dom.submit.click();
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [cancelSpeaking, resetTurnState, speakQuestion]);

  useEffect(() => () => cancelSpeaking({ startMic: false }), [cancelSpeaking]);

  const toggleVoice = () => {
    const nextEnabled = !settingsRef.current.voiceEnabled;
    if (!nextEnabled) cancelSpeaking();
    setSettings((current) => ({ ...current, voiceEnabled: nextEnabled }));
  };

  if (!isInterview) return null;

  return (
    <aside className="turn-manager" aria-label="AI 면접관 자동 진행 설정">
      <div className="turn-manager__status">
        <span className={speakingRef.current ? 'is-speaking' : ''} />
        <strong>AI 면접관</strong>
        <em>{status}</em>
      </div>
      <div className="turn-manager__actions">
        <button type="button" className={settings.voiceEnabled ? 'is-on' : ''} onClick={toggleVoice}>
          {settings.voiceEnabled ? '🔊 질문 음성 ON' : '🔇 질문 음성 OFF'}
        </button>
        <button
          type="button"
          className={settings.autoSubmitEnabled ? 'is-on' : ''}
          onClick={() => setSettings((current) => ({ ...current, autoSubmitEnabled: !current.autoSubmitEnabled }))}
        >
          {settings.autoSubmitEnabled ? '⏱ 자동 턴 ON' : '⏱ 자동 턴 OFF'}
        </button>
        <button type="button" onClick={() => speakQuestion(currentQuestionRef.current)}>
          ↻ 질문 다시 듣기
        </button>
      </div>
      <small>
        자동 턴: 답변 20자 이상 · 답변 시작 7초 이후 · 약 4.5초 동안 전사 변화가 없으면 자동 제출
      </small>
    </aside>
  );
}
