import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpenCheck, BriefcaseBusiness, Check, ChevronDown, FileText, Loader2, Play, RefreshCw,
  Search, Sparkles, Upload, UserRoundSearch, X,
} from 'lucide-react';
import { COMMON_QUESTIONS, QUESTION_RESEARCH_NOTE, WORK_QUESTIONS } from './questionBankData.js';
import { clearQuestionQueue, setQuestionQueue } from './questionPracticeBridge.js';
import './QuestionLibrary.css';

const MAX_RESUME_BYTES = 2.5 * 1024 * 1024;
const MAMMOTH_URL = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.0/mammoth.browser.min.js';

const fileToDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
  reader.readAsDataURL(file);
});

const loadMammoth = () => new Promise((resolve, reject) => {
  if (window.mammoth?.extractRawText) return resolve(window.mammoth);
  const existing = document.querySelector(`script[src="${MAMMOTH_URL}"]`);
  if (existing) {
    existing.addEventListener('load', () => resolve(window.mammoth), { once: true });
    existing.addEventListener('error', () => reject(new Error('DOCX 분석 모듈을 불러오지 못했습니다.')), { once: true });
    return;
  }
  const script = document.createElement('script');
  script.src = MAMMOTH_URL;
  script.async = true;
  script.onload = () => resolve(window.mammoth);
  script.onerror = () => reject(new Error('DOCX 분석 모듈을 불러오지 못했습니다.'));
  document.head.appendChild(script);
});

const extractDocx = async (file) => {
  const mammoth = await loadMammoth();
  if (!mammoth?.extractRawText) throw new Error('DOCX 텍스트 추출 기능을 사용할 수 없습니다.');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return String(result?.value || '').replace(/\n{3,}/g, '\n\n').trim();
};

const setControlledValue = (element, value) => {
  if (!element) return;
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

const collectContext = () => ({
  targetRole: document.getElementById('targetRole')?.value || '',
  company: document.getElementById('company')?.value || '',
  interviewType: document.getElementById('interviewType')?.value || '',
  jobDescription: document.getElementById('jobDescription')?.value || '',
  resumeHighlights: document.getElementById('resumeHighlights')?.value || '',
});

const dedupeQuestions = (questions) => {
  const seen = new Set();
  return questions.filter((item) => {
    const key = String(item?.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

function QuestionLibrary() {
  const [target, setTarget] = useState(null);
  const [expanded, setExpanded] = useState(true);
  const [tab, setTab] = useState('common');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('전체');
  const [selected, setSelected] = useState(() => new Set());
  const [generatedWork, setGeneratedWork] = useState([]);
  const [generatedResume, setGeneratedResume] = useState([]);
  const [resume, setResume] = useState(null);
  const [resumeSummary, setResumeSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [visibleLimit, setVisibleLimit] = useState(18);

  useEffect(() => {
    const locate = () => {
      const form = document.querySelector('.phase-setup .setup-card form');
      setTarget(form || null);
      if (form) clearQuestionQueue();
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  const allWork = useMemo(() => dedupeQuestions([...generatedWork, ...WORK_QUESTIONS]), [generatedWork]);
  const allResume = useMemo(() => dedupeQuestions(generatedResume), [generatedResume]);
  const sourceQuestions = tab === 'common' ? COMMON_QUESTIONS : tab === 'work' ? allWork : allResume;
  const categories = useMemo(() => ['전체', ...new Set(sourceQuestions.map((item) => item.category))], [sourceQuestions]);

  useEffect(() => {
    setCategory('전체');
    setSearch('');
    setVisibleLimit(18);
  }, [tab]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return sourceQuestions.filter((item) => {
      if (category !== '전체' && item.category !== category) return false;
      if (!keyword) return true;
      return `${item.text} ${item.category} ${item.competency} ${item.rationale || ''}`.toLowerCase().includes(keyword);
    });
  }, [category, search, sourceQuestions]);

  const allAvailable = useMemo(() => dedupeQuestions([...COMMON_QUESTIONS, ...allWork, ...allResume]), [allResume, allWork]);
  const selectedQuestions = useMemo(() => allAvailable.filter((item) => selected.has(item.id)), [allAvailable, selected]);

  const toggleQuestion = (id) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 12) next.add(id);
      return next;
    });
  };

  const randomPick = () => {
    const shuffled = [...filtered].sort(() => Math.random() - 0.5).slice(0, Math.min(5, filtered.length));
    setSelected((current) => {
      const next = new Set(current);
      shuffled.forEach((item) => { if (next.size < 12) next.add(item.id); });
      return next;
    });
  };

  const handleResume = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    setResumeSummary('');
    setGeneratedResume([]);
    if (file.size > MAX_RESUME_BYTES) {
      setError('이력서는 2.5MB 이하 파일을 사용해 주세요. Vercel 요청 크기 제한을 고려한 안전 한도입니다.');
      event.target.value = '';
      return;
    }
    const name = file.name.toLowerCase();
    setBusy(true);
    try {
      if (file.type === 'application/pdf' || name.endsWith('.pdf')) {
        const dataUrl = await fileToDataUrl(file);
        setResume({ name: file.name, kind: 'pdf', pdfDataUrl: dataUrl, text: '' });
      } else if (name.endsWith('.docx')) {
        const text = await extractDocx(file);
        if (!text) throw new Error('DOCX에서 텍스트를 추출하지 못했습니다.');
        setResume({ name: file.name, kind: 'docx', text: text.slice(0, 18000), pdfDataUrl: '' });
      } else if (/\.(txt|md|rtf)$/i.test(name) || file.type.startsWith('text/')) {
        const text = (await file.text()).trim();
        if (!text) throw new Error('이력서에 읽을 수 있는 텍스트가 없습니다.');
        setResume({ name: file.name, kind: 'text', text: text.slice(0, 18000), pdfDataUrl: '' });
      } else {
        throw new Error('PDF, DOCX, TXT, MD, RTF 형식의 이력서를 지원합니다.');
      }
    } catch (uploadError) {
      setResume(null);
      setError(uploadError.message);
    } finally {
      setBusy(false);
      event.target.value = '';
    }
  };

  const generateTailored = async (mode) => {
    const context = collectContext();
    if (!context.targetRole.trim()) {
      setError('먼저 위의 목표 직무를 입력해 주세요.');
      document.getElementById('targetRole')?.focus();
      return;
    }
    if (mode === 'resume' && !resume && !context.resumeHighlights.trim()) {
      setError('이력서를 업로드하거나 위의 핵심 경력을 입력해 주세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/question-bank', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          ...context,
          resumeText: resume?.text || '',
          resumePdfDataUrl: resume?.pdfDataUrl || '',
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || `맞춤 질문 생성 실패 (${response.status})`);
      if (Array.isArray(data.workQuestions)) setGeneratedWork(data.workQuestions);
      if (Array.isArray(data.resumeQuestions)) setGeneratedResume(data.resumeQuestions);
      if (data.resumeSummary) setResumeSummary(data.resumeSummary);
      if (mode === 'work') setTab('work');
      else setTab('resume');
    } catch (generationError) {
      setError(generationError.message);
    } finally {
      setBusy(false);
    }
  };

  const applySummary = () => {
    if (!resumeSummary) return;
    const textarea = document.getElementById('resumeHighlights');
    setControlledValue(textarea, resumeSummary.slice(0, 3000));
  };

  const startSelected = () => {
    if (!selectedQuestions.length) {
      setError('연습할 질문을 하나 이상 선택해 주세요.');
      return;
    }
    setError('');
    setQuestionQueue(selectedQuestions);
    target?.requestSubmit();
  };

  const practiceOne = (item) => {
    setSelected(new Set([item.id]));
    setQuestionQueue([item]);
    target?.requestSubmit();
  };

  if (!target) return null;

  return createPortal(
    <section className="question-library">
      <button className="question-library__heading" type="button" onClick={() => setExpanded((value) => !value)}>
        <div>
          <span className="question-library__number">02</span>
          <span><strong>예상 질문 라이브러리</strong><small>공통 · 업무관련 · 이력서 맞춤 질문을 직접 선택</small></span>
        </div>
        <ChevronDown className={expanded ? 'is-open' : ''} size={20} />
      </button>

      {expanded && (
        <div className="question-library__body">
          <div className="question-library__research">
            <BookOpenCheck size={18} />
            <span>{QUESTION_RESEARCH_NOTE} 질문 문장은 연습용으로 재구성했으며 원문 목록을 복제하지 않습니다.</span>
          </div>

          <div className="question-tabs">
            <button type="button" className={tab === 'common' ? 'is-active' : ''} onClick={() => setTab('common')}>
              <BookOpenCheck size={16} /> 공통질문 <em>{COMMON_QUESTIONS.length}</em>
            </button>
            <button type="button" className={tab === 'work' ? 'is-active' : ''} onClick={() => setTab('work')}>
              <BriefcaseBusiness size={16} /> 업무관련 <em>{allWork.length}</em>
            </button>
            <button type="button" className={tab === 'resume' ? 'is-active' : ''} onClick={() => setTab('resume')}>
              <UserRoundSearch size={16} /> 이력서 맞춤 <em>{allResume.length}</em>
            </button>
          </div>

          <div className="resume-tools">
            <label className="resume-upload">
              <Upload size={17} />
              <span><strong>{resume ? resume.name : '이력서 업로드'}</strong><small>PDF · DOCX · TXT · MD · RTF, 최대 2.5MB</small></span>
              <input type="file" accept=".pdf,.docx,.txt,.md,.rtf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" onChange={handleResume} />
            </label>
            {resume && <button type="button" className="tiny-action" onClick={() => generateTailored('resume')} disabled={busy}><Sparkles size={15} /> 이력서 질문 생성</button>}
            <button type="button" className="tiny-action" onClick={() => generateTailored('work')} disabled={busy}><Sparkles size={15} /> 직무 맞춤 생성</button>
          </div>

          {busy && <div className="question-loading"><Loader2 className="spin" size={17} /> 이력서·직무 정보를 분석해 예상 질문을 만드는 중입니다.</div>}
          {error && <div className="question-error">{error}</div>}

          {resumeSummary && (
            <div className="resume-summary">
              <div><FileText size={17} /><strong>이력서 분석 요약</strong></div>
              <p>{resumeSummary}</p>
              <button type="button" onClick={applySummary}>위의 ‘핵심 경력·성과’에 반영</button>
            </div>
          )}

          {tab === 'resume' && !allResume.length && !busy && (
            <div className="resume-empty">
              <UserRoundSearch size={24} />
              <strong>이력서에서 나올 질문을 따로 만듭니다.</strong>
              <span>회사·프로젝트·성과수치·직무전환·본인 기여를 근거로 꼬리질문을 생성합니다.</span>
              <button type="button" onClick={() => generateTailored('resume')}>이력서 맞춤 질문 생성</button>
            </div>
          )}

          {sourceQuestions.length > 0 && (
            <>
              <div className="question-filter-row">
                <label className="question-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="질문·역량 검색" /></label>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select>
                <button type="button" onClick={randomPick}><RefreshCw size={15} /> 5개 추천</button>
              </div>

              <div className="question-grid">
                {filtered.slice(0, visibleLimit).map((item) => {
                  const isSelected = selected.has(item.id);
                  return (
                    <article key={item.id} className={`question-item ${isSelected ? 'is-selected' : ''}`}>
                      <button type="button" className="question-item__select" onClick={() => toggleQuestion(item.id)} aria-label="질문 선택">
                        {isSelected ? <Check size={15} /> : <span />}
                      </button>
                      <div className="question-item__meta"><span>{item.category}</span><span>{item.competency}</span><span>{item.framework}</span></div>
                      <p>{item.text}</p>
                      {item.rationale && <small>{item.rationale}</small>}
                      <div className="question-item__footer"><span>권장 {item.targetSeconds || 90}초</span><button type="button" onClick={() => practiceOne(item)}>이 질문만 연습</button></div>
                    </article>
                  );
                })}
              </div>
              {filtered.length > visibleLimit && <button type="button" className="question-more" onClick={() => setVisibleLimit((value) => value + 18)}>질문 더 보기 ({filtered.length - visibleLimit})</button>}
            </>
          )}

          <div className="selected-question-bar">
            <div>
              <strong>선택 {selectedQuestions.length}개</strong>
              <span>최대 12개 · 위 ‘질문 수’보다 많으면 설정된 문항 수까지만 진행됩니다.</span>
            </div>
            {selectedQuestions.length > 0 && <button type="button" className="clear-selected" onClick={() => setSelected(new Set())}><X size={15} /> 초기화</button>}
            <button type="button" className="start-selected" onClick={startSelected} disabled={!selectedQuestions.length || busy}><Play size={17} /> 선택한 질문으로 면접 시작</button>
          </div>
        </div>
      )}
    </section>,
    target,
  );
}

export default QuestionLibrary;
