import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Eye, Mic2, ShieldCheck, Sparkles, UserRoundCheck, Volume2 } from 'lucide-react';
import { useInterviewRuntime } from './InterviewRuntimeContext.jsx';
import './HumanInterviewEvaluator.css';

const MAX_FRAMES = 4;
const MAX_AUDIO_SECONDS = 55;
const TARGET_SAMPLE_RATE = 16000;
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
  if (!context) return '';
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.5);
};

const requestJson = async (path, payload) => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `요청 실패 (${response.status})`);
  return data;
};

const requestAssessment = (payload) => requestJson('/api/human-interview', payload);
const requestPronunciation = (payload) => requestJson('/api/pronunciation', payload);

const mergeFloat32 = (chunks, totalSamples) => {
  const merged = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= totalSamples) break;
    const remaining = totalSamples - offset;
    const slice = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
    merged.set(slice, offset);
    offset += slice.length;
  }
  return offset === totalSamples ? merged : merged.subarray(0, offset);
};

const downsample = (input, sourceRate, targetRate = TARGET_SAMPLE_RATE) => {
  if (!input.length || !sourceRate) return new Float32Array();
  if (sourceRate <= targetRate) return input;
  const ratio = sourceRate / targetRate;
  const length = Math.floor(input.length / ratio);
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) sum += input[sourceIndex];
    output[index] = end > start ? sum / (end - start) : input[start] || 0;
  }
  return output;
};

const encodeWavDataUrl = (samples, sampleRate = TARGET_SAMPLE_RATE) => {
  if (!samples?.length) return '';
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeText = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const sample of samples) {
    const normalized = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, normalized < 0 ? normalized * 0x8000 : normalized * 0x7fff, true);
    offset += 2;
  }
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunkSize)));
  }
  return `data:audio/wav;base64,${btoa(binary)}`;
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

const confidenceMeta = (value) => {
  const score = clamp(Number(value) || 0);
  if (score >= 75) return { label: '근거 높음', state: 'high', score };
  if (score >= 55) return { label: '근거 보통', state: 'medium', score };
  return { label: '근거 낮음', state: 'low', score };
};

const scoreGapMessage = (contentScore, presenceScore) => {
  if (!Number.isFinite(contentScore) || !Number.isFinite(presenceScore)) return '';
  const gap = contentScore - presenceScore;
  if (Math.abs(gap) < 30) return '';
  if (gap > 0) {
    return `답변 내용은 ${Math.round(contentScore)}점으로 강하지만 전달·인상은 ${Math.round(presenceScore)}점입니다. 내용 자체보다 시선, 자세, 말의 강약·속도처럼 사람이 받아들이는 전달 방식을 우선 보완하세요.`;
  }
  return `전달·인상은 ${Math.round(presenceScore)}점으로 안정적이지만 답변 내용은 ${Math.round(contentScore)}점입니다. 표정·목소리보다 질문 적합성, 구체적 행동·성과 근거와 답변 구조를 우선 보완하세요.`;
};

function PronunciationPanel({ result }) {
  if (!result) return null;
  if (result.available === false) {
    return (
      <div className="pronunciation-card is-unavailable">
        <div><Volume2 size={15} /><strong>영어 발음·억양 평가</strong></div>
        <p>{result.reason === 'not_configured' ? 'Azure Speech 키가 설정되면 영어 답변의 발음·유창성·완성도·억양을 추가 평가합니다.' : '영어 답변에서만 발음평가를 실행합니다.'}</p>
      </div>
    );
  }
  return (
    <div className="pronunciation-card">
      <div><Volume2 size={15} /><strong>영어 발음·억양 평가</strong></div>
      <div className="pronunciation-scores">
        <span><b>{Math.round(Number(result.pronunciationScore) || 0)}</b>종합</span>
        <span><b>{Math.round(Number(result.accuracyScore) || 0)}</b>발음</span>
        <span><b>{Math.round(Number(result.fluencyScore) || 0)}</b>유창성</span>
        <span><b>{Math.round(Number(result.prosodyScore) || 0)}</b>억양·리듬</span>
      </div>
      {result.weakWords?.length > 0 && <p>우선 교정: {result.weakWords.map((item) => `${item.word} ${Math.round(item.accuracy)}`).join(' · ')}</p>}
    </div>
  );
}

export default function HumanInterviewEvaluator() {
  const { runtime } = useInterviewRuntime();
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState('대기');
  const [latest, setLatest] = useState(null);
  const [sessionResults, setSessionResults] = useState([]);
  const [live, setLive] = useState({ pace: 0, voiceDynamics: 0, eyeContact: null });

  const currentQuestionRef = useRef('');
  const currentAnswerRef = useRef('');
  const lastEvaluatedKeyRef = useRef('');
  const listeningFramesRef = useRef([]);
  const answerFramesRef = useRef([]);
  const answerStartedAtRef = useRef(0);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const audioBufferRef = useRef(null);
  const processorRef = useRef(null);
  const silentGainRef = useRef(null);
  const audioCaptureActiveRef = useRef(false);
  const pcmChunksRef = useRef([]);
  const pcmSampleCountRef = useRef(0);
  const metricsRef = useRef({
    audioSamples: 0,
    voiceSamples: 0,
    energyValues: [],
    eyeContactValues: [],
    framingValues: [],
    stabilityValues: [],
  });
  const evaluatingRef = useRef(new Set());
  const frameTimeoutsRef = useRef([]);

  const resetTurn = useCallback((question = '') => {
    currentQuestionRef.current = question;
    currentAnswerRef.current = '';
    listeningFramesRef.current = [];
    answerFramesRef.current = [];
    answerStartedAtRef.current = 0;
    audioCaptureActiveRef.current = false;
    pcmChunksRef.current = [];
    pcmSampleCountRef.current = 0;
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
    audioCaptureActiveRef.current = false;
    if (processorRef.current) processorRef.current.onaudioprocess = null;
    try { processorRef.current?.disconnect?.(); } catch { /* ignored */ }
    try { silentGainRef.current?.disconnect?.(); } catch { /* ignored */ }
    analyserRef.current = null;
    audioBufferRef.current = null;
    processorRef.current = null;
    silentGainRef.current = null;
    audioContextRef.current?.close?.().catch(() => {});
    audioContextRef.current = null;
  }, []);

  const ensureAudio = useCallback(async (stream) => {
    if (analyserRef.current && audioContextRef.current) return true;
    if (!stream || !stream.getAudioTracks?.().length) return false;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;
    try {
      const context = new AudioContext();
      if (context.state === 'suspended') await context.resume().catch(() => {});
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      processor.onaudioprocess = (event) => {
        if (!audioCaptureActiveRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        const maxSamples = Math.round(context.sampleRate * MAX_AUDIO_SECONDS);
        if (pcmSampleCountRef.current >= maxSamples) return;
        const remaining = maxSamples - pcmSampleCountRef.current;
        const copied = new Float32Array(Math.min(input.length, remaining));
        copied.set(input.subarray(0, copied.length));
        pcmChunksRef.current.push(copied);
        pcmSampleCountRef.current += copied.length;
      };
      audioContextRef.current = context;
      analyserRef.current = analyser;
      audioBufferRef.current = new Uint8Array(analyser.fftSize);
      processorRef.current = processor;
      silentGainRef.current = silentGain;
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

  const buildPronunciationAudio = useCallback(() => {
    const context = audioContextRef.current;
    if (!context || !pcmSampleCountRef.current) return '';
    const merged = mergeFloat32(pcmChunksRef.current, pcmSampleCountRef.current);
    const converted = downsample(merged, context.sampleRate, TARGET_SAMPLE_RATE);
    return encodeWavDataUrl(converted, TARGET_SAMPLE_RATE);
  }, []);

  const snapshotCurrent = useCallback(() => ({
    question: currentQuestionRef.current,
    transcript: currentAnswerRef.current,
    targetRole: runtime.profile?.targetRole || '',
    interviewType: runtime.profile?.interviewType || '',
    language: runtime.profile?.language || (/[가-힣]/.test(currentAnswerRef.current) ? 'ko-KR' : 'en-US'),
    telemetry: buildTelemetry(),
    listeningFrames: [...listeningFramesRef.current],
    answerFrames: [...answerFramesRef.current],
    pronunciationAudio: buildPronunciationAudio(),
    contentScore: Number(runtime.latestFeedback?.overallScore),
  }), [buildPronunciationAudio, buildTelemetry, runtime.latestFeedback?.overallScore, runtime.profile?.interviewType, runtime.profile?.language, runtime.profile?.targetRole]);

  const runEvaluation = useCallback(async (snapshot) => {
    const key = `${snapshot.question}::${snapshot.transcript.slice(0, 80)}`;
    if (!snapshot.question || snapshot.transcript.trim().length < 2 || evaluatingRef.current.has(key)) return;
    if (lastEvaluatedKeyRef.current === key) return;
    evaluatingRef.current.add(key);
    lastEvaluatedKeyRef.current = key;
    setStatus('사람 면접관 관점 분석 중');
    try {
      const pronunciationPromise = snapshot.language.toLowerCase().startsWith('en') && snapshot.pronunciationAudio
        ? requestPronunciation({ audioDataUrl: snapshot.pronunciationAudio, language: snapshot.language, referenceText: snapshot.transcript }).catch((error) => ({ available: false, reason: 'request_failed', error: error.message }))
        : Promise.resolve(null);
      const [result, pronunciation] = await Promise.all([
        requestAssessment({
          question: snapshot.question,
          transcript: snapshot.transcript,
          targetRole: snapshot.targetRole,
          interviewType: snapshot.interviewType,
          language: snapshot.language,
          telemetry: snapshot.telemetry,
          listeningFrames: snapshot.listeningFrames,
          answerFrames: snapshot.answerFrames,
        }),
        pronunciationPromise,
      ]);
      const assessment = {
        ...result.assessment,
        question: snapshot.question,
        createdAt: Date.now(),
        meta: result.meta,
        contentScore: Number.isFinite(snapshot.contentScore) ? snapshot.contentScore : null,
        pronunciation,
      };
      setLatest(assessment);
      setSessionResults((current) => [...current.filter((item) => item.question !== snapshot.question), assessment]);
      setExpanded(true);
      setStatus('사람 면접관 관점 분석 완료');
    } catch (error) {
      lastEvaluatedKeyRef.current = '';
      setStatus(error.message || '사람면접 평가 실패');
    } finally {
      evaluatingRef.current.delete(key);
    }
  }, []);

  useEffect(() => {
    currentAnswerRef.current = runtime.displayAnswer || '';
  }, [runtime.displayAnswer]);

  useEffect(() => {
    frameTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
    frameTimeoutsRef.current = [];
    if (runtime.phase !== 'interview' || !runtime.question) return undefined;
    resetTurn(runtime.question);
    setStatus('질문 경청·첫인상 표본 수집');
    [250, 1750, 3250].forEach((delay) => {
      const timer = window.setTimeout(() => {
        if (audioCaptureActiveRef.current || listeningFramesRef.current.length >= 3) return;
        const frame = captureVideoFrame(runtime.videoElement);
        if (frame) listeningFramesRef.current.push(frame);
      }, delay);
      frameTimeoutsRef.current.push(timer);
    });
    return () => {
      frameTimeoutsRef.current.forEach((timer) => window.clearTimeout(timer));
      frameTimeoutsRef.current = [];
    };
  }, [resetTurn, runtime.phase, runtime.question, runtime.videoElement]);

  useEffect(() => {
    if (runtime.phase !== 'interview' || !runtime.isListening) {
      audioCaptureActiveRef.current = false;
      return undefined;
    }

    let cancelled = false;
    let raf = 0;
    let lastMetricAt = 0;
    let nextFrameAt = 0;
    const start = async () => {
      await ensureAudio(runtime.mediaStream);
      if (cancelled) return;
      audioCaptureActiveRef.current = true;
      if (!answerStartedAtRef.current) answerStartedAtRef.current = performance.now();
      setStatus('답변 전달 행동 측정 중');

      const tick = (now) => {
        if (cancelled) return;
        if (now - lastMetricAt >= 120) {
          sampleAudio();
          const metrics = metricsRef.current;
          const eyeContact = Number(runtime.liveMetrics?.eyeContact);
          const framing = Number(runtime.liveMetrics?.framing);
          const stability = Number(runtime.liveMetrics?.stability);
          if (Number.isFinite(eyeContact)) metrics.eyeContactValues.push(eyeContact);
          if (Number.isFinite(framing)) metrics.framingValues.push(framing);
          if (Number.isFinite(stability)) metrics.stabilityValues.push(stability);
          [metrics.eyeContactValues, metrics.framingValues, metrics.stabilityValues].forEach((values) => {
            if (values.length > 800) values.shift();
          });
          const telemetry = buildTelemetry();
          setLive({
            pace: telemetry.wordsPerMinute,
            voiceDynamics: telemetry.voiceDynamics,
            eyeContact: metrics.eyeContactValues.length ? telemetry.eyeContact : null,
          });
          lastMetricAt = now;
        }
        if (answerFramesRef.current.length < MAX_FRAMES && now >= nextFrameAt) {
          const frame = captureVideoFrame(runtime.videoElement);
          if (frame) answerFramesRef.current.push(frame);
          nextFrameAt = now + 1800;
        }
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    };
    start();
    return () => {
      cancelled = true;
      audioCaptureActiveRef.current = false;
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [buildTelemetry, ensureAudio, runtime.isListening, runtime.liveMetrics, runtime.mediaStream, runtime.phase, runtime.videoElement, sampleAudio]);

  useEffect(() => {
    if (!runtime.latestFeedback || !runtime.question || runtime.displayAnswer.trim().length < 2) return;
    const snapshot = snapshotCurrent();
    runEvaluation(snapshot);
  }, [runEvaluation, runtime.displayAnswer, runtime.latestFeedback, runtime.question, snapshotCurrent]);

  useEffect(() => {
    if (runtime.phase === 'setup') {
      setLatest(null);
      setSessionResults([]);
      lastEvaluatedKeyRef.current = '';
      closeAudio();
    }
  }, [closeAudio, runtime.phase]);

  useEffect(() => () => closeAudio(), [closeAudio]);

  const visible = runtime.phase === 'interview' || runtime.phase === 'report' || sessionResults.length > 0;
  const sessionAverage = useMemo(
    () => sessionResults.length ? Math.round(average(sessionResults.map((item) => Number(item.overallPresenceScore) || 0))) : null,
    [sessionResults],
  );
  const confidence = confidenceMeta(latest?.evidenceConfidence);
  const gapMessage = latest ? scoreGapMessage(Number(latest.contentScore), Number(latest.overallPresenceScore)) : '';

  if (!visible) return null;

  return (
    <aside className={`human-interview-panel ${expanded ? 'is-expanded' : 'is-collapsed'}`} aria-label="실제 사람 면접관 관점 코칭">
      <button className="human-interview-panel__header" type="button" onClick={() => setExpanded((value) => !value)}>
        <span className="human-interview-panel__icon"><UserRoundCheck size={18} /></span>
        <span>
          <strong>사람 면접관 관점</strong>
          <small>{latest ? `${Math.round(latest.overallPresenceScore || 0)}점 · ${status}` : status}</small>
        </span>
        {latest ? <em className={`confidence-badge is-${confidence.state}`}>{confidence.label} {Math.round(confidence.score)}</em> : sessionAverage != null ? <em>세션 {sessionAverage}</em> : null}
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
              <div className={`human-evidence-warning is-${confidence.state}`}>
                <div><ShieldCheck size={16} /><strong>평가 근거 신뢰도 {Math.round(confidence.score)}/100</strong></div>
                <p>경청 {latest.meta?.listeningFrameCount ?? 0}장 + 답변 {latest.meta?.answerFrameCount ?? 0}장의 저해상도 스냅샷과 기기 측정값을 사용합니다. 표본이 짧으면 점수를 확정적 판단으로 해석하지 마세요.</p>
                {(latest.limitations || []).map((item) => <span key={item}>• {item}</span>)}
              </div>

              {gapMessage && (
                <div className="score-gap-card">
                  <div><AlertTriangle size={16} /><strong>내용 점수와 사람 인상 점수가 크게 다릅니다</strong></div>
                  <p>{gapMessage}</p>
                  <small>두 점수는 서로 다른 축이며 하나가 다른 하나를 무효화하지 않습니다.</small>
                </div>
              )}

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

              <PronunciationPanel result={latest.pronunciation} />

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
            </>
          )}
        </div>
      )}
    </aside>
  );
}
