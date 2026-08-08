import { HumanInterviewError, createHumanInterviewAssessment } from '../server/humanInterview.js';
import { RequestGuardError, guardRequest } from '../server/requestGuard.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST 요청만 허용됩니다.' });
  }

  try {
    guardRequest({
      headers: req.headers,
      method: req.method,
      body: req.body,
      namespace: 'human-interview',
      allowedOrigins: process.env.ALLOWED_ORIGINS,
      limit: 12,
      maxBytes: 3_900_000,
    });
    const result = await createHumanInterviewAssessment(req.body || {}, {
      geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      geminiModel: process.env.GEMINI_MODEL,
    });
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof RequestGuardError || error instanceof HumanInterviewError ? error.status : 500;
    return res.status(status).json({
      error: error?.message || '사람면접 평가 처리 중 오류가 발생했습니다.',
    });
  }
}
