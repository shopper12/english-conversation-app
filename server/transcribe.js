const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const LEGACY_MODELS = new Set([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-09-2025',
  'gemini-3.1-flash-lite-preview',
]);
const MAX_AUDIO_CHARS = 3_500_000;

export class TranscriptionError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'TranscriptionError';
    this.status = status;
  }
}

const clampText = (value, max = 100) => String(value || '').trim().slice(0, max);
const resolveModel = (value) => {
  const requested = String(value || '').trim();
  return !requested || LEGACY_MODELS.has(requested) ? DEFAULT_GEMINI_MODEL : requested;
};

const parseAudio = (value) => {
  const text = String(value || '');
  if (!text || text.length > MAX_AUDIO_CHARS) return null;
  const match = text.match(/^data:(audio\/(?:webm|ogg|wav|x-wav|mpeg|mp4|m4a|aac));(?:codecs=[^;]+;)?base64,([A-Za-z0-9+/=]+)$/i)
    || text.match(/^data:(audio\/(?:webm|ogg|wav|x-wav|mpeg|mp4|m4a|aac));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  return { mimeType: match[1].toLowerCase(), data: match[2] };
};

const safeError = (status, raw = '') => {
  if (status === 401 || status === 403) return 'Gemini STT 인증 실패: 배포 환경의 API 키를 확인해 주세요.';
  if (status === 429) return 'Gemini STT 사용량 한도 또는 요청 제한에 도달했습니다.';
  const text = String(raw || '').replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/https?:\/\/\S+/g, '').trim();
  return text ? `Gemini STT 실패: ${text.slice(0, 220)}` : 'Gemini STT 처리에 실패했습니다.';
};

const parseJson = (raw) => {
  const text = String(raw || '').trim();
  try { return JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new TranscriptionError('STT 응답에서 JSON을 찾지 못했습니다.', 502);
    try { return JSON.parse(match[0]); } catch {
      throw new TranscriptionError('STT 응답 형식이 올바르지 않습니다.', 502);
    }
  }
};

export async function transcribeInterviewAudio(body = {}, options = {}) {
  const apiKey = options.geminiApiKey;
  if (!apiKey) throw new TranscriptionError('GEMINI_API_KEY가 설정되지 않았습니다.', 503);

  const audio = parseAudio(body.audioDataUrl);
  if (!audio) throw new TranscriptionError('전사할 오디오가 없거나 허용 크기/형식이 아닙니다.', 400);
  const language = clampText(body.language, 20) || 'ko-KR';
  const model = resolveModel(options.geminiModel);

  const prompt = {
    task: '면접 답변 음성을 정확히 전사',
    languageHint: language,
    rules: [
      '실제로 들리는 발화만 전사한다.',
      '말하지 않은 문장을 보완하거나 요약하지 않는다.',
      '군더더기 표현도 들리면 가능한 한 보존한다.',
      '불명확한 부분을 추측해 사실을 만들지 않는다.',
      '반드시 JSON 객체 하나만 반환한다.',
    ],
    schema: { transcript: 'string', detectedLanguage: 'string', confidenceNote: 'string - 불명확 구간이 있을 때만 짧게' },
  };

  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'You are a precise speech-to-text transcription service. Return only valid JSON.' }] },
        contents: [{
          role: 'user',
          parts: [
            { inline_data: { mime_type: audio.mimeType, data: audio.data } },
            { text: JSON.stringify(prompt) },
          ],
        }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 1800 },
      }),
    });
  } catch {
    throw new TranscriptionError('Gemini STT 서버에 연결하지 못했습니다.', 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new TranscriptionError(safeError(response.status, data?.error?.message), response.status || 502);
  const raw = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n');
  const parsed = parseJson(raw);
  const transcript = String(parsed?.transcript || '').trim().slice(0, 12_000);
  if (!transcript) throw new TranscriptionError('음성에서 전사할 발화를 찾지 못했습니다.', 422);

  return {
    transcript,
    detectedLanguage: clampText(parsed?.detectedLanguage, 40),
    confidenceNote: String(parsed?.confidenceNote || '').trim().slice(0, 400),
    meta: { provider: 'gemini', model },
  };
}
