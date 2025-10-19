// api/chat.js  (Vercel Serverless Function - ESM)
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }// src/services/chatgptService.js
// 브라우저에서 OpenAI SDK를 직접 쓰지 않고, 서버의 /api/chat 프록시로 호출
export default class ChatGPTService {
  constructor() {}

  async complete(messages, { system = "", guidance = "" } = {}) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        system: [
          "You are an encouraging ESL teacher.",
          "Keep replies <= 15 words, friendly, specific to the user's last message.",
          "If the user's English is incorrect, continue the conversation normally AND ALSO provide a JSON object named correction with:",
          "{ corrected: '<one natural sentence>', why: '<<=2 lines>', upgrade: '<optional natural phrasing>' }",
          "Lead the conversation; ask short follow-ups so it never gets awkward.",
          "Avoid repeating the same sentence; vary content and ask for one new detail."
        ].join(' '),
        guidance
      })
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      throw new Error('Chat API error: ' + text);
    }
    const data = await res.json();

    const fullText =
      data?.output_text ||
      data?.choices?.[0]?.message?.content ||
      data?.message || '';

    // 선택: 본문에 correction JSON이 포함된 경우 파싱
    let replyText = fullText;
    let correction = null;
    try {
      const m = fullText.match(/\{[\s\S]*\}/);
      if (m) {
        const obj = JSON.parse(m[0]);
        if (obj?.correction || obj?.corrected) {
          correction = obj.correction || {
            corrected: obj.corrected || '',
            why: obj.why || '',
            upgrade: obj.upgrade || ''
          };
          replyText = fullText.replace(m[0], '').trim();
        }
      }
    } catch {}
    return { role: 'assistant', content: replyText || fullText, correction };
  }
}

    const { model = 'gpt-4o-mini', messages = [], system = '', guidance = '' } = req.body || {};
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const payload = {
      model,
      input: [
        ...(system ? [{ role: 'system', content: system + (guidance ? '\n' + guidance : '') }] : []),
        ...messages,
      ],
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
