const MAX_WAV_CHARS = 3_500_000;

export class PronunciationError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'PronunciationError';
    this.status = status;
  }
}

const clampText = (value, max = 4000) => String(value || '').trim().slice(0, max);
const bytesToBase64 = (bytes) => {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(bytes.length, index + chunkSize)));
  }
  return btoa(binary);
};
const utf8ToBase64 = (value) => bytesToBase64(new TextEncoder().encode(value));
const decodeBase64 = (value) => {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'));
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};
const parseWav = (value) => {
  const text = String(value || '');
  if (!text || text.length > MAX_WAV_CHARS) return null;
  const match = text.match(/^data:audio\/(?:wav|x-wav);base64,([A-Za-z0-9+/=]+)$/i);
  return match ? decodeBase64(match[1]) : null;
};

const numberOrNull = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export async function assessEnglishPronunciation(body = {}, options = {}) {
  const key = String(options.azureSpeechKey || '').trim();
  const region = String(options.azureSpeechRegion || '').trim().toLowerCase();
  if (!key || !region) return { available: false, reason: 'not_configured' };
  if (!/^[a-z0-9-]{2,40}$/.test(region)) throw new PronunciationError('Azure Speech region 형식이 올바르지 않습니다.', 500);

  const language = clampText(body.language, 20) || 'en-US';
  if (!language.toLowerCase().startsWith('en')) return { available: false, reason: 'english_only' };

  const audio = parseWav(body.audioDataUrl);
  if (!audio) throw new PronunciationError('발음평가용 WAV 오디오가 없거나 허용 크기를 초과했습니다.', 400);
  const referenceText = clampText(body.referenceText, 3000);
  if (!referenceText) throw new PronunciationError('발음평가 기준이 될 영어 전사문이 없습니다.', 400);

  const assessmentConfig = utf8ToBase64(JSON.stringify({
    ReferenceText: referenceText,
    GradingSystem: 'HundredMark',
    Granularity: 'Word',
    Dimension: 'Comprehensive',
    EnableMiscue: true,
    EnableProsodyAssessment: 'True',
  }));

  const endpoint = `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': key,
        'Pronunciation-Assessment': assessmentConfig,
        'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
        Accept: 'application/json',
      },
      body: audio,
    });
  } catch {
    throw new PronunciationError('Azure Speech 발음평가 서버에 연결하지 못했습니다.', 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new PronunciationError(`Azure Speech 발음평가 실패 (${response.status})`, response.status || 502);

  const best = data?.NBest?.[0] || {};
  const score = best?.PronunciationAssessment || {};
  const weakWords = (Array.isArray(best?.Words) ? best.Words : [])
    .map((word) => ({
      word: clampText(word?.Word, 80),
      accuracy: numberOrNull(word?.PronunciationAssessment?.AccuracyScore),
      errorType: clampText(word?.PronunciationAssessment?.ErrorType, 80),
    }))
    .filter((word) => word.word && word.accuracy !== null)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 6);

  return {
    available: true,
    pronunciationScore: numberOrNull(score?.PronScore),
    accuracyScore: numberOrNull(score?.AccuracyScore),
    fluencyScore: numberOrNull(score?.FluencyScore),
    completenessScore: numberOrNull(score?.CompletenessScore),
    prosodyScore: numberOrNull(score?.ProsodyScore),
    recognizedText: clampText(best?.Display || data?.DisplayText, 4000),
    weakWords,
    meta: { provider: 'azure-speech', region, locale: 'en-US' },
  };
}
