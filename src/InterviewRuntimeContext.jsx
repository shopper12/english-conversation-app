import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

const EMPTY_RUNTIME = {
  phase: 'setup',
  profile: {},
  question: '',
  displayAnswer: '',
  isListening: false,
  isBusy: false,
  latestFeedback: null,
  liveMetrics: {},
  cameraReady: false,
  mediaStream: null,
  videoElement: null,
  questionNumber: 1,
};

const InterviewRuntimeContext = createContext({
  runtime: EMPTY_RUNTIME,
  publishRuntime: () => {},
});

export function InterviewRuntimeProvider({ children }) {
  const [runtime, setRuntime] = useState(EMPTY_RUNTIME);
  const publishRuntime = useCallback((patch) => {
    setRuntime((current) => ({ ...current, ...(patch || {}) }));
  }, []);
  const value = useMemo(() => ({ runtime, publishRuntime }), [publishRuntime, runtime]);
  return <InterviewRuntimeContext.Provider value={value}>{children}</InterviewRuntimeContext.Provider>;
}

export const useInterviewRuntime = () => useContext(InterviewRuntimeContext);
