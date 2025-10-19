// src/services/chatgptService.js
// 클라이언트에서 OpenAI SDK를 직접 쓰지 않고, 서버의 /api/chat 프록시를 호출
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
          "If the user's English is incorrect, continue normally AND ALSO provide JSON 'correction' with {corrected, why, upgrade}.",
          "Lead the conversation; ask short follow-ups; avoid repeating the same sentence."
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

    // (옵션) 본문에 correction JSON이 같이 오면 파싱
    let replyText = fullText, correction = null;
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
