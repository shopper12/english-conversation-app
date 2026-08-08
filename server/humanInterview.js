const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const LEGACY_GEMINI_MODELS = new Set([
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-09-2025',
  'gemini-3.1-flash-lite-preview',
]);
const MAX_FRAME_CHARS = 450000;
const MAX_FRAMES = 4;

export class HumanInterviewError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'HumanInterviewError';
    this.status = status;
  }
}

const clampText = (value, max = 3000) => String(value || '').trim().slice(0, max);
const clampNumber = (value, min = 0, max = 100) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : 0;
};
const resolveGeminiModel = (value) => {
  const requested = String(value || '').trim();
  if (!requested || LEGACY_GEMINI_MODELS.has(requested)) return DEFAULT_GEMINI_MODEL;
  return requested;
};
const parseDataUrl = (value) => {
  const text = String(value || '');
  if (!text || text.length > MAX_FRAME_CHARS) return null;
  const match = text.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
};
const cleanFrames = (value) => (Array.isArray(value) ? value : [])
  .slice(0, MAX_FRAMES)
  .map(parseDataUrl)
  .filter(Boolean);

const cleanTelemetry = (value = {}) => ({
  durationSeconds: clampNumber(value.durationSeconds, 0, 1800),
  wordsPerMinute: clampNumber(value.wordsPerMinute, 0, 400),
  silenceRatio: clampNumber(value.silenceRatio, 0, 1),
  voiceEnergy: clampNumber(value.voiceEnergy, 0, 100),
  voiceDynamics: clampNumber(value.voiceDynamics, 0, 100),
  speakingRatio: clampNumber(value.speakingRatio, 0, 1),
  eyeContact: clampNumber(value.eyeContact, 0, 100),
  framing: clampNumber(value.framing, 0, 100),
  stability: clampNumber(value.stability, 0, 100),
});

const safeError = (status, raw = '') => {
  if (status === 401 || status === 403) return 'Gemini 인증 실패: 배포 환경의 API 키를 확인해 주세요.';
  if (status === 429) return 'Gemini 사용량 한도 또는 요청 제한에 도달했습니다.';
  const text = String(raw || '').replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/https?:\/\/\S+/g, '').trim();
  return text ? `Gemini 사람면접 평가 실패: ${text.slice(0, 220)}` : 'Gemini 사람면접 평가에 실패했습니다.';
};

const parseJson = (raw) => {
  const text = String(raw || '').trim();
  try { return JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new HumanInterviewError('사람면접 평가 응답에서 JSON을 찾지 못했습니다.', 502);
    try { return JSON.parse(match[0]); } catch {
      throw new HumanInterviewError('사람면접 평가 응답 형식이 올바르지 않습니다.', 502);
    }
  }
};

const instructions = `너는 실제 사람 면접 대비를 돕는 시니어 면접 코치다.
사용자의 직무 역량 점수와 별도로, 사람이 면접장에서 실제로 받을 수 있는 커뮤니케이션 인상을 평가한다.

평가 원칙:
1. 평가 대상은 오직 관찰 가능한 행동이다: 시선 방향, 표정의 맥락 적합성, 자세와 상체 안정성, 자연스러운 제스처, 질문을 듣는 동안의 경청 행동, 답변 중 전달 방식, 목소리 크기 변화, 말속도, 침묵과 멈춤, 답변의 시작과 마무리, 기본적인 전문적 태도.
2. 외모의 매력, 얼굴 생김새, 나이, 성별, 인종, 장애, 건강상태, 사회경제적 배경을 평가하거나 추론하지 않는다.
3. 성격, 감정, 정직성, 자신감 같은 내적 상태를 단정하지 않는다. 대신 "시선 이탈이 잦아 관심이 약하게 보일 수 있다"처럼 행동과 가능한 인상을 분리해 표현한다.
4. 면접관의 첫인상과 호감도는 실제 채용판단에 영향을 줄 수 있지만 편향될 수 있다. 따라서 이 평가는 직무 적합성 점수에 합산하지 않는 별도의 '인상/전달 코칭'이다.
5. 눈맞춤은 오래 응시하는 것을 정답으로 보지 않는다. 자연스럽게 상대를 보다가 생각할 때 잠깐 시선을 돌리고 다시 돌아오는 패턴을 긍정적으로 본다.
6. 미소를 항상 많이 짓는 것을 정답으로 보지 않는다. 질문 맥락과 표현이 자연스럽게 맞는지를 본다.
7. 자세는 꼿꼿함 자체보다 편안하면서도 주의를 기울이는 열린 자세, 과도한 흔들림이나 반복적인 초조 동작이 없는지를 본다.
8. 제스처는 없다고 감점하지 않는다. 의미를 돕는 자연스러운 손동작은 긍정적이며 반복적이거나 산만한 움직임은 개선 대상으로 본다.
9. 음성 원본은 제공되지 않는다. voiceEnergy는 평균 음량 에너지, voiceDynamics는 음량 강약 변화의 상대지표다. 이를 실제 음색·피치·감정으로 오해하지 않는다.
10. 영어일 때만 100~165 WPM을 참고 가능한 넓은 발표/면접 처리 범위로 볼 수 있다. 한국어의 어절/분에는 영어 WPM 기준을 기계적으로 적용하지 말고, 지나친 급박함/늘어짐은 다른 지표와 함께 보수적으로 판단한다.
11. 침묵은 모두 나쁜 것이 아니다. 질문 후 생각하는 짧은 멈춤과 핵심 문장 사이의 의도적 pause는 긍정적일 수 있다.
12. 질문을 듣는 장면은 LISTENING_FRAME, 답변 장면은 ANSWER_FRAME으로 구분한다. 표본이 적으면 한계를 명시한다.
13. 좋은 점과 나쁜 점을 모두 구체적으로 제시하고, 각 개선점에는 다음 연습에서 바로 할 수 있는 행동을 붙인다.
14. 반드시 유효한 JSON 객체 하나만 출력한다.`;

const cleanAssessment = (value = {}) => ({
  overallPresenceScore: clampNumber(value.overallPresenceScore, 0, 100),
  interviewerImpression: clampText(value.interviewerImpression, 1000),
  goodPoints: (Array.isArray(value.goodPoints) ? value.goodPoints : []).slice(0, 4).map((item) => ({
    point: clampText(item?.point, 240),
    evidence: clampText(item?.evidence, 600),
    likelyImpression: clampText(item?.likelyImpression, 500),
  })),
  riskPoints: (Array.isArray(value.riskPoints) ? value.riskPoints : []).slice(0, 4).map((item) => ({
    point: clampText(item?.point, 240),
    evidence: clampText(item?.evidence, 600),
    likelyImpression: clampText(item?.likelyImpression, 500),
    fix: clampText(item?.fix, 500),
  })),
  dimensions: (Array.isArray(value.dimensions) ? value.dimensions : []).slice(0, 9).map((item) => ({
    key: clampText(item?.key, 80),
    label: clampText(item?.label, 120),
    score: clampNumber(item?.score, 0, 100),
    evidence: clampText(item?.evidence, 700),
    likelyImpression: clampText(item?.likelyImpression, 500),
    action: clampText(item?.action, 500),
  })),
  nextPractice: (Array.isArray(value.nextPractice) ? value.nextPractice : []).slice(0, 3).map((item) => clampText(item, 500)).filter(Boolean),
  evidenceConfidence: clampNumber(value.evidenceConfidence, 0, 100),
  limitations: (Array.isArray(value.limitations) ? value.limitations : []).slice(0, 5).map((item) => clampText(item, 500)).filter(Boolean),
});

const schema = {
  overallPresenceScore: 'number 0-100; 직무역량과 별도의 사람면접 전달/인상 점수',
  interviewerImpression: 'string; 관찰 행동 때문에 면접관에게 어떻게 비칠 수 있는지 2-4문장, 심리 단정 금지',
  goodPoints: [
    { point: 'string', evidence: 'string', likelyImpression: 'string' },
  ],
  riskPoints: [
    { point: 'string', evidence: 'string', likelyImpression: 'string', fix: 'string' },
  ],
  dimensions: [
    {
      key: 'first_impression | eye_contact | facial_expression | posture | gestures | listening | vocal_dynamics | pace_pauses | professionalism',
      label: 'string',
      score: 'number 0-100',
      evidence: 'string',
      likelyImpression: 'string',
      action: 'string',
    },
  ],
  nextPractice: ['string; 3개 이내'],
  evidenceConfidence: 'number 0-100; 표본의 충분성',
  limitations: ['string'],
};

export async function createHumanInterviewAssessment(body = {}, options = {}) {
  const apiKey = options.geminiApiKey;
  if (!apiKey) throw new HumanInterviewError('GEMINI_API_KEY가 설정되지 않았습니다.', 503);

  const question = clampText(body.question, 1000);
  const transcript = clampText(body.transcript, 8000);
  if (transcript.length < 2) throw new HumanInterviewError('평가할 답변이 없습니다.', 400);

  const listeningFrames = cleanFrames(body.listeningFrames);
  const answerFrames = cleanFrames(body.answerFrames);
  const telemetry = cleanTelemetry(body.telemetry);
  const language = clampText(body.language, 20) || 'ko-KR';
  const targetRole = clampText(body.targetRole, 160);
  const interviewType = clampText(body.interviewType, 120);

  const parts = [];
  listeningFrames.forEach((frame, index) => {
    parts.push({ text: `LISTENING_FRAME_${index + 1}: 질문을 듣는 동안의 표본` });
    parts.push({ inline_data: { mime_type: frame.mimeType, data: frame.data } });
  });
  answerFrames.forEach((frame, index) => {
    parts.push({ text: `ANSWER_FRAME_${index + 1}: 답변 중의 표본` });
    parts.push({ inline_data: { mime_type: frame.mimeType, data: frame.data } });
  });
  parts.push({
    text: JSON.stringify({
      task: '실제 사람 면접관 관점의 비언어·음성 전달·첫인상 코칭',
      context: { targetRole, interviewType, language, question, transcript },
      telemetry,
      frameEvidence: { listeningFrames: listeningFrames.length, answerFrames: answerFrames.length },
      requiredSchema: schema,
      rules: [
        'dimensions에는 가능한 경우 9개 key를 모두 한 번씩 포함한다.',
        '볼 수 없거나 측정할 수 없는 dimension은 억지 추론하지 말고 evidence에 자료 부족을 쓰고 낮은 evidenceConfidence를 반영한다.',
        'vocal_dynamics는 실제 음색이나 감정이 아니라 voiceEnergy/voiceDynamics/speakingRatio/silenceRatio/속도 수치만 근거로 쓴다.',
        'interviewerImpression은 채용 가능성 예측이 아니라 커뮤니케이션 인상 코칭이다.',
      ],
    }),
  });

  const model = resolveGeminiModel(options.geminiModel);
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
          maxOutputTokens: 2400,
          mediaResolution: 'MEDIA_RESOLUTION_LOW',
        },
      }),
    });
  } catch {
    throw new HumanInterviewError('Gemini 사람면접 평가 서버에 연결하지 못했습니다.', 502);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HumanInterviewError(safeError(response.status, data?.error?.message), response.status || 502);
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n');
  const assessment = cleanAssessment(parseJson(text));

  return {
    assessment,
    meta: {
      provider: 'gemini',
      model,
      listeningFrameCount: listeningFrames.length,
      answerFrameCount: answerFrames.length,
    },
  };
}
