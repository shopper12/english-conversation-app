const MAX_TRANSCRIPT = 8000;
const MAX_HISTORY = 12;
const MAX_FRAMES = 4;
const MAX_FRAME_CHARS = 450000;
const MAX_VIDEO_CHARS = 1800000;

export class CoachError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'CoachError';
    this.status = status;
  }
}

const clampText = (value, max = 2000) => String(value || '').trim().slice(0, max);
const clampNumber = (value, min = 0, max = 100) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : 0;
};

const cleanProfile = (profile = {}) => ({
  targetRole: clampText(profile.targetRole, 120),
  company: clampText(profile.company, 120),
  experience: clampText(profile.experience, 80),
  interviewType: clampText(profile.interviewType, 80),
  language: clampText(profile.language, 20) || 'ko-KR',
  resumeHighlights: clampText(profile.resumeHighlights, 2400),
  jobDescription: clampText(profile.jobDescription, 2400),
  aiVisionEnabled: profile.aiVisionEnabled !== false,
});

const cleanTelemetry = (telemetry = {}) => ({
  durationSeconds: clampNumber(telemetry.durationSeconds, 0, 3600),
  wordsPerMinute: clampNumber(telemetry.wordsPerMinute, 0, 400),
  fillerCount: clampNumber(telemetry.fillerCount, 0, 500),
  silenceRatio: clampNumber(telemetry.silenceRatio, 0, 1),
  voiceEnergy: clampNumber(telemetry.voiceEnergy, 0, 100),
  facePresence: clampNumber(telemetry.facePresence, 0, 100),
  framing: clampNumber(telemetry.framing, 0, 100),
  eyeContact: clampNumber(telemetry.eyeContact, 0, 100),
  stability: clampNumber(telemetry.stability, 0, 100),
  visionMode: clampText(telemetry.visionMode, 80),
});

const cleanHistory = (history = []) => (Array.isArray(history) ? history : [])
  .slice(-MAX_HISTORY)
  .map((item) => ({
    question: clampText(item?.question, 800),
    answer: clampText(item?.answer, 2500),
    score: clampNumber(item?.feedback?.overallScore ?? item?.feedback?.scores?.overall, 0, 100),
    visualSummary: clampText(item?.feedback?.visualAssessment?.summary, 500),
  }));

const parseDataUrl = (value, allowedMime, maxChars) => {
  const text = String(value || '');
  if (!text || text.length > maxChars) return null;
  const match = text.match(/^data:([^;]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || !allowedMime.includes(match[1])) return null;
  return { mimeType: match[1], data: match[2], dataUrl: text };
};

const cleanVisionFrames = (frames) => (Array.isArray(frames) ? frames : [])
  .slice(0, MAX_FRAMES)
  .map((frame) => parseDataUrl(frame, ['image/jpeg', 'image/png', 'image/webp'], MAX_FRAME_CHARS))
  .filter(Boolean);

const cleanVideoSample = (sample) => parseDataUrl(sample, ['video/webm', 'video/mp4'], MAX_VIDEO_CHARS);

const parseJson = (raw) => {
  const text = String(raw || '').trim();
  try { return JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new CoachError('AI 응답에서 JSON을 찾지 못했습니다.', 502);
    try { return JSON.parse(match[0]); } catch { throw new CoachError('AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.', 502); }
  }
};

const instructions = `너는 한국어로 진행하는 시니어 면접관 겸 면접 코치다.
지원 직무와 경력에 맞춰 실제 면접처럼 질문하고, 답변 뒤에는 구체적이고 행동 가능한 피드백을 제공한다.
STAR 또는 PREP 구조, 직무 전문성, 사례의 구체성, 논리, 전달력, 자신감을 평가한다.
화상 자료는 프레이밍, 카메라 방향 시선, 자세 변화, 과도한 움직임처럼 직접 관찰 가능한 전달 행동만 평가한다.
외모, 매력, 나이, 성별, 인종, 장애, 건강상태, 성격 또는 감정을 추론하거나 평가하지 않는다.
화상 표본이 짧거나 불명확하면 단정하지 말고 관찰 한계를 명시한다.
답변에 없는 경력이나 수치를 지어내지 않는다.
반드시 유효한 JSON 객체 하나만 출력하고 마크다운 코드펜스는 쓰지 않는다.`;

const buildPrompt = ({ action, profile, transcript, history, telemetry, questionNumber, totalQuestions, sessionMetrics, media }) => {
  if (action === 'start') {
    return {
      task: '첫 면접 질문 생성', profile,
      requiredSchema: { question: 'string', intent: 'string', preparationTip: 'string' },
      rules: ['첫 질문은 자기소개 또는 지원동기 중 프로필에 더 적합한 것으로 시작한다.', '질문은 한 번에 하나만 하고 2문장 이내로 작성한다.'],
    };
  }
  if (action === 'answer') {
    return {
      task: '답변 및 전달 행동 평가와 다음 질문 생성',
      profile,
      current: { transcript, telemetry, questionNumber, totalQuestions, media },
      previousTurns: history,
      requiredSchema: {
        feedback: {
          overallScore: 'number 0-100', summary: 'string', strengths: ['string'], improvements: ['string'],
          scores: { content: 'number 0-100', structure: 'number 0-100', specificity: 'number 0-100', delivery: 'number 0-100', confidence: 'number 0-100' },
          betterAnswer: 'string', deliveryNote: 'string',
          visualAssessment: { summary: 'string', strengths: ['string'], improvements: ['string'], confidence: 'number 0-100', evidenceLimit: 'string' },
        },
        nextQuestion: 'string; 마지막 질문이면 빈 문자열',
        nextIntent: 'string; 마지막 질문이면 빈 문자열',
      },
      rules: [
        '칭찬만 하지 말고 가장 큰 결함을 우선순위로 지적한다.',
        'betterAnswer는 사용자 답변과 프로필을 바탕으로 5-8문장으로 재구성한다.',
        '화상 자료가 없으면 visualAssessment.confidence는 0으로 하고 자료 없음이라고 쓴다.',
        'questionNumber가 totalQuestions 이상이면 nextQuestion은 빈 문자열이다.',
      ],
    };
  }
  return {
    task: '면접 종료 종합 리포트 생성', profile, previousTurns: history, sessionMetrics,
    requiredSchema: {
      overallScore: 'number 0-100', verdict: 'string',
      scorecard: { content: 'number 0-100', structure: 'number 0-100', specificity: 'number 0-100', delivery: 'number 0-100', confidence: 'number 0-100' },
      strengths: ['string'], priorities: ['string'], sevenDayPlan: ['string'], sampleClosing: 'string', finalComment: 'string',
    },
    rules: ['각 우선과제는 연습 방법까지 포함한다.', '7일 계획은 매일 수행 가능한 단위로 7개를 작성한다.', '합격을 보장하는 표현은 쓰지 않는다.'],
  };
};

const outputTextFromOpenAI = (data) => {
  if (typeof data?.output_text === 'string') return data.output_text;
  return (data?.output || []).flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text' && item.text)
    .map((item) => item.text).join('\n');
};

const safeProviderError = (provider, status, rawMessage = '') => {
  if (status === 401 || status === 403) return `${provider} 인증 실패: API 키와 해당 배포 환경 권한을 확인해 주세요.`;
  if (status === 429) return `${provider} 사용량 한도 또는 요청 제한에 도달했습니다.`;
  if (status >= 500) return `${provider} 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.`;
  const text = String(rawMessage || '')
    .replace(/sk-[A-Za-z0-9_*.-]+/gi, '[REDACTED]')
    .replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED]')
    .replace(/https?:\/\/\S+/g, '')
    .trim();
  return text ? `${provider} 요청 실패: ${text.slice(0, 240)}` : `${provider} 요청에 실패했습니다.`;
};

const callOpenAI = async ({ apiKey, model, prompt, frames }) => {
  const content = [{ type: 'input_text', text: JSON.stringify(prompt) }];
  for (const frame of frames) content.push({ type: 'input_image', image_url: frame.dataUrl });
  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, instructions, input: [{ role: 'user', content }], temperature: 0.3, max_output_tokens: 1800, store: false }),
    });
  } catch { throw new CoachError('OpenAI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 502); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new CoachError(safeProviderError('OpenAI', response.status, data?.error?.message), response.status || 502);
  return parseJson(outputTextFromOpenAI(data));
};

const callGemini = async ({ apiKey, model, prompt, frames, video }) => {
  const parts = [];
  if (video) parts.push({ inline_data: { mime_type: video.mimeType, data: video.data } });
  for (const frame of frames) parts.push({ inline_data: { mime_type: frame.mimeType, data: frame.data } });
  parts.push({ text: JSON.stringify(prompt) });
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: instructions }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.25, responseMimeType: 'application/json', maxOutputTokens: 1800, mediaResolution: 'MEDIA_RESOLUTION_LOW' },
      }),
    });
  } catch { throw new CoachError('Gemini 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 502); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new CoachError(safeProviderError('Gemini', response.status, data?.error?.message), response.status || 502);
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n');
  return parseJson(text);
};

const probeGemini = async (apiKey, model) => {
  if (!apiKey) return { configured: false, ok: false, status: 'not_configured' };
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    const data = await response.json().catch(() => ({}));
    return response.ok
      ? { configured: true, ok: true, status: response.status }
      : { configured: true, ok: false, status: response.status, error: safeProviderError('Gemini', response.status, data?.error?.message) };
  } catch {
    return { configured: true, ok: false, status: 'network_error', error: 'Gemini 진단 서버에 연결하지 못했습니다.' };
  }
};

const probeOpenAI = async (apiKey, model) => {
  if (!apiKey) return { configured: false, ok: false, status: 'not_configured' };
  try {
    const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = await response.json().catch(() => ({}));
    return response.ok
      ? { configured: true, ok: true, status: response.status }
      : { configured: true, ok: false, status: response.status, error: safeProviderError('OpenAI', response.status, data?.error?.message) };
  } catch {
    return { configured: true, ok: false, status: 'network_error', error: 'OpenAI 진단 서버에 연결하지 못했습니다.' };
  }
};

export async function getCoachDiagnostics(options = {}, { probe = false } = {}) {
  const preference = String(options.provider || 'auto').toLowerCase();
  const geminiApiKey = options.geminiApiKey;
  const openaiApiKey = options.openaiApiKey || options.apiKey;
  const geminiModel = options.geminiModel || 'gemini-2.5-flash-lite';
  const openaiModel = options.openaiModel || options.model || 'gpt-4o-mini';

  const diagnostics = {
    ok: true,
    preference,
    configured: { gemini: Boolean(geminiApiKey), openai: Boolean(openaiApiKey) },
    models: { gemini: geminiModel, openai: openaiModel },
    selection: preference === 'openai' ? 'openai' : geminiApiKey ? 'gemini' : openaiApiKey ? 'openai' : 'none',
  };

  if (!probe) return diagnostics;

  const [gemini, openai] = await Promise.all([
    probeGemini(geminiApiKey, geminiModel),
    probeOpenAI(openaiApiKey, openaiModel),
  ]);
  return { ...diagnostics, probes: { gemini, openai } };
}

export async function createCoachReply(body = {}, options = {}) {
  const action = ['start', 'answer', 'finish'].includes(body.action) ? body.action : 'answer';
  const profile = cleanProfile(body.profile);
  const transcript = clampText(body.transcript, MAX_TRANSCRIPT);
  if (action === 'answer' && transcript.length < 2) throw new CoachError('평가할 답변이 없습니다.', 400);

  const frames = profile.aiVisionEnabled ? cleanVisionFrames(body.visionFrames) : [];
  const video = profile.aiVisionEnabled ? cleanVideoSample(body.videoSample) : null;
  const prompt = buildPrompt({
    action, profile, transcript, history: cleanHistory(body.history), telemetry: cleanTelemetry(body.telemetry),
    questionNumber: Math.max(1, Math.min(20, Number(body.questionNumber) || 1)),
    totalQuestions: Math.max(1, Math.min(20, Number(body.totalQuestions) || 5)),
    sessionMetrics: cleanTelemetry(body.sessionMetrics),
    media: { hasVideo: Boolean(video), frameCount: frames.length, note: '영상은 답변당 최대 10초 저용량 표본이며 전체 면접 영상이 아니다.' },
  });

  const preference = String(options.provider || 'auto').toLowerCase();
  const geminiApiKey = options.geminiApiKey;
  const openaiApiKey = options.openaiApiKey || options.apiKey;
  let result;
  let provider;
  let model;

  if (preference !== 'openai' && geminiApiKey) {
    provider = 'gemini';
    model = options.geminiModel || 'gemini-2.5-flash-lite';
    try {
      result = await callGemini({ apiKey: geminiApiKey, model, prompt, frames, video });
    } catch (geminiError) {
      if (!openaiApiKey || preference === 'gemini') throw geminiError;
      provider = 'openai';
      model = options.openaiModel || options.model || 'gpt-4o-mini';
      try {
        result = await callOpenAI({ apiKey: openaiApiKey, model, prompt, frames });
      } catch (openaiError) {
        throw new CoachError(
          `Gemini 우선 호출 실패 (${geminiError.message}) / OpenAI 대체 호출도 실패 (${openaiError.message})`,
          openaiError.status || geminiError.status || 502,
        );
      }
    }
  } else if (openaiApiKey) {
    provider = 'openai';
    model = options.openaiModel || options.model || 'gpt-4o-mini';
    result = await callOpenAI({ apiKey: openaiApiKey, model, prompt, frames });
  } else {
    throw new CoachError('AI 코치가 설정되지 않았습니다. GEMINI_API_KEY 또는 OPENAI_API_KEY를 설정해 주세요.', 503);
  }

  return { ...result, meta: { provider, model, videoUsed: provider === 'gemini' && Boolean(video), frameCount: frames.length } };
}
