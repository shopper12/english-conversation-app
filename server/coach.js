const MAX_TRANSCRIPT = 8000;
const MAX_HISTORY = 12;
const MAX_FRAMES = 4;
const MAX_FRAME_CHARS = 450000;
const MAX_VIDEO_CHARS = 1800000;

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const LEGACY_GEMINI_MODELS = new Set([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-09-2025',
  'gemini-3.1-flash-lite-preview',
]);

const resolveGeminiModel = (value) => {
  const requested = String(value || '').trim();
  if (!requested || LEGACY_GEMINI_MODELS.has(requested)) return DEFAULT_GEMINI_MODEL;
  return requested;
};

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

const cleanStringArray = (value, maxItems = 6, maxChars = 500) => (
  (Array.isArray(value) ? value : [])
    .slice(0, maxItems)
    .map((item) => clampText(item, maxChars))
    .filter(Boolean)
);

const cleanProfile = (profile = {}) => ({
  targetRole: clampText(profile.targetRole, 120),
  company: clampText(profile.company, 120),
  experience: clampText(profile.experience, 80),
  interviewType: clampText(profile.interviewType, 80),
  language: clampText(profile.language, 20) || 'ko-KR',
  resumeHighlights: clampText(profile.resumeHighlights, 3200),
  jobDescription: clampText(profile.jobDescription, 3200),
  focusCompetencies: clampText(profile.focusCompetencies, 600),
  sessionMode: ['coach', 'simulation'].includes(profile.sessionMode) ? profile.sessionMode : 'coach',
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
  visionMode: clampText(telemetry.visionMode, 100),
});

const cleanQuestionMeta = (meta = {}) => ({
  questionType: clampText(meta.questionType, 80),
  competency: clampText(meta.competency, 120),
  framework: clampText(meta.framework, 40),
  targetSeconds: clampNumber(meta.targetSeconds, 30, 180),
  rubric: cleanStringArray(meta.rubric, 4, 240),
});

const cleanRubricAssessment = (items) => (
  (Array.isArray(items) ? items : [])
    .slice(0, 4)
    .map((item) => ({
      criterion: clampText(item?.criterion, 240),
      score: clampNumber(item?.score, 0, 100),
      evidence: clampText(item?.evidence, 500),
      action: clampText(item?.action, 500),
    }))
);

const cleanFrameworkAnalysis = (value = {}) => ({
  framework: clampText(value?.framework, 40),
  coverage: (Array.isArray(value?.coverage) ? value.coverage : []).slice(0, 6).map((item) => ({
    element: clampText(item?.element, 80),
    status: ['met', 'partial', 'missing'].includes(item?.status) ? item.status : 'partial',
    evidence: clampText(item?.evidence, 360),
  })),
  missing: cleanStringArray(value?.missing, 5, 300),
});

const cleanHistory = (history = []) => (Array.isArray(history) ? history : [])
  .slice(-MAX_HISTORY)
  .map((item) => ({
    question: clampText(item?.question, 900),
    intent: clampText(item?.intent, 400),
    questionMeta: cleanQuestionMeta(item?.questionMeta),
    answer: clampText(item?.answer, 3200),
    telemetry: cleanTelemetry(item?.telemetry),
    feedback: {
      overallScore: clampNumber(item?.feedback?.overallScore ?? item?.feedback?.scores?.overall, 0, 100),
      summary: clampText(item?.feedback?.summary, 700),
      strengths: cleanStringArray(item?.feedback?.strengths, 4, 400),
      improvements: cleanStringArray(item?.feedback?.improvements, 4, 400),
      competencyName: clampText(item?.feedback?.competencyAssessment?.name, 120),
      competencyScore: clampNumber(item?.feedback?.competencyAssessment?.score, 0, 100),
      frameworkAnalysis: cleanFrameworkAnalysis(item?.feedback?.frameworkAnalysis),
      rubricAssessment: cleanRubricAssessment(item?.feedback?.rubricAssessment),
      visualSummary: clampText(item?.feedback?.visualAssessment?.summary, 500),
    },
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
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new CoachError('AI 응답에서 JSON을 찾지 못했습니다.', 502);
    try {
      return JSON.parse(match[0]);
    } catch {
      throw new CoachError('AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.', 502);
    }
  }
};

const instructions = `너는 실제 채용현장의 구조화 면접을 설계·진행하는 시니어 면접관이자 면접 코치다.
지원 직무, 경력, 채용공고, 사용자가 지정한 집중역량을 근거로 질문과 평가기준을 만든다.
행동사건면접(BEI)은 Situation/Task보다 사용자가 실제로 한 Action과 그 Result를 깊게 검증하고, 맥락이 불충분하면 후속 질문으로 파고든다.
답변 평가는 현재 질문과 사전에 제시한 rubric을 기준으로 일관되게 수행한다. 질문을 모른 채 답변만 일반적으로 평가하지 않는다.
점수 기준: 90~100은 질문에 직접 답하고 구체적 행동·근거·결과가 충분하며 직무 연결이 명확한 수준, 75~89는 대체로 충족하지만 일부 근거나 구조가 약한 수준, 60~74는 부분 충족, 59 이하는 핵심 근거 또는 질문 적합성이 부족한 수준이다.
STAR/PREP/CAR 등 질문에 적합한 구조를 사용하되 형식 자체보다 실제 행동과 판단 근거를 우선한다.
말하기 텔레메트리는 절대적 인성 판단이 아니라 해당 답변의 속도·침묵·군더더기 표현을 보조적으로 설명하는 데만 사용한다.
화상 자료는 프레이밍, 카메라 방향 시선, 자세 변화, 과도한 움직임처럼 직접 관찰 가능한 전달 행동만 평가한다.
외모, 매력, 나이, 성별, 인종, 장애, 건강상태, 성격 또는 감정을 추론하거나 평가하지 않는다.
'자신감 있어 보인다/불안해 보인다' 같은 심리 추론을 화상 자료에서 하지 않는다.
화상 표본이 짧거나 불명확하면 단정하지 말고 관찰 한계를 명시한다.
답변에 없는 경력, 행동, 수치, 결과를 지어내지 않는다. 개선 답변에도 사용자가 제공한 사실만 사용한다.
모든 평가에는 왜 그 점수인지 확인 가능한 답변 근거를 붙인다.
반드시 유효한 JSON 객체 하나만 출력하고 마크다운 코드펜스는 쓰지 않는다.`;

const buildPrompt = ({
  action, profile, question, questionIntent, questionMeta, transcript, history, telemetry,
  questionNumber, totalQuestions, sessionMetrics, media,
}) => {
  if (action === 'start') {
    return {
      task: '구조화 면접의 첫 질문과 질문별 평가기준 생성',
      profile,
      requiredSchema: {
        question: 'string',
        intent: 'string - 질문이 검증하려는 이유를 지원자에게 이해 가능한 수준으로 짧게',
        questionMeta: {
          questionType: 'string - 예: 경험·역량, 직무, 상황, 동기, 리더십',
          competency: 'string - 이번 질문의 핵심 역량 하나',
          framework: 'STAR | PREP | CAR | DIRECT 중 하나',
          targetSeconds: 'number 30-180',
          rubric: ['관찰 가능한 평가기준 3개. 답변 전에 보여줘도 되는 수준으로 간결하게'],
        },
      },
      rules: [
        '첫 질문은 프로필과 면접 유형에 맞는 실제 면접 질문이어야 한다.',
        'BEI 역량면접이면 과거 실제 경험을 묻고, 사용자의 행동과 결과를 검증할 수 있게 질문한다.',
        '직무 심층이면 채용공고와 핵심 경력에 연결된 판단·문제해결 질문을 우선한다.',
        'rubric은 모호한 성격 특성이 아니라 답변에서 확인할 수 있는 행동·근거·결과 기준으로 만든다.',
        '질문은 한 번에 하나만 하고 2문장 이내로 작성한다.',
      ],
    };
  }

  if (action === 'answer') {
    return {
      task: '현재 질문에 대한 답변을 구조화된 기준으로 평가하고 맥락 기반 후속 질문 생성',
      profile,
      currentQuestion: {
        question,
        intent: questionIntent,
        meta: questionMeta,
        questionNumber,
        totalQuestions,
      },
      currentAnswer: {
        transcript,
        telemetry,
        media,
      },
      previousTurns: history,
      requiredSchema: {
        feedback: {
          overallScore: 'number 0-100',
          summary: 'string - 합격/불합격 단정 대신 현재 답변의 수준을 2-3문장으로 요약',
          strengths: ['string'],
          improvements: ['string - 가장 영향이 큰 순서'],
          scores: {
            relevance: 'number 0-100 - 질문 의도에 직접 답한 정도',
            structure: 'number 0-100 - 질문에 맞는 논리/STAR/PREP 구조',
            evidence: 'number 0-100 - 행동·수치·결과·판단 근거의 구체성',
            delivery: 'number 0-100 - 텔레메트리와 표현 명료도를 합친 전달 품질',
            jobFit: 'number 0-100 - 이 답변의 경험을 지원 직무 요구와 연결한 정도',
          },
          competencyAssessment: {
            name: 'string',
            score: 'number 0-100',
            rationale: 'string - 답변 속 행동지표에 근거',
          },
          frameworkAnalysis: {
            framework: 'string',
            coverage: [
              { element: 'string', status: 'met | partial | missing', evidence: 'string - 답변에서 확인되는 짧은 근거 또는 부족 설명' },
            ],
            missing: ['string'],
          },
          rubricAssessment: [
            { criterion: 'string - 질문Meta rubric과 대응', score: 'number 0-100', evidence: 'string', action: 'string - 다음 답변에서 할 행동' },
          ],
          keyEvidence: ['string - 답변 속 중요한 사실/행동 근거를 짧게 요약'],
          betterAnswer: 'string - 사용자가 말한 사실만으로 5-8문장 개선',
          deliveryNote: 'string - 속도/침묵/군더더기 표현 중 실제 데이터가 의미 있는 것만',
          visualAssessment: {
            summary: 'string',
            strengths: ['string'],
            improvements: ['string'],
            confidence: 'number 0-100 - 분석 자료의 신뢰도이지 사람의 자신감이 아님',
            evidenceLimit: 'string',
          },
        },
        nextQuestion: 'string; 마지막 질문이면 빈 문자열',
        nextIntent: 'string; 마지막 질문이면 빈 문자열',
        nextQuestionMeta: {
          questionType: 'string',
          competency: 'string',
          framework: 'STAR | PREP | CAR | DIRECT',
          targetSeconds: 'number 30-180',
          rubric: ['string'],
        },
      },
      rules: [
        '현재 질문과 currentQuestion.meta.rubric을 평가의 기준점으로 삼는다.',
        'rubricAssessment는 원래 rubric 각각에 가능한 한 1:1로 대응한다.',
        '답변이 질문을 회피했으면 내용이 유창해도 relevance를 높게 주지 않는다.',
        'BEI 질문에서 Action이 모호하거나 팀 성과만 말하면 다음 질문에서 본인 행동과 판단을 구체적으로 캐묻는다.',
        'follow-up은 이전 답변의 빈틈, 모순, 미검증 역량을 우선 검증한다. 무관한 새 질문으로 갑자기 넘어가지 않는다.',
        '화상 자료가 없으면 visualAssessment.confidence는 0으로 하고 자료 없음이라고 쓴다.',
        'questionNumber가 totalQuestions 이상이면 nextQuestion은 빈 문자열이다.',
      ],
    };
  }

  return {
    task: '구조화 면접 종료 종합 리포트 생성',
    profile,
    previousTurns: history,
    sessionMetrics,
    requiredSchema: {
      overallScore: 'number 0-100',
      readiness: {
        level: '준비됨 | 거의 준비됨 | 보완 필요 | 집중 훈련 필요 중 하나',
        summary: 'string - 현재 준비도를 결정한 핵심 이유',
      },
      verdict: 'string - 전체 면접의 핵심 결론 한 문장',
      scorecard: {
        relevance: 'number 0-100',
        structure: 'number 0-100',
        evidence: 'number 0-100',
        delivery: 'number 0-100',
        jobFit: 'number 0-100',
      },
      competencyMatrix: [
        { name: 'string', score: 'number 0-100', evidence: 'string', nextDrill: 'string' },
      ],
      communication: {
        wordsPerMinute: 'number - sessionMetrics를 그대로 반영',
        fillerCount: 'number - sessionMetrics를 그대로 반영',
        silenceRatio: 'number 0-1 - sessionMetrics를 그대로 반영',
        eyeContact: 'number 0-100 - sessionMetrics를 그대로 반영',
        framing: 'number 0-100',
        stability: 'number 0-100',
        summary: 'string - 과도한 심리추론 없이 데이터 해석',
      },
      strengths: ['string'],
      priorities: ['string - 최대 3개, 영향도가 큰 순서'],
      practiceQueue: [
        { priority: 'string', drill: 'string - 10~20분 내 반복 가능한 연습', successMetric: 'string - 측정 가능한 성공 기준' },
      ],
      sevenDayPlan: ['string - 정확히 7개'],
      sampleClosing: 'string',
      finalComment: 'string',
    },
    rules: [
      '질문별 rubricAssessment와 frameworkAnalysis를 종합해 역량별 반복 패턴을 찾는다.',
      '한 번의 짧은 화상 표본으로 성격이나 심리를 평가하지 않는다.',
      'communication의 수치 필드는 sessionMetrics의 실제 값을 임의로 바꾸지 않는다.',
      'practiceQueue는 가장 약한 역량과 반복되는 전달 문제에 직접 대응한다.',
      '7일 계획은 매일 수행 가능한 구체적 단위로 정확히 7개를 작성한다.',
      '합격을 보장하는 표현은 쓰지 않는다.',
    ],
  };
};

const outputTextFromOpenAI = (data) => {
  if (typeof data?.output_text === 'string') return data.output_text;
  return (data?.output || []).flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text' && item.text)
    .map((item) => item.text)
    .join('\n');
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
      body: JSON.stringify({
        model,
        instructions,
        input: [{ role: 'user', content }],
        temperature: 0.25,
        max_output_tokens: 2800,
        store: false,
      }),
    });
  } catch {
    throw new CoachError('OpenAI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CoachError(safeProviderError('OpenAI', response.status, data?.error?.message), response.status || 502);
  }
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
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json',
          maxOutputTokens: 2800,
          mediaResolution: 'MEDIA_RESOLUTION_LOW',
        },
      }),
    });
  } catch {
    throw new CoachError('Gemini 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new CoachError(safeProviderError('Gemini', response.status, data?.error?.message), response.status || 502);
  }
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n');
  return parseJson(text);
};

const probeGemini = async (apiKey, model) => {
  if (!apiKey) return { configured: false, ok: false, status: 'not_configured' };
  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: 'Return only a valid JSON object.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Return {"probe":true}.' }] }],
        generationConfig: {
          temperature: 0.25,
          responseMimeType: 'application/json',
          maxOutputTokens: 80,
          mediaResolution: 'MEDIA_RESOLUTION_LOW',
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n') || '';
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* probe only checks request success */ }
    return response.ok
      ? { configured: true, ok: true, status: response.status, generated: parsed?.probe === true }
      : { configured: true, ok: false, status: response.status, error: safeProviderError('Gemini', response.status, data?.error?.message) };
  } catch {
    return { configured: true, ok: false, status: 'network_error', error: 'Gemini 생성 진단 서버에 연결하지 못했습니다.' };
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
  const requestedGeminiModel = String(options.geminiModel || '').trim();
  const geminiModel = resolveGeminiModel(requestedGeminiModel);
  const openaiModel = options.openaiModel || options.model || 'gpt-4o-mini';

  const diagnostics = {
    ok: true,
    preference,
    configured: { gemini: Boolean(geminiApiKey), openai: Boolean(openaiApiKey) },
    models: { gemini: geminiModel, openai: openaiModel },
    modelMigration: requestedGeminiModel && requestedGeminiModel !== geminiModel
      ? { requested: requestedGeminiModel, resolved: geminiModel }
      : null,
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
  const question = clampText(body.question, 1000);
  const questionIntent = clampText(body.questionIntent, 500);
  const questionMeta = cleanQuestionMeta(body.questionMeta);
  const transcript = clampText(body.transcript, MAX_TRANSCRIPT);

  if (action === 'answer' && transcript.length < 2) {
    throw new CoachError('평가할 답변이 없습니다.', 400);
  }
  if (action === 'answer' && !question) {
    throw new CoachError('평가할 현재 질문이 없습니다.', 400);
  }

  const frames = profile.aiVisionEnabled ? cleanVisionFrames(body.visionFrames) : [];
  const video = profile.aiVisionEnabled ? cleanVideoSample(body.videoSample) : null;
  const cleanedHistory = cleanHistory(body.history);
  const cleanedTelemetry = cleanTelemetry(body.telemetry);
  const cleanedSessionMetrics = cleanTelemetry(body.sessionMetrics);

  const prompt = buildPrompt({
    action,
    profile,
    question,
    questionIntent,
    questionMeta,
    transcript,
    history: cleanedHistory,
    telemetry: cleanedTelemetry,
    questionNumber: Math.max(1, Math.min(20, Number(body.questionNumber) || 1)),
    totalQuestions: Math.max(1, Math.min(20, Number(body.totalQuestions) || 5)),
    sessionMetrics: cleanedSessionMetrics,
    media: {
      hasVideo: Boolean(video),
      frameCount: frames.length,
      note: '영상은 답변 시작 후 수집한 최대 10초 저용량 표본이며 전체 면접 영상이 아니다.',
    },
  });

  const preference = String(options.provider || 'auto').toLowerCase();
  const geminiApiKey = options.geminiApiKey;
  const openaiApiKey = options.openaiApiKey || options.apiKey;
  let result;
  let provider;
  let model;

  if (preference !== 'openai' && geminiApiKey) {
    provider = 'gemini';
    model = resolveGeminiModel(options.geminiModel);
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

  if (action === 'finish') {
    result.communication = {
      ...(result.communication || {}),
      wordsPerMinute: cleanedSessionMetrics.wordsPerMinute,
      fillerCount: cleanedSessionMetrics.fillerCount,
      silenceRatio: cleanedSessionMetrics.silenceRatio,
      eyeContact: cleanedSessionMetrics.eyeContact,
      framing: cleanedSessionMetrics.framing,
      stability: cleanedSessionMetrics.stability,
    };
  }

  return {
    ...result,
    meta: {
      provider,
      model,
      videoUsed: provider === 'gemini' && Boolean(video),
      frameCount: frames.length,
    },
  };
}
