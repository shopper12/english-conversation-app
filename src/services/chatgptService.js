import OpenAI from 'openai';
import { OPENAI_CONFIG, NANOBANA_PERSONALITY } from '../config.js';

class ChatGPTService {
  constructor() {
    console.log('ChatGPT Service initializing with API key:', OPENAI_CONFIG.apiKey ? 'Present' : 'Missing');
    this.openai = new OpenAI({
      apiKey: OPENAI_CONFIG.apiKey,
      dangerouslyAllowBrowser: true // 브라우저에서 사용하기 위한 설정
    });
    this.conversationHistory = [];
  }

  // 대화 히스토리 초기화
  resetConversation() {
    this.conversationHistory = [];
  }

  // 나노바나나의 시스템 프롬프트 생성
  getSystemPrompt() {
    return `You are ${NANOBANA_PERSONALITY.name}, a friendly and enthusiastic English conversation teacher. 

Your personality: ${NANOBANA_PERSONALITY.personality}
Your speaking style: ${NANOBANA_PERSONALITY.speaking_style}
Your expertise: ${NANOBANA_PERSONALITY.expertise}

Instructions:
1. Always respond in English as a native speaker would
2. Be encouraging and supportive, especially when correcting mistakes
3. Keep responses conversational and natural (not robotic)
4. Ask follow-up questions to keep the conversation flowing
5. If the user makes grammar mistakes, gently correct them in a helpful way
6. Use casual, friendly language with occasional emojis
7. Keep responses concise but engaging (1-2 sentences typically)
8. Remember previous parts of the conversation to maintain context
9. If the user switches topics, go with the flow naturally
10. Always end with a question or invitation to continue the conversation

Current conversation topic: ${this.conversationHistory.length > 0 ? 'Continue the current conversation' : 'Start a new conversation about any topic the user is interested in'}`;
  }

  // 대화 메시지 생성
  async generateResponse(userMessage, topic = 'general') {
    try {
      console.log('Generating response for:', userMessage);
      
      // 사용자 메시지를 대화 히스토리에 추가
      this.conversationHistory.push({
        role: 'user',
        content: userMessage
      });

      // 시스템 프롬프트와 대화 히스토리 준비
      const messages = [
        {
          role: 'system',
          content: this.getSystemPrompt()
        },
        ...this.conversationHistory.slice(-10) // 최근 10개 메시지만 유지
      ];

      console.log('Sending to OpenAI API...');
      
      // OpenAI API 호출
      const completion = await this.openai.chat.completions.create({
        model: OPENAI_CONFIG.model,
        messages: messages,
        max_tokens: OPENAI_CONFIG.maxTokens,
        temperature: OPENAI_CONFIG.temperature,
        presence_penalty: 0.6,
        frequency_penalty: 0.3
      });

      const assistantMessage = completion.choices[0].message.content;
      console.log('Received response:', assistantMessage);

      // 나노바나나의 응답을 대화 히스토리에 추가
      this.conversationHistory.push({
        role: 'assistant',
        content: assistantMessage
      });

      return assistantMessage;

    } catch (error) {
      console.error('ChatGPT API Error:', error);
      
      // API 오류 시 폴백 응답
      const fallbackResponses = [
        "I'm having a little trouble connecting right now, but I'm still here to chat! What would you like to talk about?",
        "Oops! There seems to be a technical hiccup, but don't worry - I'm still listening! Tell me more about what you were saying.",
        "I'm experiencing some connection issues, but I'm excited to continue our conversation! What's on your mind?",
        "Sorry about that technical glitch! I'm back and ready to chat. What would you like to discuss?"
      ];
      
      return fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
    }
  }

  // 문법 검사 및 교정
  async checkGrammar(text) {
    try {
      const prompt = `Please check the following English text for grammar, spelling, and naturalness. 
      If there are any errors, provide the corrected version. 
      If the text is already correct, just say "No corrections needed."
      
      Text: "${text}"
      
      Format your response as:
      Corrected: [corrected text if needed]
      Explanation: [brief explanation of changes if any]`;

      const completion = await this.openai.chat.completions.create({
        model: OPENAI_CONFIG.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert English grammar checker. Provide clear, helpful corrections and explanations.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 100,
        temperature: 0.3
      });

      const response = completion.choices[0].message.content;
      
      // 응답 파싱
      const correctedMatch = response.match(/Corrected:\s*(.+)/);
      const explanationMatch = response.match(/Explanation:\s*(.+)/);
      
      if (correctedMatch && correctedMatch[1].trim() !== text) {
        return {
          corrected: correctedMatch[1].trim(),
          explanation: explanationMatch ? explanationMatch[1].trim() : 'Grammar correction applied',
          hasCorrection: true
        };
      }
      
      return {
        corrected: text,
        explanation: 'No corrections needed',
        hasCorrection: false
      };

    } catch (error) {
      console.error('Grammar check error:', error);
      return {
        corrected: text,
        explanation: 'Unable to check grammar at the moment',
        hasCorrection: false
      };
    }
  }

  // 대화 주제 변경
  changeTopic(topic) {
    const topicPrompts = {
      'daily-life': "Let's talk about daily life and routines. Ask about their typical day, morning routine, or weekend activities.",
      'food': "Let's discuss food and cooking. Ask about their favorite meals, cooking preferences, or restaurant experiences.",
      'travel': "Let's chat about travel and places. Ask about their dream destinations, past trips, or travel preferences.",
      'work': "Let's talk about work and career. Ask about their job, career goals, or work experiences.",
      'hobbies': "Let's discuss hobbies and interests. Ask about what they do for fun, their passions, or free time activities.",
      'general': "Let's have a general conversation. Ask about anything they're interested in or what's on their mind."
    };

    const topicPrompt = topicPrompts[topic] || topicPrompts['general'];
    
    // 주제 변경을 대화 히스토리에 추가
    this.conversationHistory.push({
      role: 'system',
      content: `Topic changed to: ${topic}. ${topicPrompt}`
    });
  }
}

export default ChatGPTService;
