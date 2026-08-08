import { CoachError, createCoachReply, getCoachDiagnostics } from './coach.js';
import { HumanInterviewError, createHumanInterviewAssessment } from './humanInterview.js';
import { PronunciationError, assessEnglishPronunciation } from './pronunciation.js';
import { QuestionBankError, createTailoredQuestions } from './questionBank.js';
import { RequestGuardError, guardRequest } from './requestGuard.js';
import { TranscriptionError, transcribeInterviewAudio } from './transcribe.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=UTF-8', 'cache-control': 'no-store' },
});

const getProviderOptions = (env) => ({
  provider: env.AI_PROVIDER,
  geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
  geminiModel: env.GEMINI_MODEL,
  openaiApiKey: env.OPENAI_API_KEY,
  openaiModel: env.OPENAI_MODEL,
});

const guard = (request, env, body, namespace, limit, maxBytes = 3_900_000) => guardRequest({
  headers: request.headers,
  method: request.method,
  body,
  namespace,
  allowedOrigins: env.ALLOWED_ORIGINS,
  limit,
  maxBytes,
});

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/question-bank') {
      if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);
      try {
        const body = await request.json();
        guard(request, env, body, 'question-bank', 8);
        return json(await createTailoredQuestions(body, {
          geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
          geminiModel: env.GEMINI_MODEL,
        }));
      } catch (error) {
        return json(
          { error: error?.message || '맞춤 질문 생성 중 오류가 발생했습니다.' },
          error instanceof RequestGuardError || error instanceof QuestionBankError ? error.status : 400,
        );
      }
    }

    if (url.pathname === '/api/human-interview') {
      if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);
      try {
        const body = await request.json();
        guard(request, env, body, 'human-interview', 12);
        return json(await createHumanInterviewAssessment(body, {
          geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
          geminiModel: env.GEMINI_MODEL,
        }));
      } catch (error) {
        return json(
          { error: error?.message || '사람면접 평가 처리 중 오류가 발생했습니다.' },
          error instanceof RequestGuardError || error instanceof HumanInterviewError ? error.status : 400,
        );
      }
    }

    if (url.pathname === '/api/transcribe') {
      if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);
      try {
        const body = await request.json();
        guard(request, env, body, 'transcribe', 15);
        return json(await transcribeInterviewAudio(body, {
          geminiApiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY,
          geminiModel: env.GEMINI_MODEL,
        }));
      } catch (error) {
        return json(
          { error: error?.message || '음성 전사 처리 중 오류가 발생했습니다.' },
          error instanceof RequestGuardError || error instanceof TranscriptionError ? error.status : 400,
        );
      }
    }

    if (url.pathname === '/api/pronunciation') {
      if (request.method !== 'POST') return json({ error: 'POST 요청만 허용됩니다.' }, 405);
      try {
        const body = await request.json();
        guard(request, env, body, 'pronunciation', 8);
        return json(await assessEnglishPronunciation(body, {
          azureSpeechKey: env.AZURE_SPEECH_KEY,
          azureSpeechRegion: env.AZURE_SPEECH_REGION,
        }));
      } catch (error) {
        return json(
          { error: error?.message || '발음평가 처리 중 오류가 발생했습니다.' },
          error instanceof RequestGuardError || error instanceof PronunciationError ? error.status : 400,
        );
      }
    }

    if (url.pathname !== '/api/chat') return env.ASSETS.fetch(request);

    if (!['GET', 'POST'].includes(request.method)) return json({ error: 'GET 또는 POST 요청만 허용됩니다.' }, 405);

    try {
      if (request.method === 'GET') {
        guard(request, env, undefined, 'chat-diagnostics', 30);
        const probe = url.searchParams.get('probe') === '1';
        return json(await getCoachDiagnostics(getProviderOptions(env), { probe }));
      }

      const body = await request.json();
      guard(request, env, body, 'chat', 24);
      return json(await createCoachReply(body, getProviderOptions(env)));
    } catch (error) {
      return json(
        { error: error?.message || '면접 코치 처리 중 오류가 발생했습니다.' },
        error instanceof RequestGuardError || error instanceof CoachError ? error.status : 400,
      );
    }
  },
};
