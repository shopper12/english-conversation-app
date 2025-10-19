// OpenAI API 설정
export const OPENAI_CONFIG = {
  // 여기에 OpenAI API 키를 입력하세요
  apiKey: import.meta.env.VITE_OPENAI_API_KEY || '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',
  model: import.meta.env.VITE_OPENAI_MODEL || 'gpt-3.5-turbo',
  maxTokens: 150,
  temperature: 0.7
};

// 나노바나나 캐릭터 설정
export const NANOBANA_PERSONALITY = {
  name: "Nanobana",
  role: "English conversation teacher and friend",
  personality: "Friendly, encouraging, patient, and enthusiastic about helping with English conversation practice",
  speaking_style: "Casual, warm, and supportive with occasional emojis",
  expertise: "English conversation, grammar correction, and cultural exchange"
};
