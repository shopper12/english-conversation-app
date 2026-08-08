const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite';
const LEGACY_MODELS = new Set(['gemini-2.5-flash-lite','gemini-2.5-flash-lite-preview-09-2025','gemini-3.1-flash-lite-preview']);
const MAX_RESUME_TEXT = 18000;
const MAX_PDF_DATA_URL = 3500000;

export class QuestionBankError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'QuestionBankError';
    this.status = status;
  }
}

const clampText = (value, max = 3000) => String(value || '').trim().slice(0, max);
const resolveModel = (value) => {
  const requested = String(value || '').trim();
  return !requested || LEGACY_MODELS.has(requested) ? DEFAULT_GEMINI_MODEL : requested;
};
const safeError = (status, raw = '') => {
  if (status === 401 || status === 403) return 'Gemini 인증 실패: API 키와 배포 환경을 확인해 주세요.';
  if (status === 429) return 'Gemini 사용량 한도 또는 요청 제한에 도달했습니다.';
  const text = String(raw || '').replace(/AIza[A-Za-z0-9_-]+/g, '[REDACTED]').replace(/https?:\/\/\S+/g, '').trim();
  return text ? `맞춤 질문 생성 실패: ${text.slice(0, 240)}` : '맞춤 질문 생성에 실패했습니다.';
};
const parseJson = (raw) => {
  const text = String(raw || '').trim();
  try { return JSON.parse(text); } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new QuestionBankError('맞춤 질문 응답에서 JSON을 찾지 못했습니다.', 502);
    try { return JSON.parse(match[0]); } catch { throw new QuestionBankError('맞춤 질문 응답 형식이 올바르지 않습니다.', 502); }
  }
};
const parsePdf = (value) => {
  const text = String(value || '');
  if (!text || text.length > MAX_PDF_DATA_URL) return null;
  const match = text.match(/^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/);
  return match ? { mimeType: 'application/pdf', data: match[1] } : null;
};
const cleanQuestion = (item, group, index) => ({
  id: clampText(item?.id, 80) || `${group}-ai-${index + 1}`,
  group,
  category: clampText(item?.category, 80) || (group === 'resume' ? '이력서 맞춤' : '직무 맞춤'),
  text: clampText(item?.text || item?.question, 600),
  competency: clampText(item?.competency, 120) || '직무 적합성',
  framework: ['STAR','PREP','CAR','DIRECT'].includes(item?.framework) ? item.framework : 'STAR',
  targetSeconds: Math.max(30, Math.min(180, Number(item?.targetSeconds) || 90)),
  intent: clampText(item?.intent, 300) || '실제 면접에서 확인할 핵심 역량 검증',
  rubric: (Array.isArray(item?.rubric) ? item.rubric : []).slice(0, 4).map((v) => clampText(v, 220)).filter(Boolean),
  rationale: clampText(item?.rationale, 500),
  source: 'ai-tailored',
});

const instructions = `너는 실제 채용 면접 문제를 설계하는 시니어 인터뷰 디자이너다.
질문은 지원자의 실제 직무 수행 가능성을 검증해야 하며, 일반적인 자기소개 질문과 직무·이력서 기반 질문을 구분한다.
행동면접에서는 과거 실제 행동을 묻고 STAR/CAR로 검증 가능한 질문을 우선한다.
직무질문은 채용공고의 업무, KSA(지식·기술·역량), 도구, 이해관계자, 품질, 리스크, 의사결정, 첫 90일을 반영한다.
이력서질문은 이력서에 실제로 적힌 회사·프로젝트·성과·전환·기간·역할을 근거로 깊이 파고들되 이력서에 없는 사실을 만들지 않는다.
성과 수치가 있으면 산식·본인 기여·기준시점·재현 가능성을 확인하는 꼬리질문을 만든다.
직무 전환이나 공백이 보일 때는 중립적으로 사실과 준비 과정을 묻고 차별적·민감한 사유를 추정하지 않는다.
나이, 성별, 혼인, 임신, 종교, 건강, 장애, 인종, 출신지역, 가족계획 등 보호될 수 있는 개인특성 질문은 만들지 않는다.
질문끼리 표현만 다른 중복을 만들지 않는다.
반드시 유효한 JSON 객체 하나만 출력한다.`;

export async function createTailoredQuestions(body = {}, options = {}) {
  const apiKey = options.geminiApiKey;
  if (!apiKey) throw new QuestionBankError('GEMINI_API_KEY가 설정되지 않았습니다.', 503);

  const mode = ['work','resume','all'].includes(body.mode) ? body.mode : 'all';
  const targetRole = clampText(body.targetRole, 180);
  if (!targetRole) throw new QuestionBankError('목표 직무를 먼저 입력해 주세요.', 400);

  const context = {
    targetRole,
    company: clampText(body.company, 160),
    interviewType: clampText(body.interviewType, 120),
    jobDescription: clampText(body.jobDescription, 6000),
    resumeHighlights: clampText(body.resumeHighlights, 4000),
    resumeText: clampText(body.resumeText, MAX_RESUME_TEXT),
  };
  const pdf = parsePdf(body.resumePdfDataUrl);
  if (body.resumePdfDataUrl && !pdf) throw new QuestionBankError('PDF 이력서는 2.5MB 이하의 정상 PDF 파일만 사용할 수 있습니다.', 400);
  if (mode === 'resume' && !pdf && !context.resumeText && !context.resumeHighlights) {
    throw new QuestionBankError('이력서를 업로드하거나 핵심 경력을 입력해 주세요.', 400);
  }

  const parts = [];
  if (pdf) parts.push({ inline_data: { mime_type: pdf.mimeType, data: pdf.data } });
  parts.push({ text: JSON.stringify({
    task: '지원자가 직접 선택해 연습할 예상 면접 질문 세트 생성',
    mode,
    context,
    requiredSchema: {
      resumeSummary: 'string - 이력서에서 확인되는 경력·프로젝트·성과를 8문장 이내로 요약. 이력서가 없으면 빈 문자열',
      workQuestions: [{
        id: 'string', category: 'string', text: 'string', competency: 'string', framework: 'STAR | PREP | CAR | DIRECT',
        targetSeconds: 'number 30-180', intent: 'string', rubric: ['평가기준 3개'], rationale: '왜 이 직무에서 나올 가능성이 높은지',
      }],
      resumeQuestions: [{
        id: 'string', category: 'string', text: 'string', competency: 'string', framework: 'STAR | PREP | CAR | DIRECT',
        targetSeconds: 'number 30-180', intent: 'string', rubric: ['평가기준 3개'], rationale: '이력서의 어떤 근거 때문에 묻는지',
      }],
    },
    rules: [
      'workQuestions는 mode가 resume이 아니면 12개, resume이면 6개를 만든다.',
      'resumeQuestions는 이력서 근거가 있으면 12개, 없으면 빈 배열로 만든다.',
      '채용공고가 있으면 일반 업계 질문보다 공고의 핵심업무와 요구역량을 우선한다.',
      '이력서 질문은 가장 중요한 경력/성과부터 파고들고 각 질문의 rationale에 이력서 근거를 짧게 적는다.',
      '질문은 실제 면접에서 한 번에 읽을 수 있도록 2문장 이내로 쓴다.',
    ],
  }) });

  const model = resolveModel(options.geminiModel);
  let response;
  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: instructions }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0.28, responseMimeType: 'application/json', maxOutputTokens: 3600, mediaResolution: 'MEDIA_RESOLUTION_LOW' },
      }),
    });
  } catch { throw new QuestionBankError('Gemini 맞춤 질문 서버에 연결하지 못했습니다.', 502); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new QuestionBankError(safeError(response.status, data?.error?.message), response.status || 502);
  const text = data?.candidates?.[0]?.content?.parts?.map((part) => part?.text || '').join('\n');
  const parsed = parseJson(text);
  const workQuestions = (Array.isArray(parsed?.workQuestions) ? parsed.workQuestions : []).slice(0, 14).map((q, i) => cleanQuestion(q, 'work', i)).filter((q) => q.text);
  const resumeQuestions = (Array.isArray(parsed?.resumeQuestions) ? parsed.resumeQuestions : []).slice(0, 14).map((q, i) => cleanQuestion(q, 'resume', i)).filter((q) => q.text);
  return {
    resumeSummary: clampText(parsed?.resumeSummary, 3200),
    workQuestions,
    resumeQuestions,
    meta: { provider: 'gemini', model, pdfUsed: Boolean(pdf) },
  };
}
