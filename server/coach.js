const MAX_TRANSCRIPT = 8000;
const MAX_HISTORY = 12;

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
  visionMode: clampText(telemetry.visionMode, 40),
});

const cleanHistory = (history = []) => (Array.isArray(history) ? history : [])
  .slice(-MAX_HISTORY)
  .map((item) => ({
    question: clampText(item?.question, 800),
    answer: clampText(item?.answer, 2500),
    score: clampNumber(item?.feedback?.overallScore ?? item?.feedback?.scores?.overall, 0, 100),
  }));

const outputTextFromResponse = (data) => {
  if (typeof data?.output_text === 'string') return data.output_text;
  return (data?.output || []).flatMap((item) => item?.content || [])
    .filter((item) => item?.type === 'output_text' && item.text)
    .map((item) => item.text)
    .join('\n');
};

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

const instructions = `너는 한국어로 진행하는 시니어 면접관 겸 면접 코치다.
사용자의 목표 직무와 경력에 맞춰 실제 면접처럼 질문하고, 답변 뒤에는 구체적이고 행동 가능한 피드백을 제공한다.
STAR 또는 PREP 구조, 직무 전문성, 사례의 구체성, 논리, 전달력, 자신감을 평가한다.
화상 지표는 화면 내 얼굴 존재, 프레이밍, 시선 정렬, 움직임 안정성처럼 관찰 가능한 전달 지표로만 해석한다.
외모, 나이, 성별, 인종, 장애, 건강상태, 성격 또는 감정을 추론하거나 평가하지 않는다.
영상·음성 지표가 없거나 낮은 신뢰도이면 단정하지 말고 제한을 명시한다.
반드시 유효한 JSON 객체 하나만 출력하고 마크다운 코드펜스는 쓰지 않는다.`;

const buildPrompt = ({ action, profile, transcript, history, telemetry, questionNumber, totalQuestions, sessionMetrics }) => {
  if (action === 'start') {
    return {
      task: '첫 면접 질문 생성',
      profile,
      requiredSchema: { question: 'string', intent: 'string', preparationTip: 'string' },
      rules: ['첫 질문은 자기소개 또는 지원동기 중 프로필에 더 적합한 것으로 시작한다.', '질문은 한 번에 하나만 하고 2문장 이내로 작성한다.'],
    };
  }

  if (action === 'answer') {
    return {
      task: '답변 평가 및 다음 질문 생성',
      profile,
      current: { transcript, telemetry, questionNumber, totalQuestions },
      previousTurns: history,
      requiredSchema: {
        feedback: {
          overallScore: 'number 0-100', summary: 'string', strengths: ['string'], improvements: ['string'],
          scores: { content: 'number 0-100', structure: 'number 0-100', specificity: 'number 0-100', delivery: 'number 0-100', confidence: 'number 0-100' },
          betterAnswer: 'string', deliveryNote: 'string',
        },
        nextQuestion: 'string; 마지막 질문이면 빈 문자열',
        nextIntent: 'string; 마지막 질문이면 빈 문자열',
      },
      rules: ['칭찬만 하지 말고 가장 큰 결함을 우선순위로 지적한다.', 'betterAnswer는 사용자의 실제 답변과 프로필을 바탕으로 5-8문장으로 재구성한다.', '답변에 없는 경력이나 수치를 지어내지 않는다.', 'questionNumber가 totalQuestions 이상이면 nextQuestion은 빈 문자열이다.'],
    };
  }

  return {
    task: '면접 종료 종합 리포트 생성',
    profile,
    previousTurns: history,
    sessionMetrics,
    requiredSchema: {
      overallScore: 'number 0-100', verdict: 'string',
      scorecard: { content: 'number 0-100', structure: 'number 0-100', specificity: 'number 0-100', delivery: 'number 0-100', confidence: 'number 0-100' },
      strengths: ['string'], priorities: ['string'], sevenDayPlan: ['string'], sampleClosing: 'string', finalComment: 'string',
    },
    rules: ['각 우선과제는 연습 방법까지 포함한다.', '7일 계획은 매일 수행 가능한 단위로 7개를 작성한다.', '합격을 보장하는 표현은 쓰지 않는다.'],
  };
};

export async function createCoachReply(body = {}, { apiKey, model } = {}) {
  if (!apiKey) throw new CoachError('AI 코치가 아직 설정되지 않았습니다. 관리자에게 OPENAI_API_KEY 설정을 요청해 주세요.', 503);

  const action = ['start', 'answer', 'finish'].includes(body.action) ? body.action : 'answer';
  const transcript = clampText(body.transcript, MAX_TRANSCRIPT);
  if (action === 'answer' && transcript.length < 2) throw new CoachError('평가할 답변이 없습니다.', 400);

  const prompt = buildPrompt({
    action,
    profile: cleanProfile(body.profile),
    transcript,
    history: cleanHistory(body.history),
    telemetry: cleanTelemetry(body.telemetry),
    questionNumber: Math.max(1, Math.min(20, Number(body.questionNumber) || 1)),
    totalQuestions: Math.max(1, Math.min(20, Number(body.totalQuestions) || 5)),
    sessionMetrics: cleanTelemetry(body.sessionMetrics),
  });

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        instructions,
        input: JSON.stringify(prompt),
        temperature: 0.35,
        max_output_tokens: action === 'finish' ? 1800 : 1200,
        store: false,
      }),
    });
  } catch {
    throw new CoachError('AI 코치 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new CoachError(data?.error?.message || 'AI 코치 요청에 실패했습니다.', response.status || 502);
  return parseJson(outputTextFromResponse(data));
}
