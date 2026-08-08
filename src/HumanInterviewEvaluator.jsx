import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Eye, Mic2, Sparkles, UserRoundCheck } from 'lucide-react';
import './HumanInterviewEvaluator.css';

const MAX_FRAMES = 4;
const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const stddev = (values) => {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)));
};
const wordCount = (text) => String(text || '').trim() ? String(text).trim().split(/\s+/).length : 0;

const captureVideoFrame = (video) => {
  if (!video || video.readyState < 2 || !video.videoWidth) return '';
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = Math.round(480 * (video.videoHeight / video.videoWidth));
  const context = canvas.getContext('2d');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.5);
};

const readSignalValue = (label) => {
  const signals = [...document.querySelectorAll('.live-signal')];
  const found = signals.find((node) => node.querySelector('strong')?.textContent?.trim() === label);
  const text = found?.querySelector('em')?.textContent || '';
  const match = text.match(/(\d+(?:\.\d+)?)\s*$/);
  return match ? Number(match[1]) : null;
};

const currentDom = () => ({
  interview: document.querySelector('.interview-layout'),
  report: document.querySelector('.report-layout'),
  question: document.querySelector('.question-card h2'),
  answer: document.querySelector('.answer-box textarea'),
  mic: document.querySelector('.mic-button'),
  feedback: document.querySelector('.feedback-card'),
  simulationProcessing: document.querySelector('.simulation-processing'),
  video: document.querySelector('.video-frame video'),
  role: document.querySelector('.interview-context h1')?.textContent?.trim() || '',
  type: document.querySelector('.interview-context p')?.textContent?.trim() || '',
});

const requestAssessment = async (payload) => {
  const response = await fetch('/api/human-interview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `사람면접 평가 실패 (${response.status})`);
  return data;
};

function DimensionRow({ item }) {
  const score = clamp(Number(item?.score) || 0);
  return (
    <div className="human-dimension">
      <div className="human-dimension__head">
        <strong>{item?.label || item?.key || '평가 항목'}</strong>
        <span>{Math.round(score)}</span>
      </div>
      <div className="human-dimension__track"><i style={{ width: `${score}%` }} /></div>
      {item?.evidence && <p>{item.evidence}</p>}
      {item?.likelyImpression && <small>면접관에게: {item.likelyImpression}</small>}
      {item?.action && <small className="is-action">다음 연습: {item.action}</small>}
    </div>
  );
}

export default function HumanInterviewEvaluator() {
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState('대기');
  const [latest, setLatest] = useState(null);
  const [sessionResults, setSessionResults] = useState([]);
  const [live, setLive] = useState({ pace: 0, voiceDynamics: 0, eyeContact: null });

  const currentQuestionRef = useRef('');
  const currentAnswerRef = useRef('');
  const lastEvaluatedQuestionRef = useRef('');
  const listeningFramesRef = useRef([]);
  const answerFramesRef = useRef([]);
  const questionStartedAtRef = useRef(0);
  const answerStartedAtRef = useRef(0);
  const nextListeningFrameAtRef = useRef(0);
  const nextAnswerFrameAtRef = useRef(0);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioBufferRef = useRef(null);
  const metricsRef = useRef({
    audioSamples: 0,
    voiceSamples: 0,
    energyValues: [],
    eyeContactValues: [],
    framingValues: [],
    stabilityValues: [],
  });
  const evaluatingRef = useRef(new Set());
  const lastInterviewActiveRef = useRef(false);

  const resetTurn = useCallback((question = '') => {
    currentQuestionRef.current = question;
    currentAnswerRef.current = '';
    lastEvaluatedQuestionRef.current = '';
    listeningFramesRef.current = [];
    answerFramesRef.current = [];
    questionStartedAtRef.current = performance.now();
    answerStartedAtRef.current = 0;
    nextListeningFrameAtRef.current = 0;
    nextAnswerFrameAtRef.current = 0;
    metricsRef.current = {
      audioSamples: 0,
      voiceSamples: 0,
      energyValues: [],
      eyeContactValues: [],
      framingValues: [],
      stabilityValues: [],
    };
    setLive({ pace: 0, voiceDynamics: 0, eyeContact: null });
  }, []);

  const closeAudio = useCallback(() => {
    analyserRef.current = null;
    audioBufferRef.current = null;
    audioContextRef.current?.close?.().catch(() => {});
    audioContextRef.current = null;
  }, []);

  const ensureAudio = useCallback(async (video) => {
    if (analyserRef.current) return true;
    const stream = video?.srcObject;
    if (!stream || !stream.getAudioTracks?.().length) return false;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      const context = new AudioContext();
      if (context.state === 'suspended') await context.resume().catch(() => {});
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      context.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = context;
      analyserRef.current = analyser;
      audioBufferRef.current = new Uint8Array(analyser.fftSize);
      return true;
    } catch {
      closeAudio();
      return false;
    }
  }, [closeAudio]);

  const sampleAudio = useCallback(() => {
    const analyser = analyserRef.current;
    const buffer = audioBufferRef.current;
    if (!analyser || !buffer) return;
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
    if (rms > 0.025) {
      metrics.voiceSamples += 1;
      metrics.energyValues.push(energy);
      if (metrics.energyValues.length > 1200) metrics.energyValues.shift();
    }
  }, []);

  const buildTelemetry = useCallback(() => {
    const metrics = metricsRef.current;
    const now = performance.now();
    const durationSeconds = Math.max(1, Math.round((now - (answerStartedAtRef.current || now)) / 1000));
    const activeEnergy = metrics.energyValues;
    const meanEnergy = average(activeEnergy);
    const dynamics = meanEnergy > 0 ? clamp((stddev(activeEnergy) / meanEnergy) * 100) : 0;
    const speakingRatio = metrics.audioSamples ? metrics.voiceSamples / metrics.audioSamples : 0;
    return {
      durationSeconds,
      wordsPerMinute: Math.round((wordCount(currentAnswerRef.current) / durationSeconds) * 60),
      silenceRatio: Number((1 - speakingRatio).toFixed(3)),
      speakingRatio: Number(speakingRatio.toFixed(3)),
      voiceEnergy: Math.round(meanEnergy),
      voiceDynamics: Math.round(dynamics),
      eyeContact: Math.round(average(metrics.eyeContactValues)),
      framing: Math.round(average(metrics.framingValues)),
      stability: Math.round(average(metrics.stabilityValues)),
    };
  }, []);

  const runEvaluation = useCallback(async (snapshot) => {
    const key = `${snapshot.question}::${snapshot.transcript.slice(0, 80)}`;
    if (!snapshot.question || snapshot.transcript.trim().length < 2 || evaluatingRef.current.has(key)) return;
    evaluatingRef.current.add(key);
    setStatus('사람 면접관 관점 분석 중');
    try {
      const result = await requestAssessment(snapshot);
      const assessment = {
        ...result.assessment,
        question: snapshot.question,
        createdAt: Date.now(),
        meta: result.meta,
      };
      setLatest(assessment);
      setSessionResults((current) => [...current.filter((item) => item.question !== snapshot.question), assessment]);
      setExpanded(true);
      setStatus('사람 면접관 관점 분석 완료');
    } catch (error) {
      setStatus(error.message || '사람면접 평가 실패');
    } finally {
      evaluatingRef.current.delete(key);
    }
  }, []);

  const snapshotCurrent = useCallback((dom) => ({
    question: currentQuestionRef.current,
    transcript: currentAnswerRef.current,
    targetRole: dom?.role || '',
    interviewType: dom?.type || '',
    language: /[가-힣]/.test(currentAnswerRef.current) ? 'ko-KR' : 'en-US',
    telemetry: buildTelemetry(),
    listeningFrames: [...listeningFramesRef.current],
    answerFrames: [...answerFramesRef.current],
  }), [buildTelemetry]);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const dom = currentDom();
      const interviewActive = Boolean(dom.interview);
      const reportActive = Boolean(dom.report);
      setVisible(interviewActive || reportActive || sessionResults.length > 0);

      if (!interviewActive) {
        if (lastInterviewActiveRef.current && currentQuestionRef.current && currentAnswerRef.current.trim().length >= 2 && lastEvaluatedQuestionRef.current !== currentQuestionRef.current) {
          const snapshot = snapshotCurrent(dom);
          lastEvaluatedQuestionRef.current = currentQuestionRef.current;
          runEvaluation(snapshot);
        }
        lastInterviewActiveRef.current = false;
        if (!reportActive) closeAudio();
        return;
      }

      lastInterviewActiveRef.current = true;
      const now = performance.now();
      const question = dom.question?.textContent?.trim() || '';
      const answer = dom.answer?.value?.trim() || '';
      const isListening = Boolean(dom.mic?.classList.contains('is-listening'));

      if (question && question !== currentQuestionRef.current) {
        if (currentQuestionRef.current && currentAnswerRef.current.trim().length >= 2 && lastEvaluatedQuestionRef.current !== currentQuestionRef.current) {
          const snapshot = snapshotCurrent(dom);
          lastEvaluatedQuestionRef.current = currentQuestionRef.current;
          runEvaluation(snapshot);
        }
        resetTurn(question);
        setStatus('질문 경청·첫인상 표본 수집');
      }

      currentAnswerRef.current = answer;

      if (!isListening && !answerStartedAtRef.current && question && listeningFramesRef.current.length < 3 && now >= nextListeningFrameAtRef.current) {
        const frame = captureVideoFrame(dom.video);
        if (frame) listeningFramesRef.current.push(frame);
        nextListeningFrameAtRef.current = now + 1500;
      }

      if (isListening) {
        if (!answerStartedAtRef.current) {
          answerStartedAtRef.current = now;
          setStatus('답변 전달 행동 측정 중');
          await ensureAudio(dom.video);
        }
        sampleAudio();

        if (answerFramesRef.current.length < MAX_FRAMES && now >= nextAnswerFrameAtRef.current) {
          const frame = captureVideoFrame(dom.video);
          if (frame) answerFramesRef.current.push(frame);
          nextAnswerFrameAtRef.current = now + 1800;
        }

        const eyeContact = readSignalValue('시선');
        const framing = readSignalValue('프레이밍');
        const stability = readSignalValue('안정성');
        const metrics = metricsRef.current;
        if (eyeContact != null) metrics.eyeContactValues.push(eyeContact);
        if (framing != null) metrics.framingValues.push(framing);
        if (stability != null) metrics.stabilityValues.push(stability);
        [metrics.eyeContactValues, metrics.framingValues, metrics.stabilityValues].forEach((values) => {
          if (values.length > 800) values.shift();
        });

        const telemetry = buildTelemetry();
        setLive({
          pace: telemetry.wordsPerMinute,
          voiceDynamics: telemetry.voiceDynamics,
          eyeContact: metrics.eyeContactValues.length ? telemetry.eyeContact : null,
        });
      }

      const submitted = Boolean(dom.feedback || dom.simulationProcessing);
      if (submitted && answer.trim().length >= 2 && lastEvaluatedQuestionRef.current !== question) {
        const snapshot = snapshotCurrent(dom);
        lastEvaluatedQuestionRef.current = question;
        runEvaluation(snapshot);
      }
    }, 250);

    return () => window.clearInterval(timer);
  }, [buildTelemetry, closeAudio, ensureAudio, resetTurn, runEvaluation, sampleAudio, sessionResults.length, snapshotCurrent]);

  useEffect(() => () => closeAudio(), [closeAudio]);

  const sessionAverage = useMemo(
    () => sessionResults.length ? Math.round(average(sessionResults.map((item) => Number(item.overallPresenceScore) || 0))) : null,
    [sessionResults],
  );

  if (!visible) return null;

  return (
    <aside className={`human-interview-panel ${expanded ? 'is-expanded' : 'is-collapsed'}`} aria-label="실제 사람 면접관 관점 코칭">
      <button className="human-interview-panel__header" type="button" onClick={() => setExpanded((value) => !value)}>
        <span className="human-interview-panel__icon"><UserRoundCheck size={18} /></span>
        <span>
          <strong>사람 면접관 관점</strong>
          <small>{latest ? `${Math.round(latest.overallPresenceScore || 0)}점 · ${status}` : status}</small>
        </span>
        {sessionAverage != null && <em>세션 {sessionAverage}</em>}
        {expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
      </button>

      {!expanded && (
        <div className="human-live-mini">
          <span><Mic2 size={13} /> {live.pace || 0}/분</span>
          <span><Sparkles size={13} /> 강약 {live.voiceDynamics || 0}</span>
          <span><Eye size={13} /> 시선 {live.eyeContact == null ? '측정중' : live.eyeContact}</span>
        </div>
      )}

      {expanded && (
        <div className="human-interview-panel__body">
          <p className="human-panel-note">
            직무역량 점수와 별도입니다. 보이는 행동이 실제 면접관에게 어떻게 비칠 수 있는지를 연습용으로 평가하며, 외모·성격·감정은 판단하지 않습니다.
          </p>

          {!latest && (
            <div className="human-empty">
              답변을 제출하면 시선·태도·표정·자세·제스처·목소리 강약·말속도·경청 인상을 분석합니다.
            </div>
          )}

          {latest && (
            <>
              <div className="human-impression">
                <span>면접관이 받을 수 있는 인상</span>
                <p>{latest.interviewerImpression}</p>
              </div>

              <div className="human-good-risk">
                <section>
                  <strong>좋은 점</strong>
                  {(latest.goodPoints || []).slice(0, 3).map((item, index) => (
                    <div key={`${item.point}-${index}`}>
                      <b>+ {item.point}</b>
                      <p>{item.evidence}</p>
                      {item.likelyImpression && <small>{item.likelyImpression}</small>}
                    </div>
                  ))}
                </section>
                <section className="is-risk">
                  <strong>감점 위험</strong>
                  {(latest.riskPoints || []).slice(0, 3).map((item, index) => (
                    <div key={`${item.point}-${index}`}>
                      <b>• {item.point}</b>
                      <p>{item.evidence}</p>
                      {item.likelyImpression && <small>{item.likelyImpression}</small>}
                      {item.fix && <small className="is-action">수정: {item.fix}</small>}
                    </div>
                  ))}
                </section>
              </div>

              <div className="human-dimensions">
                {(latest.dimensions || []).slice(0, 9).map((item, index) => (
                  <DimensionRow item={item} key={`${item.key || item.label}-${index}`} />
                ))}
              </div>

              {latest.nextPractice?.length > 0 && (
                <div className="human-next-practice">
                  <strong>다음 연습 3가지</strong>
                  {latest.nextPractice.slice(0, 3).map((item) => <span key={item}>• {item}</span>)}
                </div>
              )}

              {latest.limitations?.length > 0 && (
                <details className="human-limitations">
                  <summary>평가 한계</summary>
                  {latest.limitations.map((item) => <p key={item}>{item}</p>)}
                </details>
              )}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
