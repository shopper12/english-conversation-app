// api/chat.js  (Vercel Serverless Function)
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const { model = 'gpt-4o-mini', messages = [], system = '', guidance = '' } = req.body || {};
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    // Responses API 스타일 (권장)
    const payload = {
      model,
      input: [
        ...(system ? [{ role: 'system', content: system + (guidance ? '\n' + guidance : '') }] : []),
        ...messages,
      ],
      // 교정 JSON을 깔끔히 받기 위한 힌트(모델 지시 강화)
      text_format: { type: "json", schema: {
        type: "object",
        properties: {
          reply: { type: "string" },
          correction: {
            type: "object",
            properties: {
              corrected: { type: "string" },
              why: { type: "string" },
              upgrade: { type: "string" }
            }
          }
        }
      }},
      // 단, 일부 모델에서는 위 옵션 미지원일 수 있어 아래 system 지시로 보강
    };

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const t = await r.text().catch(()=> '');
      return res.status(r.status).send(t || 'OpenAI error');
    }
    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
