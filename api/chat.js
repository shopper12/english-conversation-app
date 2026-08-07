import { CoachError, createCoachReply, getCoachDiagnostics } from '../server/coach.js';

const getProviderOptions = () => ({
  provider: process.env.AI_PROVIDER,
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
  geminiModel: process.env.GEMINI_MODEL,
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL,
});

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const probe = String(req.query?.probe || '') === '1';
    return res.status(200).json(await getCoachDiagnostics(getProviderOptions(), { probe }));
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'GET 또는 POST 요청만 허용됩니다.' });
  }

  try {
    const result = await createCoachReply(req.body || {}, getProviderOptions());
    return res.status(200).json(result);
  } catch (error) {
    return res.status(error instanceof CoachError ? error.status : 500).json({
      error: error?.message || '면접 코치 처리 중 오류가 발생했습니다.',
    });
  }
}
