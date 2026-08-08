import {
  applyQuestionQueueToResponse,
  clearQuestionQueue,
  getOpeningQuestion,
} from '../questionPracticeBridge.js';

const requestJson = async (path, payload) => {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `AI 요청 실패 (${response.status})`);
  return data;
};

const request = (payload) => requestJson('/api/chat', payload);

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

  transcribeAudio({ audioDataUrl, language }) {
    return requestJson('/api/transcribe', { audioDataUrl, language });
  }

  async finishSession({ profile, history, sessionMetrics }) {
    try {
      return await request({ action: 'finish', profile, history, sessionMetrics });
    } finally {
      clearQuestionQueue();
    }
  }
}
