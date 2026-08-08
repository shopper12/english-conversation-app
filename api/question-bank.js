import { QuestionBankError, createTailoredQuestions } from '../server/questionBank.js';
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
      namespace: 'question-bank',
      allowedOrigins: process.env.ALLOWED_ORIGINS,
      limit: 8,
      maxBytes: 3_900_000,
    });
    const result = await createTailoredQuestions(req.body || {}, {
      geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
      geminiModel: process.env.GEMINI_MODEL,
    });
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof RequestGuardError || error instanceof QuestionBankError ? error.status : 500;
    return res.status(status).json({
      error: error?.message || '맞춤 질문 생성 중 오류가 발생했습니다.',
    });
  }
}
