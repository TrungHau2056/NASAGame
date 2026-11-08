# Đồ thị nhiệm vụ của dự án Hừng Đông

Cập nhật file này khi trạng thái đổi. Trạng thái: `done` (đã chứng minh) · `todo` · `written` (đã viết, chưa chứng minh).

| Nút | Việc | needs | Tiêu chí xong (chạy được) | Trạng thái |
|---|---|---|---|---|
| S1 | Bộ tính khoa học (`science.ts`) | – | `vitest`: 12 test, khối lượng 5/10/20/45 khớp 1.267/2.555/5.196/12.179 kg | done |
| S2 | Gói dữ liệu GCR đối chiếu với sheet gốc Zenodo | – | tái tạo ≥ 2 giá trị từ ô nguồn ICRP_PHANTOM | todo (mới trích từ tài liệu) |
| M1 | MICA: lọc đầu ra AI, mẫu dự phòng có nhãn | S1 | mọi đầu ra qua `validateConfig`, tối đa 3 phương án | done |
| M2 | Server Claude (`server/mica.mjs`) | M1 | gọi thật trả JSON hợp lệ, lỗi thì fallback | verify khi chạy với key |
| W1 | Thế giới 3D procedural | – | không lỗi console, ảnh chụp đúng | done |
| W2 | Thay asset bằng GLB từ Blender (`tools/blender/build_assets.py`) | W1 | 14 GLB tải được, không cảnh báo console, ảnh render duyệt | done |
| W3 | Địa hình 3D `heightAt`, khu chơi san phẳng = 0 | W1 | 9 điểm chơi đo đúng 0,000 m; độ dốc tối đa ≈ 1,1 | done |
| C1 | Điều khiển mượt: phím theo `e.code`, quán tính, tay chân lắc, click-to-move | W3 | vận tốc đơn điệu, ≤ 5,2 m/s, về 0 khi thả | done (đo bằng phím giả lập) |
| G1 | Nhiệm vụ 1: nhặt, túi 2 ô, giao xưởng | W1 | chạy bot qua `__hd` | done |
| G2 | Nhiệm vụ 2: bệ, xây vòm, ghi 60 s | G1, M1, S1 | chạy bot, kho đúng số | done |
| G3 | Nhiệm vụ 3: V2, hoàn vật liệu, bàn giao | G2 | kho 3.445 + 2.555 − 5.196 = 804 | done |
| Q1 | Chơi thử bằng bàn phím thật, cảm giác điều khiển | G3 | người chơi ngoài nhóm hoàn thành chương | todo |
| Q2 | SEP chỉ hiển thị sau khi trích đúng ô nguồn | S2 | không trộn đại lượng khác loại | todo |

## Nhánh song song được
- W2 (asset Blender) ⟂ Q1 (chơi thử) ⟂ S2 (đối chiếu dữ liệu).

## Vai kiểm độc lập
- Thay đổi ở `science.ts` hoặc bảng `LEVELS`: người kiểm chỉ nhận bảng nguồn và test, không nhận lập luận của người viết.
- Trước khi nộp: một người ngoài nhóm chơi không hướng dẫn (tiêu chí mục 11 tài liệu).

## Ranh giới phục hồi mặc định
- Lỗi ở `science.ts` → làm lại S1 và mọi nút phụ thuộc (M1, G2, G3). Không đụng W1.
- Lỗi ở `world.ts` → chỉ W1 và các nút hiển thị. Không đụng S1.
- Lỗi lưu/tải → chỉ `state.ts`; kiểm lại không nhân đồ hoặc vật liệu.

## Ontology
- **Phiên bản**: `{id, name, arealDensity, recordedSec}`.
- **Cấu hình hợp lệ**: `arealDensity ∈ {5,10,20,45}` (SEP: {0,1,5,10,20}, chưa dùng).
- **Đạt bàn giao**: GCR ≤ 0,70 mSv/ngày và vỏ ≤ 6.000 kg (chỉ 10 và 20 g/cm²).
- **Bằng chứng**: ô nguồn Zenodo, test vitest, ảnh chụp chơi thử.
