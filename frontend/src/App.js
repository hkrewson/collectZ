import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

function App() {
  const [status, setStatus] = useState('Checking connection...');

  useEffect(() => {
    axios.get(`${API_URL}/health`)
      .then(() => setStatus('Connected to backend!'))
      .catch(() => setStatus('Backend connection failed'));
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      color: 'white',
      fontFamily: 'system-ui'
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>MediaVault</h1>
        <p style={{ fontSize: '1.2rem' }}>{status}</p>
        <p style={{ marginTop: '2rem', opacity: 0.8 }}>
          Your media management solution
        </p>
      </div>
    </div>
  );
}

export default App;
