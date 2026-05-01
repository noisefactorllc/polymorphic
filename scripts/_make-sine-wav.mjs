// Generate a 1-second mono PCM WAV at 440Hz / 16kHz for fake-mic capture.
import fs from 'fs';
const sr = 16000, freq = 440, secs = 1;
const samples = Math.floor(sr * secs);
const buf = Buffer.alloc(44 + samples * 2);
buf.write('RIFF', 0);
buf.writeUInt32LE(36 + samples * 2, 4);
buf.write('WAVE', 8);
buf.write('fmt ', 12);
buf.writeUInt32LE(16, 16);
buf.writeUInt16LE(1, 20); // PCM
buf.writeUInt16LE(1, 22); // mono
buf.writeUInt32LE(sr, 24);
buf.writeUInt32LE(sr * 2, 28);
buf.writeUInt16LE(2, 32);
buf.writeUInt16LE(16, 34);
buf.write('data', 36);
buf.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
    const v = Math.sin(2 * Math.PI * freq * i / sr) * 30000;
    buf.writeInt16LE(v | 0, 44 + i * 2);
}
fs.writeFileSync(process.argv[2] || '/tmp/poly-sine.wav', buf);
console.log('wrote', buf.length, 'bytes to', process.argv[2] || '/tmp/poly-sine.wav');
