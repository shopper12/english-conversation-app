// src/services/chatgptService.js
export default class ChatGPTService {
  async complete(messages, { system = "", guidance = "" } = {}) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages, system, guidance })
    });
    if (!res.ok) {
      const text = await res.text().catch(()=> '');
      throw new Error('Chat API error: ' + text);
    }
    const data = await res.json();

    // Chat Completions 기본 파싱
    const fullText =
      data?.choices?.[0]?.message?.content ||
      data?.message || '';

    // 본문 안에 correction JSON이 섞여 오면 추출
    let replyText = fullText;
    let correction = null;
    try {
      const m = fullText.match(/\{[\s\S]*\}/); // 첫 번째 JSON 블록
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
    } catch {/* JSON 없으면 무시 */}
    return { role: 'assistant', content: replyText || fullText, correction };
  }
}
