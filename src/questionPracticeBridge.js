let activeQueue = [];

const normalize = (item, index) => ({
  id: String(item?.id || `selected-${index + 1}`),
  text: String(item?.text || item?.question || '').trim(),
  intent: String(item?.intent || '사용자가 선택한 예상 면접 질문').trim(),
  meta: {
    questionType: String(item?.questionType || item?.category || '선택 질문'),
    competency: String(item?.competency || '직무 적합성'),
    framework: String(item?.framework || 'STAR'),
    targetSeconds: Math.max(30, Math.min(180, Number(item?.targetSeconds) || 90)),
    rubric: Array.isArray(item?.rubric) && item.rubric.length
      ? item.rubric.slice(0, 4).map((value) => String(value))
      : ['질문에 직접 답했는가', '구체적인 행동·근거가 있는가', '결과와 직무 연결이 명확한가'],
  },
});

export const setQuestionQueue = (items = []) => {
  activeQueue = (Array.isArray(items) ? items : []).map(normalize).filter((item) => item.text).slice(0, 12);
  return activeQueue.length;
};

export const clearQuestionQueue = () => { activeQueue = []; };
export const hasQuestionQueue = () => activeQueue.length > 0;
export const getQuestionQueueLength = () => activeQueue.length;

export const getOpeningQuestion = () => {
  const item = activeQueue[0];
  if (!item) return null;
  return {
    question: item.text,
    intent: item.intent,
    questionMeta: item.meta,
    meta: { provider: 'question-bank', model: 'selected-question-set', videoUsed: false, frameCount: 0 },
  };
};

export const applyQuestionQueueToResponse = (response, questionNumber) => {
  if (!activeQueue.length) return response;
  const next = activeQueue[Math.max(0, Number(questionNumber) || 1)];
  if (!next) return { ...response, nextQuestion: '', nextIntent: '', nextQuestionMeta: null };
  return {
    ...response,
    nextQuestion: next.text,
    nextIntent: next.intent,
    nextQuestionMeta: next.meta,
  };
};
