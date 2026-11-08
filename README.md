# Hừng Đông

Game phiêu lưu và xây dựng 3D trên Mặt Trăng. Bạn là trưởng đoàn, cùng robot **MICA** (dùng Claude) thiết kế và xây một vòm che chắn bức xạ, rồi xem kết quả và cải tiến. Dự án cho hackathon hai ngày.

> **Lưu ý khoa học:** kết quả thuộc mô hình phantom tham chiếu (phantom nam ICRP, GCR ở cực tiểu hoạt động Mặt Trời). Đây không phải liều của nhân vật và không chứng minh vòm đủ điều kiện làm nơi ở. SEP chưa được mô phỏng theo thời gian.

## Chạy game

Cần Node.js 20.6 trở lên.

```bash
cd client
npm install
npm run dev          # mở http://localhost:5173
```

### Bật MICA dùng Claude thật (tùy chọn)

Không có key thì MICA vẫn chạy bằng phản hồi dự phòng và luôn gắn nhãn "Mẫu dự phòng, không phải AI".

```bash
# ở thư mục gốc
cp .env.example .env          # rồi điền ANTHROPIC_API_KEY vào .env
cd client
npm run server                # backend nhỏ ở http://localhost:8787, Vite tự proxy /api
```

`.env` đã nằm trong `.gitignore`. Không commit key.

## Điều khiển

| Phím | Việc |
|---|---|
| `W A S D` hoặc mũi tên | Đi (góc nhìn thứ 3 theo hướng màn hình) |
| Click chuột lên mặt đất | Tự đi tới đó |
| `Shift` | Chạy |
| `E` | Tương tác (nhặt, đặt, nói với MICA, mở màn hình bệ) |
| `Q` | Đặt đồ trong túi xuống |
| `V` | Đổi góc nhìn thứ 1 / thứ 3 |
| `P` | Tạm dừng |
| `Esc` | Đóng bảng, nhả chuột |

Góc nhìn thứ 1: click vào màn hình để khóa chuột. `W/S` tới lui, `A/D` đi ngang, mũi tên trái/phải để quay.

Nút **Đồ họa** (giữa phía trên): Tự động, Cao, Thấp. Máy yếu nên chọn Thấp.

## Cách chơi

1. **Mang đồ nghề về:** tìm bộ ghi dữ liệu (xanh) và mô hình cơ thể (cam), mang về xưởng. Túi có 2 ô.
2. **Khu nghiên cứu đầu tiên:** đặt hai thiết bị lên bệ, nói ý tưởng với MICA (hoặc chọn mẫu), xem hình xem trước, đặt tên rồi xây. Bật ghi trên màn hình bệ đủ 60 giây.
3. **Để lại thứ dùng tiếp được:** bàn giao thiết kế có GCR ≤ 0,70 mSv/ngày và vỏ ≤ 6.000 kg. Có thể cải tiến thành V2 trước khi bàn giao (vật liệu vòm cũ được hoàn lại).

Tiến trình tự lưu trong trình duyệt (`localStorage`).

## Cấu trúc

```
client/            Vite + TypeScript + Three.js
  src/science.ts   bộ tính: tra bảng GCR, khối lượng vỏ, điều kiện bàn giao
  src/mica.ts      gọi backend, lọc đầu ra AI, phản hồi dự phòng
  src/state.ts     trạng thái game, lưu/tải
  src/world.ts     địa hình, ánh sáng, dựng cảnh, texture
  src/assets.ts    tải GLB, gộp mảnh tĩnh
  src/game.ts      vòng lặp, điều khiển, nhiệm vụ, giao diện
  public/models/   14 model GLB dựng bằng Blender
server/mica.mjs    backend nhỏ giữ API key, gọi Claude
tools/blender/     script dựng model + ảnh xem trước
.claude/skills/    skill hỗ trợ code (Three.js, Blender, graph-engineering)
```

### Nguyên tắc dữ liệu khoa học

- Mọi cấu hình (AI, mẫu, chỉnh tay) đều đi qua `validateConfig`. Chỉ nhận các mức có trong bảng nguồn: 5, 10, 20, 45 g/cm². Không nội suy.
- AI chỉ đề xuất mức che chắn và lời giải thích. Số liệu bức xạ và khối lượng do `science.ts` tính.
- Khối lượng vỏ bán cầu tính từ bán kính trong 2 m và regolith 3 g/cm³, không gồm nền, khung hay thiết bị.

## Kiểm thử

```bash
cd client
npm test            # vitest: 12 test khoa học
npm run build       # typecheck + build
```

## Dựng lại model bằng Blender

Cần Blender 4.2 trở lên (đã thử với 4.5 LTS). Không cần Blender nếu chỉ chơi game, vì GLB đã có sẵn trong repo.

```bash
blender --background --python tools/blender/build_assets.py -- <thư mục GLB> <thư mục preview>
# ví dụ
blender --background --python tools/blender/build_assets.py -- client/public/models tools/blender/previews
```

Dùng đường dẫn tuyệt đối cho thư mục preview nếu ảnh không xuất hiện. Quy ước: đơn vị mét, gốc ở chân/đáy, mặt trước là -Y (sang glTF thành +Z). Tay chân phi hành gia (`legL`, `legR`, `armL`, `armR`) và cánh tay MICA là các khớp riêng để code xoay.

## Giới hạn hiện tại

- Chưa đối chiếu gói dữ liệu GCR với sheet gốc Zenodo (hiện lấy từ tài liệu thiết kế).
- Vòm che chắn dựng bằng code, độ dày hiển thị được phóng đại để dễ nhìn (khối lượng vẫn tính theo công thức thật).
- Chưa có hoạt ảnh nhặt/đặt đồ. Góc nhìn thứ 1 không thấy thân nhân vật.
- Chưa chơi thử với người ngoài nhóm.

## Nguồn

- Matthiä & Berger, DLR (2024): <https://elib.dlr.de/210448/>
- Dữ liệu bổ sung (CC BY 4.0): <https://zenodo.org/records/13365755>
- NASA Radiation Protection: <https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-020-radiation-protection.pdf>
- Feng et al., *Graph Engineering in the Era of LLM Agents* (arXiv 2608.21156), nền tảng của skill `graph-engineering`.
