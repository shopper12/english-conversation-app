import './index.css';
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import InterviewTurnManager from './InterviewTurnManager.jsx'
import HumanInterviewEvaluator from './HumanInterviewEvaluator.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
    <InterviewTurnManager />
    <HumanInterviewEvaluator />
  </React.StrictMode>,
)
