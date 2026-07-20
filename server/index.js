import { CoachError, createCoachReply } from './coach.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/chat') return env.ASSETS.fetch(request);
    if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);
    try {
      const body = await request.json();
      return json(await createCoachReply(body, {
        provider: env.AI_PROVIDER,
        geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
        geminiModel: env.GEMINI_MODEL,
        openaiApiKey: env.OPENAI_API_KEY,
        openaiModel: env.OPENAI_MODEL,
      }));
    } catch (error) {
      return json({ error: error?.message || '면접 코치 처리 중 오류가 발생했습니다.' }, error instanceof CoachError ? error.status : 400);
    }
  },
};
