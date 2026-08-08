import {
  applyQuestionQueueToResponse,
  clearQuestionQueue,
  getOpeningQuestion,
} from '../questionPracticeBridge.js';

const request = async (payload) => {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `AI 요청 실패 (${response.status})`);
  return data;
};

export default class InterviewCoachService {
  startSession(profile) {
    const selectedOpening = getOpeningQuestion();
    if (selectedOpening) return Promise.resolve(selectedOpening);
    return request({ action: 'start', profile });
  }

  async evaluateAnswer({
    profile, question, questionIntent, questionMeta, transcript, history, telemetry,
    questionNumber, totalQuestions, visionFrames, videoSample,
  }) {
    const response = await request({
      action: 'answer',
      profile,
      question,
      questionIntent,
      questionMeta,
      transcript,
      history,
      telemetry,
      questionNumber,
      totalQuestions,
      visionFrames,
      videoSample,
    });
    return applyQuestionQueueToResponse(response, questionNumber);
  }

  async finishSession({ profile, history, sessionMetrics }) {
    try {
      return await request({ action: 'finish', profile, history, sessionMetrics });
    } finally {
      clearQuestionQueue();
    }
  }
}
