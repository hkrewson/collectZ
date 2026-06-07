'use strict';

const fs = require('fs');
const http = require('http');
const net = require('net');
const dgram = require('dgram');
const path = require('path');

const tcpPort = Number(process.env.SYSLOG_TCP_PORT || 1514);
const udpPort = Number(process.env.SYSLOG_UDP_PORT || 1514);
const httpPort = Number(process.env.SYSLOG_HTTP_PORT || 1515);
const outputFile = process.env.SYSLOG_OUTPUT_FILE || '/var/log/collectz/collectz-syslog.log';

fs.mkdirSync(path.dirname(outputFile), { recursive: true });

function sanitizeLogLine(value = '') {
  return String(value || '')
    .replace(/[\r\n]+/g, '')
    .replace(/\t+/g, ' ')
    .replace(/[^\S\r\n]+/g, ' ')
    .trim();
}

function appendLine(line) {
  const normalized = sanitizeLogLine(line);
  if (!normalized) return;
  fs.appendFileSync(outputFile, `${normalized}\n`, 'utf8');
  console.log(`[syslog-collector] line=${JSON.stringify(normalized)}`);
}

const tcpServer = net.createServer((socket) => {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const parts = buffer.split('\n');
    buffer = parts.pop() || '';
    for (const line of parts) appendLine(line);
  });
  socket.on('end', () => {
    if (buffer.trim()) appendLine(buffer);
  });
});

tcpServer.listen(tcpPort, '0.0.0.0', () => {
  console.log(`syslog TCP collector listening on ${tcpPort}`);
});

const udpServer = dgram.createSocket('udp4');
udpServer.on('message', (message) => appendLine(message.toString('utf8')));
udpServer.bind(udpPort, '0.0.0.0', () => {
  console.log(`syslog UDP collector listening on ${udpPort}`);
});

const httpServer = http.createServer((req, res) => {
  if (!req.url) {
    res.statusCode = 400;
    res.end('missing url');
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${httpPort}`);
  if (url.pathname === '/health') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (url.pathname === '/tail') {
    const lines = Math.max(1, Number(url.searchParams.get('lines') || 50));
    const raw = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : '';
    const payload = raw.split('\n').filter(Boolean).slice(-lines);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ lines: payload }));
    return;
  }

  res.statusCode = 404;
  res.end('not found');
});

httpServer.listen(httpPort, '0.0.0.0', () => {
  console.log(`syslog HTTP helper listening on ${httpPort}`);
});
