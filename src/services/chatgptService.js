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
    return request({ action: 'start', profile });
  }

  evaluateAnswer({ profile, transcript, history, telemetry, questionNumber, totalQuestions, visionFrames, videoSample }) {
    return request({
      action: 'answer', profile, transcript, history, telemetry,
      questionNumber, totalQuestions, visionFrames, videoSample,
    });
  }

  finishSession({ profile, history, sessionMetrics }) {
    return request({ action: 'finish', profile, history, sessionMetrics });
  }
}
