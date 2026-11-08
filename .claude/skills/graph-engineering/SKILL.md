---
name: graph-engineering
description: Quy trình code theo "Graph Engineering / System Intelligence" (Feng et al., arXiv 2608.21156): biến mục tiêu thành đồ thị nhiệm vụ có phụ thuộc, giao việc theo năng lực (người viết khác người kiểm), ghi sổ trạng thái, khoanh vùng lỗi và phục hồi cục bộ. Dùng khi bắt đầu một tính năng nhiều bước, khi có nhiều module phụ thuộc nhau, khi có thể chạy song song bằng subagent, khi debug lỗi lan truyền, hoặc khi người dùng nhắc graph engineering, system intelligence, task graph, đồ thị nhiệm vụ, chia việc, điều phối agent.
---

# Graph Engineering khi viết code

Ý tưởng cốt lõi của bài báo: một agent đơn lẻ làm việc nhiều bước trong một ngữ cảnh sẽ bị ba điểm nghẽn: không song song được, tự viết tự chấm nên dễ tự tin sai, và lỗi sớm âm thầm lan xuống cuối mà không biết sai từ đâu. Cách chữa là **làm các quan hệ trở nên tường minh dưới dạng đồ thị** thay vì để chúng nằm ngầm trong đầu. "Hệ thống thông minh" nằm ở cách tổ chức, không phải ở số lượng agent.

Dùng ba góc nhìn (3 đồ thị) cho mọi việc không tầm thường. Việc nhỏ (sửa một dòng, đổi chữ) thì bỏ qua skill này.

## 1. Task Organization: Việc gì cần làm?

**1.1 Phân rã mục tiêu thành đồ thị.** Nút là việc nhỏ có thể kiểm chứng. Cạnh là phụ thuộc (dữ liệu, thứ tự, logic).
- Mỗi nút có: `id`, kết quả đầu ra cụ thể, **tiêu chí xong chạy được** (lệnh test, kiểm tra tay, ảnh chụp), và `needs: [...]`.
- Nút không có tiêu chí kiểm chứng thì chưa đủ nhỏ. Tách tiếp.
- Nút không phụ thuộc nhau là **nhánh song song**. Đánh dấu rõ để giao cho subagent hoặc làm xen kẽ.

**1.2 Biên dịch thành quy trình thực thi.** Với mỗi nút chọn công cụ: sửa file, chạy test, gọi subagent, hỏi người dùng. Xác định nút **kiểm chứng** (test, typecheck, chạy thử) đứng ở đâu.

**1.3 Đồ thị sống, không cố định.** Khi kết quả trung gian làm đổi hiểu biết (phát hiện ràng buộc mới, test đỏ), **sửa đồ thị còn lại** thay vì cố bám kế hoạch cũ. Ghi lý do sửa.

Mẫu:
```
G1 science  needs:[]        done: vitest xanh, khối lượng khớp bảng nguồn
G2 mica     needs:[G1]      done: mọi đầu ra AI đi qua validateConfig
G3 world    needs:[]        done: dựng cảnh, không lỗi console      (song song với G1)
G4 gameplay needs:[G1,G3]   done: chơi hết nhiệm vụ 1–2 bằng bot
V1 verify   needs:[G2,G4]   done: tsc + vitest + chơi thử trình duyệt   (nút kiểm chứng)
```

## 2. Agent Coordination: Ai làm?

**2.1 Mô hình năng lực.** Trước khi giao việc, ghi ai (agent/skill/công cụ) làm được gì và quyền hạn tới đâu. Ví dụ: `shader-reviewer` chỉ đọc code GLSL; `Explore` chỉ đọc; `general-purpose` được sửa file. Giao nút cho bên **đủ năng lực và quyền hạn tối thiểu**. Mất quyền truy cập thì tra lại và giao lại.

**2.2 Tổ chức đội theo hình dạng việc.**
- **Chuỗi** khi phụ thuộc rõ: viết → kiểm → sửa.
- **Định tuyến** khi việc đòi chuyên môn khác nhau: chuyển đúng chuyên gia.
- **Fan-out / fan-in** khi nhiều ứng viên hoặc nhánh độc lập: chạy song song rồi tổng hợp. Chấp nhận chi phí tổng hợp.
- Kết hợp được: điều phối viên chia việc, chuyên gia làm song song, chuỗi người kiểm duyệt ở cuối.

**2.3 Quy tắc độc lập kiểm chứng.** Cùng một ngữ cảnh viết và chấm sẽ tự xác nhận sai (confirmation bias). Với thay đổi quan trọng, người kiểm là **vai riêng, ngữ cảnh riêng**, nhận code và tiêu chí xong, **không nhận kết luận của người viết**. Với việc rủi ro cao, người dùng là một nút duyệt tường minh.

**2.4 Giao tiếp có chọn lọc.** Thêm kênh giao tiếp không tự làm tốt hơn. Brief cho subagent chỉ chứa: mục tiêu, tệp liên quan, điều đã loại trừ, tiêu chí xong. Kết quả trả về là kết luận + bằng chứng, không phải đống tệp. Lỗi trung gian phải được trả về nút sinh ra nó, không đẩy xuôi dòng.

## 3. Runtime State Management: Hệ thống đang ở đâu?

**3.1 Sổ trạng thái (State Recording).** Giữ một bảng ngắn, cập nhật sau mỗi nút: `pending | running | done | failed | invalidated`, kèm bằng chứng (lệnh đã chạy, kết quả, hash/commit nếu có). Đây là nguồn sự thật, không phải trí nhớ hội thoại.
- **Đề xuất → kiểm → ghi nhận (propose-validate-commit):** thay đổi trạng thái chung (sửa schema dùng chung, hằng số khoa học, thứ tự nhiệm vụ) phải qua một cổng kiểm tra trước khi được coi là "đã xong". Trong dự án này cổng đó là `validateConfig` + test.
- Chỉ ghi nhận thứ đã **chứng minh**, không ghi điều mình tin.

**3.2 Khoanh vùng lỗi (Fault Localization).** Khi có lỗi:
1. Phát hiện bất thường từ tín hiệu thật (test đỏ, lỗi console, số liệu lệch bảng nguồn).
2. Lần ngược theo cạnh phụ thuộc tới **trạng thái hợp lệ cuối cùng** và **trạng thái sai đầu tiên**. Lỗi thấy ở cuối thường sinh ra ở đầu.
3. Coi nguyên nhân là **giả thuyết**, kiểm bằng bằng chứng quan sát được. Quan hệ phụ thuộc thu hẹp phạm vi tìm, nhưng không chứng minh nhân quả.
4. Ghi chẩn đoán và bằng chứng vào sổ.

**3.3 Phục hồi cục bộ (Failure Recovery).** Đặt **ranh giới phục hồi**: giữ nguyên phần hợp lệ, chỉ làm lại vùng bị ảnh hưởng (nút lỗi và hậu duệ của nó). Chọn một trong: chạy lại, đổi nhánh khác, bù trừ tác động ngoài (xóa file/cài đặt đã tạo), hỏi người dùng. Sau đó **kiểm lại** và ghi nhận trạng thái mới. Đóng vòng ghi → chẩn đoán → phục hồi.
- Tác động không hoàn tác được (xóa dữ liệu, gửi ra ngoài, commit/push) cần xác nhận trước, theo quy tắc chung.

## 4. System Evolution: Rút kinh nghiệm

Sau mỗi lần làm xong hoặc lỗi lớn, ghi 1–3 dòng cái gì hiệu quả hoặc hỏng về **cách tổ chức** (không chỉ về code): nút quá to, thiếu nút kiểm, sai thứ tự phụ thuộc, người kiểm bị anchoring. Dùng cho lần sau. Chỉ sửa cấu trúc dựa trên bằng chứng đáng tin, không dựa trên một tín hiệu đơn lẻ.

## Ontology mini (ngôn ngữ chung, tránh hiểu khác nhau)
Giữ một bảng định nghĩa ngắn để các nút dùng cùng nghĩa. Ví dụ Hừng Đông: **Phiên bản** (V1, V2: tên, mức g/cm², thời gian ghi), **Cấu hình hợp lệ** (chỉ mức trong bảng nguồn), **Đạt bàn giao** (GCR ≤ 0,70 và vỏ ≤ 6.000 kg), **Bằng chứng** (ô nguồn, test). "Xong" nghĩa là tiêu chí chạy được đã đạt, không phải "đã viết".

## Quy trình tóm tắt cho mỗi tính năng
1. Viết đồ thị nhiệm vụ (5–12 nút), có tiêu chí xong và nút kiểm chứng.
2. Xác định nhánh song song và vai kiểm độc lập.
3. Thực thi theo thứ tự phụ thuộc, cập nhật sổ trạng thái sau mỗi nút.
4. Lỗi → khoanh vùng → phục hồi cục bộ, không làm lại toàn bộ.
5. Kết thúc: báo cáo trung thực nút nào đã chứng minh, nút nào chỉ đã viết, nút nào bị bỏ.

## Giới hạn (đừng lạm dụng)
- Đồ thị là công cụ, không phải thủ tục. Việc 1–2 bước thì làm thẳng.
- Nhiều agent không đồng nghĩa với thông minh hơn: mỗi kênh giao tiếp có chi phí và có thể lan lỗi.
- Hiệu quả tăng có thể chỉ do tốn nhiều tính toán hơn, không phải do tổ chức tốt hơn. Đo bằng kết quả kiểm chứng được.

Nguồn: Feng et al., "Graph Engineering in the Era of LLM Agents: From Individual Intelligence to System Intelligence", arXiv:2608.21156v2, Mục 4 (Task Organization, Agent Coordination, Runtime State Management, System Evolution).
