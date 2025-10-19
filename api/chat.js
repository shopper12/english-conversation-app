// api/chat.js  (Vercel Serverless Function - ESM)
export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { model = 'gpt-4o-mini', messages = [], system = '', guidance = '' } = req.body || {};
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Missing OPENAI_API_KEY' });

    const sys = [
      "You are an encouraging ESL teacher.",
      "Keep replies <= 15 words.",
      "Continue the conversation even if the user makes mistakes.",
      "When the user's English is incorrect, still reply naturally AND ALSO include a JSON object named correction: { corrected, why, upgrade }.",
      "Lead with short follow-up questions so conversation never gets awkward.",
      "Never repeat the exact same sentence; vary content and ask for one new detail each turn."
    ].join(' ')
      + (system ? (' ' + system) : '')
      + (guidance ? (' ' + guidance) : '');

    const payload = {
      model,
      messages: [
        { role: 'system', content: sys },
        ...messages
      ],
      temperature: 0.6,
      max_tokens: 200
    };

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
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
    const data = await r.json(); // {choices:[{message:{content}}]...}
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
