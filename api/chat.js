import { CoachError, createCoachReply, getCoachDiagnostics } from '../server/coach.js';
import { RequestGuardError, guardRequest } from '../server/requestGuard.js';

const getProviderOptions = () => ({
  provider: process.env.AI_PROVIDER,
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  geminiModel: process.env.GEMINI_MODEL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL,
});

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET 또는 POST 요청만 허용됩니다.' });
  }

  try {
    guardRequest({
      headers: req.headers,
      method: req.method,
      body: req.method === 'POST' ? req.body : undefined,
      namespace: req.method === 'GET' ? 'chat-diagnostics' : 'chat',
      allowedOrigins: process.env.ALLOWED_ORIGINS,
      limit: req.method === 'GET' ? 30 : 24,
      maxBytes: 3_900_000,
    });

    if (req.method === 'GET') {
      const probe = String(req.query?.probe || '') === '1';
      return res.status(200).json(await getCoachDiagnostics(getProviderOptions(), { probe }));
    }

    const result = await createCoachReply(req.body || {}, getProviderOptions());
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof RequestGuardError || error instanceof CoachError ? error.status : 500;
    return res.status(status).json({
      error: error?.message || '면접 코치 처리 중 오류가 발생했습니다.',
    });
  }
}
