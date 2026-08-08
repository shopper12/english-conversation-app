import { PronunciationError, assessEnglishPronunciation } from '../server/pronunciation.js';
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
      namespace: 'pronunciation',
      allowedOrigins: process.env.ALLOWED_ORIGINS,
      limit: 8,
      maxBytes: 3_900_000,
    });
    const result = await assessEnglishPronunciation(req.body || {}, {
      azureSpeechKey: process.env.AZURE_SPEECH_KEY,
      azureSpeechRegion: process.env.AZURE_SPEECH_REGION,
    });
    return res.status(200).json(result);
  } catch (error) {
    const status = error instanceof RequestGuardError || error instanceof PronunciationError ? error.status : 500;
    return res.status(status).json({ error: error?.message || '발음평가 처리 중 오류가 발생했습니다.' });
  }
}
