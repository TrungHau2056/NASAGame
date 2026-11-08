// Backend nhỏ giữ API key. Chạy: ANTHROPIC_API_KEY=... node server/mica.mjs
import http from 'node:http';

const PORT = 8787;
const KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = process.env.MICA_MODEL || 'claude-sonnet-5-5';

const SYSTEM = `Bạn là MICA, robot trợ lý thiết kế trong game giáo dục về che chắn bức xạ trên Mặt Trăng.
Trả lời bằng tiếng Việt, thân thiện, ngắn gọn. CHỈ trả về một JSON object, không thêm chữ nào khác:
{"message": string, "options": [{"arealDensity": number, "title": string, "reason": string}]}
Quy tắc:
- arealDensity CHỈ được là một trong các giá trị được cung cấp (g/cm²). Tối đa 3 phương án, khác nhau có ý nghĩa.
- KHÔNG tự bịa số liệu bức xạ hay khối lượng. Hệ thống sẽ tự tính. Chỉ nêu đánh đổi bằng lời.
- Nếu người chơi chỉ hỏi kiến thức, trả "options": [] và giải thích.
- Kiến thức: có che chắn vẫn còn bức xạ GCR; thêm vật liệu có đánh đổi (khối lượng tăng, suất liều không giảm mãi); GCR và SEP cần xem riêng.`;

const server = http.createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if (req.method !== 'POST' || req.url !== '/api/mica') return send(404, { error: 'not found' });
  if (!KEY) return send(503, { error: 'ANTHROPIC_API_KEY chưa được đặt' });
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 8000) return send(413, { error: 'quá dài' });
  }
  try {
    const { prompt, levels } = JSON.parse(body);
    if (typeof prompt !== 'string' || !prompt.trim()) return send(400, { error: 'thiếu prompt' });
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        system: SYSTEM,
        messages: [
          {
            role: 'user',
            content: `Các mức g/cm² hợp lệ: ${JSON.stringify(levels)}\nNgười chơi nói: ${prompt.slice(0, 500)}`,
          },
        ],
      }),
    });
    if (!r.ok) return send(502, { error: `Claude API ${r.status}` });
    const data = await r.json();
    const text = data.content?.find((c) => c.type === 'text')?.text ?? '';
    const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
    send(200, JSON.parse(json));
  } catch (e) {
    send(500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => console.log(`MICA server http://localhost:${PORT} (${KEY ? 'có' : 'THIẾU'} API key)`));
