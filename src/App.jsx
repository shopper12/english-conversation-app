import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, Volume2, VolumeX, RotateCcw, Settings } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import ChatGPTService from './services/chatgptService'; 
const svc = new ChatGPTService();


const App = () => {
  const [messages, setMessages] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isNanobanaSpeaking, setIsNanobanaSpeaking] = useState(false);
  const [userInput, setUserInput] = useState('');
  const [corrections, setCorrections] = useState({});
  const [isProcessing, setIsProcessing] = useState(false);
  const [conversationTopic, setConversationTopic] = useState('general');
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [isApiConfigured, setIsApiConfigured] = useState(false);

// Teacher video
const [videoUrl, setVideoUrl] = useState(localStorage.getItem('teacher_video_url') || '');
const [showVideo, setShowVideo] = useState(localStorage.getItem('teacher_video_show') === 'true');
const [isVideoMuted, setIsVideoMuted] = useState(true);

  
  const recognitionRef = useRef(null);
  const synthesisRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatGPTService = useRef(null);

  // API 키 확인 및 ChatGPT 서비스 초기화
  useEffect(() => {
    const savedApiKey = localStorage.getItem('openai_api_key');
    if (savedApiKey) {
      setApiKey(savedApiKey);
    }
    // 기본 API 키가 설정되어 있으면 자동으로 초기화
    chatGPTService.current = new ChatGPTService();
    setIsApiConfigured(true);
  }, []);

  // 음성 인식 초기화
  useEffect(() => {
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognitionRef.current = new SpeechRecognition();
      recognitionRef.current.continuous = false;
      recognitionRef.current.interimResults = true;  // 중간 결과도 받아서 더 정확하게
      recognitionRef.current.lang = 'en-US';
      recognitionRef.current.maxAlternatives = 3;     // 여러 후보 중 최적의 결과 선택

      recognitionRef.current.onresult = (event) => {
        let finalTranscript = '';
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        
        // 최종 결과가 있으면 처리
        if (finalTranscript) {
          // 발음 개선을 위한 후처리
          let processedTranscript = finalTranscript
            .toLowerCase()
            .replace(/\b(i am|i'm)\b/g, 'I am')
            .replace(/\b(you are|you're)\b/g, 'you are')
            .replace(/\b(he is|he's)\b/g, 'he is')
            .replace(/\b(she is|she's)\b/g, 'she is')
            .replace(/\b(we are|we're)\b/g, 'we are')
            .replace(/\b(they are|they're)\b/g, 'they are')
            .replace(/\b(it is|it's)\b/g, 'it is')
            .replace(/\b(that is|that's)\b/g, 'that is')
            .replace(/\b(what is|what's)\b/g, 'what is')
            .replace(/\b(where is|where's)\b/g, 'where is')
            .replace(/\b(how is|how's)\b/g, 'how is')
            .replace(/\b(there is|there's)\b/g, 'there is')
            .replace(/\b(here is|here's)\b/g, 'here is')
            .replace(/\b(do not|don't)\b/g, 'do not')
            .replace(/\b(cannot|can't)\b/g, 'cannot')
            .replace(/\b(will not|won't)\b/g, 'will not')
            .replace(/\b(let us|let's)\b/g, 'let us')
            .replace(/\b(i will|i'll)\b/g, 'I will')
            .replace(/\b(you will|you'll)\b/g, 'you will')
            .replace(/\b(we will|we'll)\b/g, 'we will')
            .replace(/\b(they will|they'll)\b/g, 'they will')
            .replace(/\b(he will|he'll)\b/g, 'he will')
            .replace(/\b(she will|she'll)\b/g, 'she will')
            .replace(/\b(i have|i've)\b/g, 'I have')
            .replace(/\b(you have|you've)\b/g, 'you have')
            .replace(/\b(we have|we've)\b/g, 'we have')
            .replace(/\b(they have|they've)\b/g, 'they have')
            .replace(/\b(i would|i'd)\b/g, 'I would')
            .replace(/\b(you would|you'd)\b/g, 'you would')
            .replace(/\b(we would|we'd)\b/g, 'we would')
            .replace(/\b(they would|they'd)\b/g, 'they would')
            .replace(/\b(he would|he'd)\b/g, 'he would')
            .replace(/\b(she would|she'd)\b/g, 'she would');
          
          // 첫 글자 대문자로
          processedTranscript = processedTranscript.charAt(0).toUpperCase() + processedTranscript.slice(1);
          
          setUserInput(processedTranscript);
          handleUserMessage(processedTranscript);
        } else if (interimTranscript) {
          // 중간 결과를 입력창에 표시
          setUserInput(interimTranscript);
        }
      };

      recognitionRef.current.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
        setUserInput('');
      };

      recognitionRef.current.onend = () => {
        setIsRecording(false);
      };
    }

    // 음성 합성 초기화
    if ('speechSynthesis' in window) {
      synthesisRef.current = window.speechSynthesis;
    }

    // 첫 번째 나노바나나 메시지 (한 번만 실행)
    if (messages.length === 0) {
      setTimeout(() => {
        console.log('Sending first message...');
        console.log('API configured:', isApiConfigured);
        console.log('ChatGPT service:', chatGPTService.current);
        
        if (isApiConfigured && chatGPTService.current) {
          // ChatGPT를 사용한 첫 메시지
          chatGPTService.current.generateResponse("Hello, let's start a conversation!")
            .then(response => {
              console.log('First message response:', response);
              addNanobanaMessage(response);
            })
            .catch((error) => {
              console.error('ChatGPT API error:', error);
              // API 오류 시 폴백 메시지
              addNanobanaMessage("Hey there! I'm Nanobana, your English conversation buddy! 🍌 I'm so excited to chat with you today. What would you like to talk about?");
            });
        } else {
          // API가 설정되지 않은 경우 폴백 메시지
          addNanobanaMessage("Hey there! I'm Nanobana, your English conversation buddy! 🍌 I'm so excited to chat with you today. What would you like to talk about?");
        }
      }, 1000);
    }
  }, [isApiConfigured, messages.length]);

  // 메시지 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addNanobanaMessage = (text, shouldSpeak = true) => {
    const newMessage = {
      id: Date.now(),
      text,
      sender: 'nanobana',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
    
    if (shouldSpeak) {
      speakText(text);
    }
  };

  const addUserMessage = (text) => {
    const newMessage = {
      id: Date.now(),
      text,
      sender: 'user',
      timestamp: new Date()
    };
    setMessages(prev => [...prev, newMessage]);
  };

  const speakText = (text) => {
    if (synthesisRef.current) {
      setIsNanobanaSpeaking(true);
      
      // 원어민 음성 찾기
      const voices = synthesisRef.current.getVoices();
      let nativeVoice = voices.find(voice => 
        voice.lang.startsWith('en') && 
        (voice.name.includes('Google') || 
         voice.name.includes('Microsoft') ||
         voice.name.includes('Alex') ||
         voice.name.includes('Samantha') ||
         voice.name.includes('Daniel') ||
         voice.name.includes('Karen') ||
         voice.name.includes('Moira'))
      );
      
      // 원어민 음성을 찾지 못한 경우 영어 음성 중 가장 자연스러운 것 선택
      if (!nativeVoice) {
        nativeVoice = voices.find(voice => 
          voice.lang.startsWith('en-US') || voice.lang.startsWith('en-GB')
        );
      }
      
      const utterance = new SpeechSynthesisUtterance(text);
      
      // 원어민 음성 설정
      if (nativeVoice) {
        utterance.voice = nativeVoice;
      }
      
      // 자연스러운 발음 설정
      utterance.rate = 0.85;        // 약간 빠른 속도 (원어민 수준)
      utterance.pitch = 1.0;        // 자연스러운 음높이
      utterance.volume = 0.9;       // 적절한 볼륨
      utterance.lang = 'en-US';     // 미국 영어 발음
      
      // 발음 개선을 위한 텍스트 전처리
      let processedText = text
        .replace(/I'm/g, 'I am')           // 축약형을 풀어서 발음
        .replace(/don't/g, 'do not')       // 축약형을 풀어서 발음
        .replace(/can't/g, 'cannot')       // 축약형을 풀어서 발음
        .replace(/won't/g, 'will not')     // 축약형을 풀어서 발음
        .replace(/it's/g, 'it is')         // 축약형을 풀어서 발음
        .replace(/that's/g, 'that is')     // 축약형을 풀어서 발음
        .replace(/what's/g, 'what is')     // 축약형을 풀어서 발음
        .replace(/where's/g, 'where is')   // 축약형을 풀어서 발음
        .replace(/how's/g, 'how is')      // 축약형을 풀어서 발음
        .replace(/there's/g, 'there is')  // 축약형을 풀어서 발음
        .replace(/here's/g, 'here is')    // 축약형을 풀어서 발음
        .replace(/you're/g, 'you are')    // 축약형을 풀어서 발음
        .replace(/we're/g, 'we are')      // 축약형을 풀어서 발음
        .replace(/they're/g, 'they are')  // 축약형을 풀어서 발음
        .replace(/he's/g, 'he is')        // 축약형을 풀어서 발음
        .replace(/she's/g, 'she is')      // 축약형을 풀어서 발음
        .replace(/let's/g, 'let us')      // 축약형을 풀어서 발음
        .replace(/I'll/g, 'I will')       // 축약형을 풀어서 발음
        .replace(/you'll/g, 'you will')   // 축약형을 풀어서 발음
        .replace(/we'll/g, 'we will')     // 축약형을 풀어서 발음
        .replace(/they'll/g, 'they will') // 축약형을 풀어서 발음
        .replace(/he'll/g, 'he will')     // 축약형을 풀어서 발음
        .replace(/she'll/g, 'she will')   // 축약형을 풀어서 발음
        .replace(/I've/g, 'I have')       // 축약형을 풀어서 발음
        .replace(/you've/g, 'you have')   // 축약형을 풀어서 발음
        .replace(/we've/g, 'we have')     // 축약형을 풀어서 발음
        .replace(/they've/g, 'they have') // 축약형을 풀어서 발음
        .replace(/I'd/g, 'I would')       // 축약형을 풀어서 발음
        .replace(/you'd/g, 'you would')   // 축약형을 풀어서 발음
        .replace(/we'd/g, 'we would')     // 축약형을 풀어서 발음
        .replace(/they'd/g, 'they would') // 축약형을 풀어서 발음
        .replace(/he'd/g, 'he would')     // 축약형을 풀어서 발음
        .replace(/she'd/g, 'she would');  // 축약형을 풀어서 발음
      
      utterance.text = processedText;
      
      utterance.onend = () => {
        setIsNanobanaSpeaking(false);
      };
      
      utterance.onerror = (event) => {
        console.error('Speech synthesis error:', event.error);
        setIsNanobanaSpeaking(false);
      };
      
      synthesisRef.current.speak(utterance);
    }
  };

  const checkGrammar = (text) => {
    // 간단한 문법 검사 (실제로는 더 정교한 API를 사용할 수 있음)
    const commonMistakes = {
      'i am': 'I am',
      'i like': 'I like',
      'i want': 'I want',
      'i have': 'I have',
      'i can': 'I can',
      'i will': 'I will',
      'i was': 'I was',
      'i were': 'I was',
      'i go': 'I go',
      'i went': 'I went'
    };

    let correctedText = text;
    let hasCorrection = false;

    Object.keys(commonMistakes).forEach(mistake => {
      if (correctedText.toLowerCase().includes(mistake)) {
        correctedText = correctedText.replace(new RegExp(mistake, 'gi'), commonMistakes[mistake]);
        hasCorrection = true;
      }
    });

    return { correctedText, hasCorrection };
  };

  const handleUserMessage = async (text) => {
    console.log('Handling user message:', text);
    console.log('API configured:', isApiConfigured);
    console.log('ChatGPT service:', chatGPTService.current);

const sys = topic?.system || "";  // 네가 쓰는 시스템 프롬프트가 있으면 그대로 사용
const guidance = "Avoid repeating previous assistant sentence. Ask a new short follow-up.";

let reply = await svc.complete(nextMessagesArray, { system: sys, guidance });
// reply: { role:'assistant', content:'...', correction?:{...} }
setMessages(m => [...m, reply]);

{m.role === 'assistant' && m.correction && (
  <div className="mt-2 max-w-[75%] rounded-xl border bg-gray-50 p-3 text-xs text-gray-800">
    <div><span className="font-semibold">Corrected:</span> {m.correction.corrected}</div>
    {m.correction.why && <div className="mt-1"><span className="font-semibold">Why:</span> {m.correction.why}</div>}
    {m.correction.upgrade && <div className="mt-1"><span className="font-semibold">Upgrade:</span> {m.correction.upgrade}</div>}
  </div>
)}

    
    setIsProcessing(true);
    
    // 사용자 메시지 추가
    addUserMessage(text);
    
    // ChatGPT API를 사용한 문법 검사
    if (isApiConfigured && chatGPTService.current) {
      try {
        const grammarResult = await chatGPTService.current.checkGrammar(text);
        
        if (grammarResult.hasCorrection) {
          setCorrections(prev => ({
            ...prev,
            [Date.now()]: {
              original: text,
              corrected: grammarResult.corrected,
              explanation: grammarResult.explanation
            }
          }));
        }
      } catch (error) {
        console.error('Grammar check error:', error);
        // 폴백 문법 검사
        const { correctedText, hasCorrection } = checkGrammar(text);
        if (hasCorrection) {
          setCorrections(prev => ({
            ...prev,
            [Date.now()]: {
              original: text,
              corrected: correctedText
            }
          }));
        }
      }
    } else {
      // API가 설정되지 않은 경우 기본 문법 검사
      const { correctedText, hasCorrection } = checkGrammar(text);
      if (hasCorrection) {
        setCorrections(prev => ({
          ...prev,
          [Date.now()]: {
            original: text,
            corrected: correctedText
          }
        }));
      }
    }

    // ChatGPT API를 사용한 응답 생성
    if (isApiConfigured && chatGPTService.current) {
      try {
        console.log('Using ChatGPT API for response...');
        const response = await chatGPTService.current.generateResponse(text, conversationTopic);
        addNanobanaMessage(response);
      } catch (error) {
        console.error('ChatGPT API error:', error);
        // API 오류 시 폴백 응답
        const fallbackResponse = generateNanobanaResponse(text, conversationTopic);
        addNanobanaMessage(fallbackResponse);
      }
    } else {
      console.log('Using fallback response...');
      // API가 설정되지 않은 경우 폴백 응답
      const fallbackResponse = generateNanobanaResponse(text, conversationTopic);
      addNanobanaMessage(fallbackResponse);
    }
    
    setIsProcessing(false);
  };

  const generateNanobanaResponse = (userText, topic) => {
    const responses = {
      'greeting': [
        "Hey there! It's great to meet you! How are you doing today?",
        "Hi! Welcome! I'm really excited to chat with you. How's your day going?",
        "Hello! Nice to see you here! What brings you to our conversation today?",
        "Hey! I'm Nanobana, your English buddy! How are you feeling today?"
      ],
      'daily-life': [
        "That's really cool! I'd love to hear more about your typical day. What time do you usually start your morning?",
        "Interesting! Tell me about your weekend routine. Do you have any special activities you enjoy?",
        "That sounds awesome! What hobbies do you have? I'm curious about what you do for fun!",
        "Nice! I'm interested in learning about your daily schedule. What's your favorite part of the day?"
      ],
      'food': [
        "Oh, I absolutely love talking about food! What's your go-to cuisine when you're hungry?",
        "That sounds absolutely delicious! Do you enjoy cooking at home or do you prefer eating out?",
        "Food is one of my favorite topics! Tell me about the best meal you've had recently.",
        "Yummy! I'm curious about your food preferences. What's your comfort food?"
      ],
      'travel': [
        "Traveling is such an amazing experience! If you could go anywhere in the world, where would you choose?",
        "That's so exciting! What's the most memorable place you've ever visited?",
        "I love hearing travel stories! Tell me about your dream destination.",
        "Awesome! What kind of places do you enjoy visiting? Are you more into cities or nature?"
      ],
      'work': [
        "Work life can be quite interesting! What do you find most rewarding about your job?",
        "That sounds like a fascinating career! How long have you been in this field?",
        "Work-life balance is so important! What do you do to unwind after a busy day?",
        "Interesting! What's the best part about your work environment?"
      ]
    };

    const topicResponses = responses[topic] || responses['daily-life'];
    return topicResponses[Math.floor(Math.random() * topicResponses.length)];
  };

  const startRecording = () => {
    if (recognitionRef.current && !isRecording) {
      setIsRecording(true);
      recognitionRef.current.start();
    }
  };

  const stopRecording = () => {
    if (recognitionRef.current && isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    }
  };

  const resetConversation = () => {
    setMessages([]);
    setCorrections({});
    setUserInput('');
    
    // ChatGPT 서비스의 대화 히스토리도 리셋
    if (chatGPTService.current) {
      chatGPTService.current.resetConversation();
    }
    
    setTimeout(() => {
      if (isApiConfigured && chatGPTService.current) {
        chatGPTService.current.generateResponse("Let's start a fresh conversation!")
          .then(response => {
            addNanobanaMessage(response);
          })
          .catch(() => {
            addNanobanaMessage("Perfect! Let's start fresh! I'm ready for a new conversation. What topic interests you today?");
          });
      } else {
        addNanobanaMessage("Perfect! Let's start fresh! I'm ready for a new conversation. What topic interests you today?");
      }
    }, 500);
  };

  const changeTopic = (topic) => {
    setConversationTopic(topic);
    
    // ChatGPT 서비스에 주제 변경 알림
    if (chatGPTService.current) {
      chatGPTService.current.changeTopic(topic);
    }
    
    const topicMessages = {
      'daily-life': "Awesome! I'd love to chat about your daily routine. What time do you usually start your day?",
      'food': "Perfect! Food is one of my favorite topics! What's your go-to meal when you're hungry?",
      'travel': "Fantastic! I'm so excited to talk about travel! If you could visit anywhere in the world, where would you go?",
      'work': "Great choice! I'm curious about your career. What do you do for work, and what do you enjoy most about it?",
      'hobbies': "Excellent! I love talking about hobbies and interests! What do you enjoy doing in your free time?",
      'general': "Great! Let's have a general conversation. What's on your mind today?"
    };
    addNanobanaMessage(topicMessages[topic]);
  };

  // API 키 설정
  const handleApiKeySubmit = (e) => {
    e.preventDefault();
    if (apiKey.trim()) {
      localStorage.setItem('openai_api_key', apiKey);
localStorage.setItem('teacher_video_url', videoUrl || '');
localStorage.setItem('teacher_video_show', String(showVideo));

      chatGPTService.current = new ChatGPTService();
      setIsApiConfigured(true);
      setShowSettings(false);
      // 설정 후 첫 메시지 생성
      setTimeout(() => {
        chatGPTService.current.generateResponse("Hello, let's start a conversation!")
          .then(response => {
            addNanobanaMessage(response);
          })
          .catch(() => {
            addNanobanaMessage("Hey there! I'm Nanobana, your English conversation buddy! 🍌 I'm so excited to chat with you today. What would you like to talk about?");
          });
      }, 500);
    }
  };

  return (
    <div className="app-container">
      <header className="header">
        <h1>🍌 English Conversation with Nanobana</h1>
        <button 
          className="settings-button"
          onClick={() => setShowSettings(true)}
          title="Settings"
        >
          <Settings size={20} />
        </button>
      </header>

      {/* Teacher video (iframe or <video>) */}
<div className="teacher-video-wrapper">
  {showVideo && videoUrl ? (
    // 👉 외부 사이트(예: D-ID, HeyGen, YouTube Embed, Loom 등)에서 제공한 "임베드 URL"을 사용
    <div className="aspect-video w-full rounded-xl overflow-hidden border bg-black">
      <iframe
        src={videoUrl}
        title="Teacher Video"
        className="w-full h-full"
        allow="autoplay; encrypted-media; microphone; camera; fullscreen; picture-in-picture"
        allowFullScreen
      />
    </div>
  ) : (
    // ➜ 영상이 없을 때는 기존 아바타
    <motion.div 
      className={`nanobana-avatar ${isNanobanaSpeaking ? 'nanobana-speaking' : ''}`}
      animate={{ 
        scale: isNanobanaSpeaking ? 1.1 : 1,
        rotate: isNanobanaSpeaking ? [0, 5, -5, 0] : 0
      }}
      transition={{ duration: 0.5 }}
    >
      🍌
    </motion.div>
  )}
</div>

<div className="nanobana-status">
  {isNanobanaSpeaking ? "Teacher is speaking..." : 
   isProcessing ? "Thinking..." : 
   "Listening"}
</div>


          <div className="controls">
            <button 
              className="control-button"
              onClick={() => changeTopic('general')}
            >
              General
            </button>
            <button 
              className="control-button"
              onClick={() => changeTopic('daily-life')}
            >
              Daily Life
            </button>
            <button 
              className="control-button"
              onClick={() => changeTopic('food')}
            >
              Food
            </button>
            <button 
              className="control-button"
              onClick={() => changeTopic('travel')}
            >
              Travel
            </button>
            <button 
              className="control-button"
              onClick={() => changeTopic('work')}
            >
              Work
            </button>
            <button 
              className="control-button"
              onClick={() => changeTopic('hobbies')}
            >
              Hobbies
            </button>
          </div>
        </div>

<div className="controls-row">
  <button
    className="control-button"
    onClick={() => setShowVideo(s => {
      localStorage.setItem('teacher_video_show', String(!s));
      return !s;
    })}
  >
    {showVideo ? 'Hide Video' : 'Show Video'}
  </button>

  <button
    className="control-button"
    onClick={() => setIsVideoMuted(m => !m)}
    title={isVideoMuted ? 'Unmute video (if supported)' : 'Mute video'}
  >
    {isVideoMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
    {isVideoMuted ? 'Mute' : 'Unmute'}
  </button>
</div>


        <div className="conversation-section">
          <div className="conversation-area">
            <AnimatePresence>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  className={`message ${message.sender}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  transition={{ duration: 0.3 }}
                >
                  {message.text}
                  
                  {corrections[message.id] && (
                    <div className="correction">
                      <span className="correction-label">💡 Correction:</span>
                      {corrections[message.id].corrected}
                      {corrections[message.id].explanation && (
                        <div className="correction-explanation">
                          <strong>Explanation:</strong> {corrections[message.id].explanation}
                        </div>
                      )}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={messagesEndRef} />
          </div>

          <div className="input-area">
            <input
              type="text"
              className="voice-input"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              placeholder="Type your message or use voice input..."
              onKeyPress={(e) => {
                if (e.key === 'Enter' && userInput.trim()) {
                  handleUserMessage(userInput);
                  setUserInput('');
                }
              }}
              disabled={isProcessing}
            />
            
            <button
              className={`voice-button ${isRecording ? 'recording' : ''}`}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing}
            >
              {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
              {isRecording ? 'Stop' : 'Speak'}
            </button>

            <button
              className="voice-button"
              onClick={resetConversation}
              disabled={isProcessing}
            >
              <RotateCcw size={20} />
              Reset
            </button>
          </div>
        </div>
      </main>

      {/* 설정 모달 */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowSettings(false)}
          >
            <motion.div 
              className="modal-content"
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.8, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2>🔧 Settings</h2>
              <form onSubmit={handleApiKeySubmit}>
                <div className="form-group">
                  <label htmlFor="apiKey">OpenAI API Key:</label>
                  <input
                    type="password"
                    id="apiKey"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your OpenAI API key"
                    required
                  />
                  <small>
                    Get your API key from <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI Platform</a>
                  </small>
                </div>
                <div className="form-actions">
                  <button type="button" onClick={() => setShowSettings(false)}>
                    Cancel
                  </button>
                  <button type="submit">
                    Save & Start
                  </button>
                </div>
              </form>
              {isApiConfigured && (
                <div className="api-status">
                  ✅ API Key configured successfully!
                </div>

<div className="form-group" style={{ marginTop: 12 }}>
  <label htmlFor="teacherVideo">Teacher Video (embed URL):</label>
  <input
    type="url"
    id="teacherVideo"
    value={videoUrl}
    onChange={(e) => setVideoUrl(e.target.value)}
    placeholder="https:// ... (임베드용 URL 붙여넣기)"
  />
  <small>
    * D-ID / HeyGen / YouTube(Embed) / Loom 등에서 제공하는 <b>임베드 URL</b>을 사용하세요.
  </small>

  <div style={{ marginTop: 8 }}>
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <input
        type="checkbox"
        checked={showVideo}
        onChange={(e) => setShowVideo(e.target.checked)}
      />
      Show teacher video
    </label>
  </div>
</div>

              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default App;

