'use strict';

const fs = require('fs');
const net = require('net');
const dgram = require('dgram');
const path = require('path');

const tcpPort = Number(process.env.SYSLOG_TCP_PORT || 1514);
const udpPort = Number(process.env.SYSLOG_UDP_PORT || 1514);
const outputFile = process.env.SYSLOG_OUTPUT_FILE || '/var/log/collectz/collectz-syslog.log';

fs.mkdirSync(path.dirname(outputFile), { recursive: true });

function appendLine(line) {
  const normalized = String(line).trim();
  if (!normalized) return;
  fs.appendFileSync(outputFile, `${normalized}\n`, 'utf8');
  console.log(`[syslog-collector] ${normalized}`);
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
