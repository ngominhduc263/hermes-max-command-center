# Hermes Max · Command Center v2.30.0 — Ivory Graphite

Gói nâng cấp Dashboard cho **Hermes Agent v0.21.0**, chạy nền bằng Windows
Scheduled Task nên đóng PowerShell không làm Dashboard tắt.

Bản 2.4.0 sửa dứt điểm lỗi **gửi tệp và ảnh**, đồng thời hoàn thiện khung chat
theo chuẩn của các dashboard agent và chatbot hiện đại.

## v2.30.0 — thanh git, danh sách phiên gom nhóm, và sửa lỗi Dashboard nền bị giết

Hai thứ lấy từ Hermes Desktop, cộng một lỗi thật.

### 1. Thanh git dưới ô soạn tin

`main ↑233 ↓1 +27737 −118`. Đang bảo agent sửa file thì repo lệch bao nhiêu là
thứ nên thấy ngay, không phải mở terminal.

Dữ liệu lấy từ `GET /api/git/status` — **đúng endpoint mà Desktop dùng**, không
phải tự đoán. Hai hành vi của nó phải xử lý riêng:

- Thư mục không phải kho git thì nó trả **body null chứ không phải 404**, tức
  vẫn là phản hồi thành công. Thanh này im lặng biến mất thay vì báo lỗi.
- **Không có sự kiện đẩy** cho thay đổi cây làm việc ở bất kỳ đâu trong Hermes.
  Desktop poll ở các mốc: lượt xong, công cụ xong, cửa sổ được focus. Mình làm
  đúng vậy, chứ không chạy timer vô tận.

Một chỗ cố ý không nói quá: `ahead: 0, behind: 0` vừa có nghĩa "ngang bằng
remote" vừa có nghĩa "không có upstream để so", mà payload không phân biệt.
Nên số 0 thì **không vẽ gì cả**, và tooltip ghi "chưa so được với remote"
thay vì "đã đồng bộ".

### 2. Danh sách phiên gom theo mốc thời gian, ghim được

Đã ghim → Hôm nay → Hôm qua → 7 ngày qua → 30 ngày qua → Cũ hơn. Rê chuột vào
một hàng là hiện nút ghim.

**Ghim dùng chung với Desktop.** `sessions.pinned` là cột thật trong database,
`PATCH /api/sessions/{id}` là đường ghi, và đó chính là cột Desktop ghi. Ghim ở
Dashboard thì mở Desktop cũng thấy. Panel có ghi rõ câu này dưới mục Đã ghim.

Thứ **không** dùng chung là thứ tự ghim — Desktop giữ riêng trong localStorage
của nó, không có cột nào cả. Nên bên mình sắp theo thời gian, để không bao giờ
mâu thuẫn với bên kia.

Mốc thời gian tính theo **lịch chứ không theo số giờ trôi qua**: tin lúc 11 giờ
đêm qua, đọc lúc 1 giờ sáng nay, là "Hôm qua" — mới 2 tiếng nhưng khác ngày.
Làm kiểu khác là lệch với đồng hồ trên tường mà người đọc không nói ra được sai
ở đâu.

### 3. Sửa lỗi Dashboard nền bị Hermes Desktop giết

Anh Haruto báo: cài Hermes Desktop xong thì Dashboard nền không sống nữa, phải
mở PowerShell chạy tay và đóng cửa sổ là mất.

Đọc mã nguồn thì ra nguyên nhân, và **không phải xung đột cổng** — Desktop chạy
backend riêng ở cổng ngẫu nhiên (`serve --port 0`), không đụng 9119. Thật ra:

- Khi cài (và mỗi lần tự sửa chữa) Desktop chạy `scripts\install.ps1`, và script
  đó gọi `taskkill /F /T /IM hermes.exe` — **giết mọi tiến trình hermes.exe trên
  máy**, rồi quét thêm tối đa 10 lượt theo đường dẫn venv để diệt cả tiến trình
  được giám sát tự bật lại.
- Nó **có chừa** task tự khởi động của Gateway (tìm theo tên `*Hermes_Gateway*`,
  tắt rồi bật lại) nhưng **không chừa** task Dashboard.
- Trên Windows, `hermes update` cũng dừng dashboard mà **không bật lại** — đoạn
  respawn bị chặn bởi `if restart_managed and sys.platform != "win32"`.

Task của mình trước đây chỉ có trigger **lúc đăng nhập**, nên bị giết là chết
tới lần đăng nhập sau. Giờ có thêm **lịch lặp 10 phút**; kết hợp với
`MultipleInstances IgnoreNew` và đoạn kiểm tra cổng sẵn có trong
`Start-HermesDashboard.ps1` (thấy cổng đã có người nghe thì thoát ngay) thì:
đang chạy → lần lặp không làm gì; bị giết → tối đa 10 phút sau tự sống lại.
`RestartCount` cũng nâng từ 3 lên 5.

Đây là **lỗi thứ sáu** tìm được ở Hermes, và là lỗi đáng báo nhất từ trước tới
giờ: tài liệu Desktop khẳng định nó "self-contained… never opens or requires the
web dashboard", mà thực tế trình cài của nó giết sạch tiến trình Hermes trên máy
và dựng lại venv.

### Cũng trong bản này

`Start-HermesDashboard.ps1` và `Install-HermesDashboardTask.ps1` giờ cũng tự dò
thư mục Hermes như hai script kia — trước đó vẫn còn cứng `D:\HERMES AGENT`, tức
là gói public sẽ hỏng với bất kỳ ai không để Hermes ở ổ D.

## v2.29.0 — pet ảo, công cụ phiên, và checkpoint

Bản này thêm sáu thứ. Trước khi viết dòng code nào em đọc runtime trước, và
**bốn trong sáu cái hoá ra không giống tên gọi của nó** — chỗ nào lệch thì UI
nói thẳng ra chứ không giấu.

### 1. Pet ảo

Pet hiện ở góc khung chat, tự đổi dáng theo việc Hermes đang làm: chạy công cụ,
suy nghĩ, đợi anh trả lời, vừa xong, hay vừa lỗi. Bấm vào pet để đổi con khác,
chỉnh cỡ, hoặc cất đi.

**Pet của Hermes không phải Tamagotchi.** Chú thích trong config của chính Nous
gọi nó là "a purely cosmetic sprite". Toàn bộ dữ liệu lưu của một pet đúng năm
trường (`id, displayName, description, spritesheetPath, createdBy`) — **không
có đói, cấp độ, EXP, tâm trạng, tuổi hay chuỗi ngày chăm sóc**. Nên panel không
vẽ mấy thứ đó, và nói rõ vì sao.

Hai chi tiết kỹ thuật đáng nói:

- **Dáng do Dashboard tự tính.** Gateway không bao giờ gửi dáng: `pet.cells`
  nhận dáng làm **tham số đầu vào**, còn `pet.info` không có trường dáng nào.
  Em chép đúng thang ưu tiên của `agent/pet/state.py` để pet ở Dashboard và pet
  ở terminal luôn khớp nhau.
- **Không tải lại ảnh mỗi lần.** Spritesheet nặng vài MB; `pet.info` nhận
  `knownRevision` và trả `spritesheetUnchanged` khi trùng. Không tôn trọng cái
  đó là mỗi lần poll tải lại cả tấm atlas.

### 2. Hỏi thêm / hỏi nền

`prompt.btw` đọc được **toàn bộ** cuộc trò chuyện nhưng **không ghi gì vào đó**
— hỏi xong hội thoại vẫn y nguyên.

`prompt.background` thì **tên dễ gây hiểu nhầm nhất trong cả gói**. Nó không
chạy cuộc trò chuyện này ở nền: nó dựng một agent **hoàn toàn mới, không được
nạp một dòng lịch sử nào**. Nên nút ghi rõ "phiên riêng" và có một dòng cảnh
báo ngay bên dưới.

Cả hai đều trả `ok` ngay rồi **báo lỗi bằng chính nội dung câu trả lời**, tiền
tố `error:`. Không có trường status nào để đọc, nên Dashboard phải dò tiền tố —
không dò thì stack trace hiện ra như thể là câu trả lời.

### 3. Lái lượt / đổi hướng

`session.redirect` có kiểm tra lượt đang chạy và trả `rejected` khi không có.
`session.steer` thì **không**: nó nhận lệnh cả khi phiên đang rảnh, trả
`queued`, rồi câu đó **âm thầm chui vào nhóm công cụ của lượt kế tiếp** mà
không để lại dấu vết nào trong transcript. Đó là cái bẫy thật, nên Dashboard tự
chặn ở phía client: chỉ bật khi có lượt đang chạy.

Một chỗ nữa: trong lúc công cụ đang chạy, Hermes **hạ cấp redirect thành steer**
nhưng vẫn trả `"redirected"`. Không có trường nào phân biệt, nên câu thông báo
không dám hứa là đã cắt được lượt.

### 4. Nén hội thoại

`session.compress` trả về **bốn hình dạng khác nhau**, và chỉ một cái có trường
`status` — bản khoá-đang-giữ dùng `compressed` và không có `status` nào cả.
Ba trong năm nhánh headline là **thất bại nhưng vẫn trả ok**. Nên Dashboard hiện
thẳng `summary.headline` của server chứ không tự suy ra chữ từ mấy con số:
"từ chối vì bản tóm tắt còn dài hơn bản gốc" và "không có gì để nén" có cùng
con số nhưng khác hẳn ý nghĩa.

Nén **không hoàn tác được** — không có RPC nào bỏ nén, và `/undo` sau đó chỉ
lùi được phần tóm tắt. Nút có hỏi lại và nói đúng câu đó.

### 5. Lùi 1 lượt / tách nhánh

`session.undo` **không nhận tham số số lượt** — bảng lệnh ghi `/undo [N]` là của
CLI, RPC của gateway chỉ lùi đúng một lượt. Và nó **không đụng tới file** Hermes
đã ghi, nên nút nói rõ vậy.

`session.branch` chép cả hội thoại sang phiên mới, bản gốc vẫn sống. Nó **không
có busy guard**, tách giữa lượt là dính nửa lượt — Dashboard tự chặn.

### 6. Checkpoint

Xem danh sách, so diff, khôi phục. Bốn chỗ phải nói thật:

- **Mặc định là TẮT.** Gateway của Dashboard đọc biến môi trường
  `HERMES_TUI_CHECKPOINTS` và **bỏ qua `checkpoints.enabled` trong
  config.yaml**. Panel nói đúng câu đó thay vì hiện danh sách rỗng trông như
  hỏng.
- **Nhãn luôn rỗng.** RPC đọc `c.get("message")` trong khi manager ghi `reason`
  — nên mọi checkpoint về với `message: ""`. Không cứu được, nên panel chỉ hiện
  giờ và hash chứ không giả vờ có mô tả.
- **Diff bị cắt ở 4000 ký tự, không dấu báo**, và lỗi bị nuốt thành diff rỗng —
  không phân biệt được với "không có gì đổi". Cả hai đều được nói ra.
- **Khôi phục nguy hiểm hơn cái tên.** Đường này gọi `restore(safe=False)`,
  tức **ghi đè cả những file anh tự sửa tay** (messaging gateway thì dùng
  `safe=True`, và phần trợ giúp slash mô tả cái đó chứ không phải cái này). Và
  khôi phục cả thư mục luôn xoá **đúng 1 lượt** hội thoại, bất kể anh chọn
  checkpoint nào. Nên panel để **khôi phục từng file** lên trước — đường đó
  không đụng hội thoại — còn nút khôi phục cả thư mục thì hỏi lại kèm đủ hai
  cảnh báo.

### Lỗi thứ năm của Hermes

Nghiên cứu phần `session.branch` lòi ra thêm một lỗi cùng họ với lỗi phiên
agent phụ hồi v2.24.0: **nhánh cũng là phiên con**, và là con mới nhất, nên
`_session_latest_descendant` đi theo nó. Mở phiên gốc từ danh sách sau khi tách
nhánh là bị đổi sang nhánh.

Mà nhánh không phải "cuộc trò chuyện được nối tiếp" — Hermes để phiên gốc sống
nguyên và `list_sessions_rich()` **cố ý hiện cả hai như hai dòng ngang hàng**.
Nên bộ lọc giờ chặn thêm `_branched_from`, cả trong `Patch-HermesCore.py` lẫn
lớp phòng thủ phía client. `Test-HermesSessionTree.py` có thêm ca kiểm tra này.

Bản vá cũng **dò theo nội dung bộ lọc chứ không theo dấu mốc nữa**: máy đang
chạy v2.28.0 mà chỉ nhìn dấu mốc thì sẽ báo "đã có sẵn" và không bao giờ nhận
được điều kiện mới — nâng cấp im lặng thành không làm gì. Đã kiểm cả hai đường:
vá mới từ bản gốc, và nâng cấp từ bản v2.28.0.

## v2.28.0 — khung chat tự cuộn, ô chọn profile hết trắng, đổi model từng thành viên

### 1. Khung chat Rooms có thanh cuộn riêng

Trước đây nội dung dài là phải cuộn **cả trang** mới với tới ô soạn tin.

Nguyên nhân không nằm ở CSS của trang Nhóm — chỗ đó đã có sẵn `min-height: 0`
và `overflow-y: auto` từ v2.27.0. Vấn đề là **chuỗi chiều cao bị đứt ở tầng
trên**: `App.tsx` chỉ cấp khung bọc `flex-1 min-h-0` cho `/chat` và `/docs`,
nên với `/rooms` thì `height: 100%` rơi về `auto` và `overflow-y: auto` không
bao giờ kích hoạt. Giờ `/rooms` được tính là route full-height như hai route
kia. Tiêu đề, thanh trạng thái, hàng chờ duyệt và ô soạn tin đứng yên; chỉ
mình khung tin nhắn cuộn.

### 2. Ô chọn profile: lần này sửa đúng chỗ

Bản v2.26.1 em sửa hụt, và lý do đáng ghi lại. Em tô nền bằng
`--hermes-max-panel-strong`, tưởng nó là "màu panel tối". Thật ra nó là

```
color-mix(in srgb, var(--midground-base) 8%, var(--background-base))
```

tức màu panel cho **thân trang**, mà thân trang Ivory Graphite là ivory
`#F4F4F1`. Tệ hơn: bên trong `.hermes-max-sidebar`, `--midground-base` bị ghi
đè thành `#f4f4f1` (cho chữ sáng trên nền tối) nhưng `--background-base` thì
**không** — nên phép trộn ra "trắng pha trắng". Chữ thì `--foreground-base` =
`#ffffff`. Trắng trên trắng, lần thứ hai.

Bài học: trong thanh trái tối, các token gốc mô tả thân trang sáng chứ không
mô tả chỗ đó. Giờ ghi thẳng màu như chính `.hermes-max-sidebar` vẫn làm, thay
vì trộn từ token rồi đoán kết quả.

### 3. Đổi model của từng thành viên, ngay ở cột phải

Mỗi thành viên có một nút model; bấm vào là tìm và chọn trong toàn bộ danh
sách model của profile đó.

**Một điều phải nói thẳng trước khi anh bấm:** Hermes **không có model riêng
theo từng phòng**. Em đã đọc kỹ trước khi làm:

- Thành viên chỉ lưu đúng `{member_id, profile, handle}`. Bộ kiểm tra roster
  (`_exact_fields`) **từ chối thẳng** mọi khoá lạ, và bảng `hosted_rooms`
  không có cột model nào.
- Cả 18 RPC `groups.*` không cái nào đụng tới model.
- Model lấy từ `config.yaml` của chính profile: driver tạo phiên thành viên
  **không kèm override** ("Create a session without model or provider
  overrides"), nên nó rơi về `model.default`.

Nên nút này ghi vào `PUT /api/profiles/{name}/model` — **đổi cho cả profile**,
áp dụng luôn ở mọi phòng khác và cả khi nhắn riêng. Panel nói đúng câu đó
trước khi anh chọn, kèm đếm số phòng khác sẽ bị ảnh hưởng.

Có một đường **riêng theo phòng** về mặt kỹ thuật (resume phiên ẩn
`Group: <room_id>` rồi `config.set` kèm `session_id`), nhưng em cố tình không
dùng: nó chỉ sống tới lần khởi động lại gateway —
`_stored_session_runtime_overrides` trả `{}` cho phiên room-plumbing **có
chủ ý**, để chúng "luôn dựng lại từ config HIỆN TẠI của profile". Một cài đặt
tự âm thầm quay về cũ còn tệ hơn một cài đặt có phạm vi rõ ràng.

**Khi nào có hiệu lực:** ngay ở **lượt nói kế tiếp** của thành viên đó, không
cần khởi động lại. Phiên thành viên là phiên bền (`Group: <room_id>`, resume
mỗi lượt), nhưng mỗi lượt đều chạy `_sync_agent_model_with_config` đọc lại
`model.default` và hoán model của agent đang sống. Vì vậy dòng trạng thái ghi
"áp dụng từ lượt nói kế tiếp" chứ không ghi "đã đổi xong" — lượt đang chạy
vẫn giữ model cũ.

## v2.27.0 — Phòng thảo luận ba cột, thu gọn được, chữ to hơn

Giao diện **Nhóm** dựng lại theo đúng ảnh mẫu anh gửi: ba cột.

**Cột trái — danh sách phòng, thu gọn được.** Nút mũi tên ở mép cột gấp nó lại
để nhường hết chiều ngang cho khung chat, và lựa chọn đó được nhớ (localStorage
`hermes-max-rooms-rail`) nên không phải gấp lại mỗi lần vào. Trong cột có nút
**Tạo phòng**, ô **Tìm phòng**, và mỗi phòng là một thẻ có avatar chồng, tên
phòng, danh sách thành viên và số thứ tự tin nhắn mới nhất.

**Cột giữa — cuộc thảo luận.** Ô soạn tin cao hơn hẳn (`4.5rem`) và cỡ chữ tin
nhắn tăng lên `0.9rem`, giãn dòng `1.66` — đúng hai chỗ anh kêu nhỏ. Thanh tiêu
đề có đổi tên phòng tại chỗ, tìm trong phòng, và nút kết thúc phòng có hỏi lại.

**Cột phải — ai đang ở trong phòng.**

### Bốn chỗ em cố tình không làm giống ảnh mẫu

Ảnh mẫu là ảnh của một app chat có người thật. Hermes lưu một thành viên đúng
ba trường `{member_id, profile, handle}`, nên:

1. **Avatar là chữ cái sinh ra từ handle**, màu cố định theo handle — không phải
   ảnh chân dung của một người không tồn tại.
2. **Dòng dưới tên là `description` của chính profile đó**, do anh tự viết khi
   tạo profile. Chỗ ảnh mẫu ghi "Nghiên cứu" / "Kỹ thuật" thì để trống nếu
   profile không tự mô tả — Hermes không gán vai cho ai trong phòng cả.
3. **Không có chấm xanh "đang online" cho từng thành viên.** `driver_status` chỉ
   báo `working` / `blocked` cho **cả phòng**, không có gì theo từng người. Thứ
   biết được là ai nói ở vòng nào, nên đó là thứ được hiện.
4. **Thẻ "Cách phòng này chạy" không có nút chỉnh sửa.** Ba mức 3 vòng / 10 tin
   / tự kết thúc là hằng số biên dịch cứng trong `hosted_room_discussion.py`,
   client không đặt được.

### Sửa một lỗi của chính gói này, do Nous cập nhật mà lộ ra

Ngày 02/09/2026 Nous thêm một khoá dịch mới (`sessionExpiredNoError`) vào
`web/src/i18n/types.ts`. Gói này trước giờ **chép đè cả file đó** — chỉ để thêm
đúng một dòng `| "vi"` — nên bản chép đè kéo file về bản cũ và làm **cả 16 ngôn
ngữ khác không biên dịch được**.

Đây đúng con lỗi mà `Patch-HermesCore.py` sinh ra để tránh, và trước đây đã dính
một lần với `tools/approval.py`. Nên `types.ts` và `context.tsx` chuyển hẳn sang
**vá tại chỗ**, không chép đè nữa.

Nhân tiện dời luôn chỗ đặt "mặc định tiếng Việt". Trước đây nó sửa thẳng
`getInitialLocale()` trong `context.tsx`, và hệ quả là **làm hỏng bài kiểm thử
của chính Nous** (`OAuthLoginModal` tìm nút "Retry", nhận được "Thử lại"). Chọn
ngôn ngữ cho lần mở đầu tiên là quyết định của **ứng dụng**, không phải của thư
viện dịch — nên giờ nó nằm ở `web/src/main.tsx`, nơi ứng dụng khởi động và không
bài kiểm thử đơn vị nào nạp tới. Nhờ vậy `getInitialLocale()` giữ nguyên bản
gốc, **mã chạy thật và mã chạy test là một**, và bộ test của Nous xanh trở lại:
785/785 trên bản `origin/main` mới nhất, 27 cảnh báo lint — **đúng bằng số cảnh
báo của Hermes gốc**, tức gói này không thêm nợ lint nào.

Bản vá cũng khá hơn ở một điểm: nó **không đè lên ngôn ngữ anh đã tự chọn** nữa.
Trước đây lần chạy đầu ghi đè thẳng thành `vi`; giờ chỉ đặt `vi` khi anh chưa
từng chọn ngôn ngữ nào.

### Hai lỗi của Hermes vẫn còn nguyên trên `origin/main` hôm nay

Đã kiểm lại sau đợt Nous sửa lớn `web_server.py` (+461 dòng):

- `Test-HermesPermissions.py` → `HERMES_PERM_FAIL` (thu hồi quyền không ăn)
- `Test-HermesSessionTree.py` → `HERMES_TREE_FAIL` (nhảy vào phiên phụ)

Cả hai vẫn đáng gửi PR ngược lên Nous.

## v2.26.1 — nút tạo phòng nói ra lý do, và ô chọn profile hết trắng

Hai lỗi lộ ra ngay khi anh Haruto tạo profile thứ hai và thứ ba.

**Nút "Tạo phòng" bấm không được mà không nói gì.** Nó bị khoá vì chưa điền
**Tên phòng** — gateway bắt buộc trường đó — nhưng danh sách lỗi phía trên chỉ
kiểm danh sách thành viên, nên tên trống không hiện ra chỗ nào. Một nút bị khoá
không kèm lý do thì nhìn hệt như nút hỏng. Giờ tên trống là một dòng lỗi như mọi
điều kiện khác, nút bị khoá có mờ đi thấy rõ, và khi đủ điều kiện thì có dòng
"Đủ điều kiện — bấm tạo phòng."

**Ô chọn profile trên thanh trái trắng tinh.** Control này của Nous chỉ hiện khi
có **từ 2 profile trở lên**, nên nó nằm im suốt từ đầu tới giờ và chỉ lộ ra đúng
lúc anh tạo thành viên cho phòng Nhóm. Nó dùng token `bg-background`, mà trên
nền thanh trái tối của Ivory Graphite thì thành chữ trắng trên nền trắng.
Đã tô lại cả ô lẫn danh sách xổ xuống theo màu của theme.

## v2.26.0 — bảng hỏi lại của Hermes hiện ngay trong khung chat

Khi Hermes cần một quyết định nó không nên tự quyết, nó gọi công cụ `clarify` —
và công cụ đó **chặn cả lượt trả lời** cho tới khi có câu trả lời. Terminal vẽ
ra thành bảng `ask N questions`; Dashboard **không vẽ gì**, nên khung chat cứ
đứng khựng giữa chừng mà không có cách nào gỡ. Cùng một lỗi với hộp xin quyền
hồi v2.20, cùng một nguyên nhân.

### Giao thức

Một sự kiện, hai dạng — `_clarify_block` trong `tui_gateway/server.py`:

- Một câu: `{request_id, question, choices[], multi_select?}`
- Nhiều câu: `{request_id, questions: [{qid, question, choices[], multi_select}]}`

Trả lời bằng `clarify.respond {request_id, question_id?, answer}`. Với bảng
nhiều câu, **mỗi câu trả lời riêng theo `qid`**, server trả về `remaining[]`, và
**khoá câu cuối chính là nút gửi** — không có lệnh submit nào khác. Câu đã chốt
vẫn sửa được cho tới khi cả bảng xong (server cố ý cập nhật tại chỗ), nên thẻ
cho phép gửi lại thay vì khoá cứng.

### Hai chỗ dễ gửi sai định dạng

- **Chọn một**: gửi **nguyên văn nhãn**, kể cả đuôi `(Recommended)` — chính công
  cụ chạy `strip_recommended` ở đầu bên kia. Giao diện hiện nó thành huy hiệu
  *"Hermes gợi ý"* nhưng gửi đi thì không đụng vào.
- **Chọn nhiều**: gửi **mảng JSON** các nhãn. `_parse_multi_select_response`
  nhận cả chuỗi ngăn phẩy, nhưng một nhãn có thể chứa dấu phẩy — mảng JSON là
  dạng duy nhất không cắt nhầm.

Lựa chọn `Other (type your answer)` biến thành ô nhập thật, chứ không phải một
nút bấm vào không làm gì.

### Một chỗ nói thẳng

Khác với xin quyền, **không có RPC `clarify.pending`** để hỏi lại khi mở trang.
Chỉ có phát lại sự kiện (`session.events.since`) và chỉ trong lúc nó còn trong
vòng đệm. Nên nếu Hermes hỏi trước khi anh mở Dashboard thì thẻ có thể không
dựng lại được — lúc đó vẫn phải sang tab Terminal. Em không giấu chuyện đó.

## v2.25.0 — Phòng thảo luận: agent nói chuyện với nhau, và anh nói cùng

Đây là chỗ **duy nhất** trong Hermes mà các agent thật sự trao đổi với nhau,
chứ không phải báo cáo về một agent cha. Trước đó bản v2.21.0 dựng trang Nhóm
**chỉ để xem** — giờ ghi được.

### Một đính chính

v2.21.0 để read-only với lý do "giao thức còn đổi, create/send/approve là chỗ
sẽ churn". Đọc kỹ lại mã thì ngược lại: **không có một dấu `TODO`, `FIXME`,
`experimental` hay feature-flag nào** trong toàn bộ các module hosted-room;
validate từng trường rất chặt, có idempotency và authority fencing. Đó là code
đã đóng băng.

Ngoại lệ thật sự chỉ có một: `groups.promote`/`demote` (chuyển quyền điều
phối). Chính `gateway/hosted_room_replicas.py` ghi *"an explicit user action
today; a lease/quorum driver later"*. Cặp đó **không có nút** ở đây.

### Làm được gì

- **Tạo phòng** — chọn 2–6 profile làm thành viên. Handle tự sinh từ tên
  profile (lọc đúng bộ ký tự gateway chấp nhận), tự tránh trùng, và kiểm luôn
  các luật thật: `all`/`everyone` bị Hermes giữ riêng, không trùng profile,
  không trùng handle.
- **Xem agent thảo luận** — dòng hội thoại đọc như chat: ai nói, vòng mấy, lúc
  nào. Sự kiện bookkeeping bị lọc đi (mỗi tin của thành viên kèm một
  `turn.settled` rỗng), nhưng **thành viên chọn im lặng thì vẫn hiện** — im
  lặng cũng là một câu trả lời.
- **Anh nhắn vào phòng** — có nút chèn nhanh `@handle`, Enter để gửi.
- **Gỡ khi kẹt** — `pending_actions` cho ra nút thật: *Cho phép một lần* /
  *Từ chối* (`groups.approve` chỉ nhận đúng hai lựa chọn này), và *Thử lại*
  (`groups.retry`) cho lượt bị hoãn. Lượt hoãn **không tự khỏi** — nó nằm đó
  chờ người bấm.

### Ba điều nói thẳng trong giao diện

1. **Thảo luận có biên**: tối đa 3 vòng, 10 tin nhắn. Hết biên phòng tự đóng và
   panel ghi rõ lý do là *thiết kế*, không phải hỏng.
2. **Chạy nội bộ không cần cấu hình gì**: thành viên chỉ là profile trên máy
   này. Dòng "nối phòng giữa các máy: tắt" trước đây trông như lỗi — thật ra
   nó không chặn gì cả, và giờ panel nói đúng như vậy.
3. **Phải poll**: không có một `_emit` nào trong mã hosted-room, và mỗi thành
   viên chạy trong phiên ẩn không lộ id, nên không có gì để đăng ký nghe.
   Nhịp poll (1.2s khi đang chạy, 6s khi rảnh) là **của mình tự chọn** —
   runtime không quy định.

## v2.24.0 — sửa lỗi mất nhánh hội thoại chính (lỗi của Hermes, không phải overlay)

Anh Haruto chỉ ra: cài lại Dashboard xong là mất nhánh phiên chính, chỉ còn một
phiên phụ. Đúng, và đây là nguyên nhân thật.

### Lỗi

`hermes_cli/web_server.py::_session_latest_descendant` chạy một truy vấn đệ quy
đi xuống **mọi** phiên con theo `parent_session_id`, sắp theo `started_at`, rồi
lấy con mới nhất. **Không lọc gì cả.** Dashboard gọi nó mỗi lần mở
`?resume=<id>` rồi tự ghi đè URL sang phiên đó.

Chú thích của chính hàm ấy nói rõ mục đích: *"/model may create child sessions.
Dashboard refresh should continue the newest child instead of reopening the old
parent."* — nó sinh ra để đi theo **phiên nối tiếp khi đổi model**.

Nhưng **phiên của một agent phụ cũng là con**, và ngay sau một lô delegation thì
nó là con **mới nhất**. Nên Dashboard đi thẳng vào bản ghi riêng của agent phụ:
URL âm thầm đổi, cuộc trò chuyện thật biến mất khỏi khung chat, còn tab Terminal
— đọc thẳng PTY chứ không đọc kho phiên — vẫn hiện đầy đủ. Hai mặt của "cùng một
phiên" mà nội dung khác hẳn nhau. Đây cũng chính là thứ gây ra cái ô JSON lạ hoắc
mà anh gặp ở v2.22.

Lỗi này nằm trong Hermes gốc, nên **Dashboard của Nous cũng dính y hệt** với bất
kỳ ai dùng `delegate_task`.

### Sửa ba lớp

1. **Vá lõi** — thêm bộ lọc vào chính truy vấn đệ quy: bỏ qua con có
   `model_config._delegate_from` và con `source = 'tool'`. Đúng hai dấu hiệu mà
   `list_sessions_rich()` đang dùng để giấu các phiên đó khỏi danh sách — truy
   vấn này chỉ là chưa bao giờ áp dụng chúng. Vá tại chỗ, không chép đè file.
2. **Chặn phía Dashboard** — trước khi đổi `?resume=`, hỏi lại phiên đích và từ
   chối nhảy vào phiên agent phụ hoặc phiên công cụ. Chạy được kể cả trên bản
   Hermes chưa vá; không xác minh được thì đứng yên, vì ở lại phiên người dùng
   chọn luôn là chỗ an toàn.
3. **Bài tự kiểm mới** `Test-HermesSessionTree.py` — dựng đúng hình cây đó trong
   SQLite rồi chạy **chính truy vấn đang nằm trong web_server.py**: phải đi theo
   con nối tiếp, phải bỏ qua con của agent phụ. Bài này **trượt trên bản chưa
   vá**, nên nó thật sự phân biệt được.

### Xem hội thoại riêng của agent phụ

Ý tưởng cây phiên của anh giải đúng nửa còn lại: làm sao **đọc được** phiên phụ
mà không đánh mất phiên chính. Phòng họp Agents đã có sẵn `child_session_id`
trên mọi sự kiện, nên giờ chọn một agent là có thêm tab **Hội thoại riêng** —
đọc thẳng phiên của chính agent đó, chỉ tải khi bấm vào.

Không dựng cây trong thanh phiên: kho phiên **cố ý** giấu phiên agent phụ khỏi
danh sách, và API REST không có tham số nào để lấy chúng ra kèm quan hệ cha–con
mà không phải gọi thêm mỗi phiên một lần. Đọc qua Phòng họp là đường đã có dữ
liệu thật, không phải đoán.

Một điểm anh đoán hơi lệch, nói cho rõ: `3 sessions` trên thanh terminal là
`session.active_list` — ba **phiên gateway đang sống** trong tiến trình PTY,
không phải 1 chính + 2 phụ trong kho phiên. Hai trục khác nhau.

## v2.23.2 — sửa ba chỗ chồng chữ, và gấp gọn thông báo nội bộ

Ba lỗi bố cục của v2.23.0, hai nguyên nhân khác nhau:

- **Nút trên đầu panel bị chữ đè lên.** Khung chat có một badge trạng thái
  `position: absolute; z-index: 3` ghim ở góc trên phải — đúng chỗ hàng nút của
  Phòng họp Agents vừa dọn vào. Panel giờ nằm trên nó (z-index 4); trạng thái
  luồng vẫn hiện ở thanh công cụ phía trên nên không mất gì.
- **Nút "Ngưng giao việc mới" bị cắt cụt.** Hàng nút giờ co và xuống dòng được,
  nhãn cũng rút ngắn lại.
- **Cây agent ở bảng phải đè lên danh sách phiên.** v2.23.0 nhét nó vào khoang
  "MÔ HÌNH HIỆN TẠI", mà khoang đó `shrink-0` — cây dài ra là tràn xuống đè lên
  khoang dưới. Giờ nó là một khoang riêng, tự cuộn khi quá 14rem.

**Thông báo nội bộ không còn nằm trong bong bóng của anh nữa.** Khi một lượt
giao việc chạy nền xong, Hermes tự chèn báo cáo `[ASYNC DELEGATION BATCH
COMPLETE — ...]` vào phiên. Agent cần đọc nó nên không được xoá — nhưng Hermes
đã đánh dấu sẵn `display_kind: internal_notification` để giao diện biết đấy
không phải anh gõ, mà Dashboard vẫn vẽ nó vào bong bóng "Anh". Giờ nó gấp lại
thành một dòng tiếng Việt ("3 agent phụ chạy nền đã xong · 28 giây"), bấm vào là
mở ra nguyên văn.

## v2.23.1 — sửa lỗi v2.23.0 làm bão render cả trang

Lỗi của em ở v2.23.0. Phòng họp Agents đẩy state lên `ChatPage` **sau mỗi sự
kiện `subagent.*`** — mà một agent con đang chạy thì bắn `thinking`/`tool` liên
tục. Thành ra mỗi phút là hàng trăm lần render lại **toàn bộ trang gốc**, mà
trang gốc thì đang chứa khung chat, terminal, danh sách phiên, **và cả sidebar
đang tự giữ một kết nối gateway riêng cùng một phiên phụ để lấy tiêu đề**.

Triệu chứng: đang chạy agent phụ thì khung chat mất tiêu đề phiên và không nạp
được bản ghi hội thoại — chỉ còn lại luồng trực tiếp, nên nội dung bên Chat và
bên Terminal khác hẳn nhau dù cùng một phiên.

Sửa: state đẩy lên trang được **hãm còn 1 giây một lần**. Bảng bên phải chỉ để
liếc nên 1 giây là quá đủ; còn panel Phòng họp Agents vẫn đọc thẳng state không
hãm nên vẫn mượt như cũ. Có test chặn: 40 khung sự kiện không được biến thành 40
lần cập nhật trang.

## v2.23.0 — Phòng họp Agents: nhìn thấy Hermes đang điều phối ai

Khi Hermes giao việc cho agent phụ, nó dựng **agent con thật** chạy trên luồng
riêng và phát về phiên cha một loạt sự kiện `subagent.*`. Dashboard **đã nhận đủ
mọi khung sự kiện đó từ trước tới giờ** — và bỏ hết. Ba agent làm việc, khung
chat chỉ hiện một con quay tròn.

Bản này thêm khu **Phòng họp Agents**, chỉ hiện khi thật sự có agent phụ.

### Dữ liệu đi từ đâu tới

Không có gì tự chế. Hai nguồn, cả hai đều có sẵn trong Hermes v0.21.0:

- **Sự kiện trực tiếp** — `subagent.spawn_requested / start / thinking / tool /
  progress / complete`, đi chung đường `/api/events` và `session.events.since`
  mà khung chat đang dùng. Mỗi sự kiện mang sẵn `subagent_id`, `goal`, `model`,
  `depth`, `parent_id`, `child_session_id`, `tool_count`. Riêng
  `subagent.complete` mang thêm `status`, `summary`, `duration_seconds` và
  bảng token. **Không thêm một vòng polling nào.**
- **Ảnh chụp `delegation.status`** — hỏi **đúng một lần cho mỗi kết nối
  gateway**. Đây là đường khôi phục: tải lại trang, đổi phiên, hay gateway nối
  lại thì agent đang chạy dở vẫn hiện đủ, vì chúng không phát lại sự kiện spawn
  nữa. Vòng phát lại chạy 320ms/lần — hỏi ở đó mới đúng là "polling dày".

### Bốn chỗ em cố tình không làm giống ảnh mẫu

Ảnh anh gửi đẹp, nhưng bốn thứ trong đó Hermes **không có**. Vẽ ra thì đẹp hơn
mà là bịa:

1. **Các agent phụ không nói chuyện với nhau.** Hermes cô lập chúng hoàn toàn —
   mỗi con một hội thoại, một bộ công cụ, một kho phiên riêng, và `delegate_task`
   bị gỡ khỏi bộ công cụ của con theo mặc định. Chúng **chỉ báo cáo về Hermes
   chính**, không có kênh chung nào cả. Nên tab không gọi là "trao đổi" mà là
   **Diễn biến trực tiếp**: dòng việc thật của từng agent, xếp theo thời gian.
   Panel cũng ghi thẳng một dòng nói rõ điều này.
2. **Không có phần trăm tiến độ.** Không chỗ nào trong Hermes ước lượng một
   agent con đã đi được bao xa. Tín hiệu thật chỉ có **số lần gọi công cụ** và
   **đồng hồ** — nên thẻ hiện đúng hai thứ đó. Thanh màu chỉ nói "đang chạy /
   đã xong", không phải một tỉ lệ.
3. **Không có tên vai trò.** Agent con có `goal` và một id (`sa-0-dc0100f4`),
   không có chức danh. Trong runtime có trường `role` nhưng nó là cờ khả năng
   (`leaf` / `orchestrator`), không phải nghề nghiệp. Nên **nhãn của agent là
   chính nhiệm vụ của nó**, chứ không phải "Kiến trúc sư" hay "Lập trình viên".
4. **Token chỉ hiện khi agent xong.** Gateway gỡ đối tượng agent sống ra khỏi
   `list_active_subagents()`, và bảng token chỉ đi kèm `subagent.complete`. Nên
   lúc đang chạy trường token **vắng mặt**, không phải bằng 0.

### Nút nào bấm được thật

Chỉ hai — và cả hai đều gọi thẳng RPC có sẵn:

- **Dừng một agent** → `subagent.interrupt`. Panel không tự đánh dấu đã dừng;
  nó đợi Hermes phát `subagent.complete` với `status: interrupted`.
- **Tạm ngưng giao việc mới** → `delegation.pause`. Đây là **cổng sinh agent**,
  chặn Hermes giao việc cho agent MỚI; agent đang chạy không bị ảnh hưởng — và
  tooltip nói đúng như vậy.

**Không có nút tạm dừng trên từng thẻ agent**, vì Hermes không có lệnh tạm dừng
một agent đang chạy. Nút bấm vào không làm gì còn tệ hơn là không có nút.

Sao chép, xuất biên bản, theo dõi tự động, toàn màn hình đều là việc phía trình
duyệt nên chạy thật.

### Vòng đời

`đang chờ tới lượt` (spawn_requested — có thật, agent con có thể phải xếp hàng
đợi chỗ trống) → `đang làm việc` → `hoàn thành` / `thất bại` / `đã dừng` /
`quá giờ`. Trạng thái lạ không nằm trong danh sách thì tính là **thất bại**, chứ
không gói vào "xong" để giấu lỗi.

Không có trạng thái "đang chờ agent khác", vì các agent không phụ thuộc nhau.
Mất kết nối thì hiện băng báo ở panel, **không** đánh dấu agent là đã chết —
chúng vẫn đang chạy trong Hermes, chỉ là Dashboard tạm thời không nghe thấy.

### Bố cục

Hai cột từ 1100px, cột thẻ agent rộng hơn và thẻ xếp lưới từ 1800px (21:9), xếp
dọc trên màn hẹp. Gập lại được. **Không có agent phụ thì khung chat giữ nguyên
bố cục cũ, không chừa một khoảng trống nào.**

Bảng điều khiển bên phải có thêm cây **Agents đang chạy**, đọc **cùng một state**
với panel — không mở thêm kết nối gateway thứ hai, nên hai chỗ không thể nói
khác nhau.

## v2.22.0 — ô ngữ cảnh: biết cửa sổ còn bao nhiêu chỗ

Khung chat không trả lời được câu quyết định chất lượng của mọi câu trả lời tiếp
theo: **cửa sổ ngữ cảnh còn bao nhiêu chỗ.** Terminal có `/context`, thanh trạng
thái của TUI có sẵn phần trăm — Dashboard thì không có gì, muốn biết phải rời
khung chat.

Bản này thêm một ô nhỏ ngay trên thanh công cụ của khung chat: `78k/200k · 39%`,
kèm thanh màu đổi theo mức đầy (xanh → vàng → đỏ). Bấm vào thì mở bảng chi tiết.

### Số ở đâu ra

Không có phép tính nào của em cả. Gateway đã đếm sẵn và đưa qua hai đường, ô này
chỉ đọc lại:

- `session.usage` khi khung chat bắt được phiên — nên mở lại một phiên đã chạy cả
  tiếng vẫn thấy số ngay, chứ không phải chờ tới lượt trả lời kế tiếp.
- Trường `usage` đi kèm **mọi** sự kiện `message.complete` — nên sau mỗi lượt
  con số tự nhảy, không cần hỏi thêm lần nào.

### Chỗ em cố tình không đoán

**Không đo được thì nói là không đo được.** Hermes chỉ điền số khi có giá trị
chiếm dụng cửa sổ thật; với phiên chưa chạy lượt nào, hoặc engine không theo dõi
được cửa sổ, nó **cố ý bỏ trống** — chính Hermes từng có lỗi (#50421) vì đắp
tổng token cả phiên vào đó, ra những số vô lý kiểu 1.9m/120k. Nên ô này hiện
*"chưa đo được"*, không bao giờ tự bịa ra 0%.

Cùng lý do: một lượt bị ngắt giữa chừng không báo số, thì ô **giữ nguyên số cũ**
thay vì nhấp nháy về "chưa đo được" rồi quay lại.

**Không đoán ngưỡng nén.** Ngưỡng Hermes tự nén được quyết định sâu trong agent —
qua `_resolve_compression_threshold`, sàn nâng-riêng cho model cửa sổ nhỏ, một
mức trần token tuỳ chọn, rồi một lần tự nâng riêng cho Codex — và **không RPC nào
đưa nó ra ngoài**. Tự dựng lại chuỗi đó trong trình duyệt là đoán mò khoác áo con
số. Nên bảng chi tiết hiện giá trị **trong cấu hình**, ghi rõ là giá trị cấu hình
và Hermes có thể tự nâng cao hơn.

### Bảng chi tiết

- **Ngữ cảnh đang chứa gì** — hội thoại / lời nhắc hệ thống / định nghĩa công cụ /
  bộ nhớ / MCP…, mỗi mục một thanh. Lấy từ `session.context_breakdown`, và **chỉ
  hỏi khi anh mở bảng** — để trả lời nó gateway phải dựng lại lời nhắc hệ thống và
  ước lượng token cả lịch sử, quá nặng để hỏi liên tục.
- **Số lần Hermes đã tự nén** trong phiên này.
- **Tên lệnh thật của Hermes.** Đây là phần anh hỏi: bên Claude Code là
  `/compact`, còn Hermes gọi là **`/compress`** (may quá, `/compact` cũng chạy vì
  là tên gọi khác của nó). Bảng ghi luôn `/compress here 10` (chỉ nén phần cũ,
  giữ 10 lượt gần nhất) và `/context` (bảng đầy đủ trong Terminal).

Và điều đáng nói nhất: **Hermes tự nén, anh không phải canh.** Ô này chủ yếu để
anh nhìn thấy nó đang làm việc đó, chứ không phải để giao thêm việc cho anh.

## v2.21.0 — bắt kịp Hermes v0.21.0

Hermes v0.21.0 (423 commit) thêm ba thứ mà Dashboard chưa nhìn thấy được. Bản
này thêm bốn thứ để bắt kịp.

### 1. Trang **Nhóm** — xem được phòng chung mà v0.21.0 vừa mở ra

Tính năng lớn nhất của v0.21.0: nhiều gateway Hermes, có thể ở nhiều máy khác
nhau, cùng chia một phòng có nhật ký bền vững, có sao chép, và có cơ chế
chuyển quyền điều phối khi gateway chủ chết. Mười tám RPC mới, ~3.200 dòng mã —
**và không có giao diện web nào cả.** Ứng dụng desktop có plugin; Dashboard
không có gì. Phòng vẫn chạy trong gateway, chỉ là không ai nhìn thấy.

Trang mới hiện: phòng nào đang có, ai trong đó (kèm profile trả lời cho từng
người), gateway nào đang giữ quyền điều phối, quyền đó đã đổi tay mấy lần, và
nhật ký sự kiện gần nhất — mỗi loại sự kiện đều có tên tiếng Việt (đủ 17 loại
mà kho sự kiện cho phép ghi).

**Chỉ để xem, và đây là lý do.** Chính Nous ship kèm `groups.capabilities` để
thương lượng phiên bản giao thức — tức là họ tự dự là giao thức còn đổi. Phần
liệt kê / trạng thái / phát lại thì bị khoá chặt bởi lược đồ cơ sở dữ liệu nên
xây lên được ngay; còn tạo phòng / gửi tin / duyệt / thử lại là chỗ sẽ đổi, nên
để sau còn hơn ship nút bấm rồi hỏng ở lần `hermes update` kế tiếp.

Gateway cũ hơn v0.21.0 từ chối thẳng lệnh này — trang hiện *"Gateway này chưa có
tính năng Nhóm"*, không phải một lỗi đỏ.

### 2. Trang **Sức khoẻ lịch** — `hermes cron doctor` lên màn hình

v0.21.0 thêm `hermes cron doctor` vì một việc đã hẹn giờ có thể chết mà nhìn vẫn
như thường: bộ hẹn giờ tắt, `next_run_at` nằm lì trong quá khứ, mà việc vẫn hiện
"đang bật". Anh chỉ phát hiện khi tự hỏi sao lâu rồi không thấy báo cáo.

Trang mới chạy đúng bộ kiểm tra đó, trên đúng các trường đó, bằng tiếng Việt,
ngay cạnh danh sách việc: lần chạy hỏng (kèm lý do), gửi kết quả hỏng, việc đang
bật mà không có giờ chạy kế tiếp, việc quá giờ chạy quá 15 phút, và việc chạy
chế độ không-agent mà chẳng có script nào.

**Hai mục nó không tự nhận là kiểm được**: file script có tồn tại không, thư mục
làm việc có tồn tại không — trình duyệt không đọc được ổ đĩa. Trang ghi rõ hai
mục đó bị bỏ qua và `hermes cron doctor` mới kiểm đủ sáu, thay vì im lặng rồi
báo "mọi thứ ổn" trong khi chưa kiểm hết.

### 3. Cảnh báo khi một lượt bị kẹt

v0.21.0 thêm `agent.turn_liveness`: nếu một lượt 10 phút không nhúc nhích, Hermes
tự huỷ nó. Trước đây Dashboard chỉ hiện con quay tròn — anh không biết là nó
đang nghĩ hay đã chết.

Giờ gateway phát cảnh báo nào (kẹt, bị canh chừng huỷ, hay bản ghi hội thoại phải
sửa lỗi nhiều lần) thì khung chat hiện đúng câu tiếng Việt tương ứng, kèm nút
**Dừng lượt này**.

### 4. 50 dòng chờ, mỗi dòng một emoji

Từ 20 lên 50, hài hơn, và mỗi dòng mở đầu bằng một emoji khác nhau — hai dòng
liền nhau không bao giờ trùng emoji.

### Cũng trong bản này

Dịch nốt `gateway.resume.all_requires_admin` — khoá tiếng Anh duy nhất còn sót
mà v0.21.0 thêm vào. `vi.yaml` giờ khớp 100% với `en.yaml` của v0.21.0
(368 khoá), và bảng mô tả quyền vẫn phủ đủ 113/113 loại trên bản mới.

## v2.20.0 — hộp xin quyền hiện ngay trong khung chat, bằng tiếng Việt

Khi Hermes gặp lệnh nguy hiểm, nó **chặn luồng agent lại và chờ**. Hộp hỏi đó do
giao diện Ink vẽ, nên trên Dashboard nó chỉ hiện ở tab **Terminal** — tiếng Anh,
và chỉ bấm được bằng bàn phím. Ai đang ngồi ở tab Chat thì chỉ thấy câu trả lời
tự nhiên đứng im, không hiểu vì sao.

Gateway có phát sự kiện `approval.request` và nhận câu trả lời qua
`approval.respond`, nên bản này dựng lại hộp đó **ngay trong khung chat**:

- **Tiếng Việt, và giải thích đúng việc.** Phần mô tả lấy thẳng từ bảng 113 loại
  quyền đã dịch ở v2.18 — nên `recursive delete` hiện thành *"Xoá đệ quy cả thư
  mục con (rm -rf) — không khôi phục lại được."*, `execute_code` hiện thành
  *"Chạy mã tuỳ ý bằng execute_code — không đi qua cổng duyệt lệnh terminal."*
  Loại nào chưa có trong bảng thì dùng câu gốc của Hermes.
- **Bốn nút bấm được**, mỗi nút nói rõ cái giá của nó: *Cho phép một lần* ·
  *Cho phép phiên này* · *Luôn cho phép* (ghi vĩnh viễn vào danh sách quyền) ·
  *Từ chối*. Hermes cho phép mấy lựa chọn thì hiện đúng mấy — lệnh bị tirith gắn
  cờ chẳng hạn sẽ không có "Luôn cho phép".
- **Hiện nguyên câu lệnh** trong khung cuộn được, gấp lại sau 12 dòng.
- **Viền đỏ cho loại rất nguy hiểm**, viền vàng cho phần còn lại.

**Cùng một hàng đợi, hai mặt.** Trả lời ở đây là gỡ chặn đúng luồng agent mà hộp
ở Terminal sẽ gỡ — giống hệt cách khung chat và PTY dùng chung một phiên. Bấm
bên nào trước thì bên kia tự biến mất.

Ba chỗ em làm kỹ vì đây là lúc agent đang bị treo:

- Mở khung chat lúc Hermes **đã** đang chờ sẵn (hoặc vừa tải lại trang) thì
  không có sự kiện nào tới nữa — nên Dashboard hỏi thẳng `approval.pending` khi
  bắt được phiên, để không bỏ sót một agent đang đứng im.
- **Gửi trả lời hỏng thì thẻ vẫn nằm nguyên** kèm lý do và nhắc anh sang tab
  Terminal. Giấu mất lối gỡ chặn duy nhất là hậu quả tệ nhất có thể có.
- Đổi phiên hoặc phiên bị dựng lại thì thẻ đọc lại từ hàng đợi của phiên mới,
  chứ không giữ thẻ cũ.

Sau khi trả lời, dòng xác nhận hiện ngay dưới ô soạn — và nếu anh chọn "Luôn cho
phép" thì nó nhắc luôn là có thể thu hồi ở bảng **Quyền & phê duyệt**.

**Chưa làm:** hộp trong tab Terminal vẫn tiếng Anh — chữ nằm cứng trong mã Ink
(`ui-tui/`), phải vá thêm và nó có bước build riêng. Giờ thì anh không cần đụng
tới nó nữa, nên em để lại sau.

## v2.19.1 — sửa lỗi cài hỏng khi Hermes lên bản mới

Cài v2.19.0 lên một bản Hermes mới hơn thì **đứt giữa chừng**:

```
HERMES_VI_FAIL: vi.yaml thieu 1 khoa, vi du: ['gateway.resume.all_requires_admin']
Bộ dịch tiếng Việt không đạt kiểm tra (exit code 1)
```

Bản Hermes mới thêm câu thông báo mới vào `en.yaml`, gói chưa dịch câu đó, và
installer coi đó là lỗi nghiêm trọng nên khôi phục hết rồi báo lỗi. Cơ chế khôi
phục chạy đúng — Dashboard cũ không hề hấn gì — nhưng **lẽ ra không được đứt
ngay từ đầu**. Thiếu một câu dịch thì Hermes tự hiện câu đó bằng tiếng Anh, có
gì hỏng đâu.

Bản này sửa **ba** thứ, và cái thứ hai mới là cái đáng lo nhất:

**1. Bù khoá dịch tự động.** `Patch-HermesCore.py` (mới) đọc `en.yaml` của
chính bản Hermes đang cài, thấy khoá nào `vi.yaml` chưa có thì bổ sung, tạm giữ
nguyên câu tiếng Anh. Khoá nào Hermes đã bỏ thì gỡ theo. Nên bộ dịch luôn khớp
100% dù anh lên bản Hermes nào, và bộ test parity của chính Hermes cũng không
đỏ. Installer in ra đã bù bao nhiêu khoá, để bản sau em dịch nốt.

**2. Không ghi đè file lõi nữa** — đây là lỗi nặng hơn, may là chưa gây hậu quả.
v2.17.0–v2.19.0 chép đè nguyên `agent/i18n.py` và `tools/approval.py` từ bản
Hermes v0.20.6 của gói. Nghĩa là mỗi lần cài lên một bản Hermes mới hơn là
**kéo ngược hai file đó về v0.20.6** — với `tools/approval.py` thì đó là **hạ
cấp bộ dò lệnh nguy hiểm**, mất luôn những mẫu nguy hiểm bản mới vừa bổ sung.
Đổi một thay đổi mười dòng lấy nguyên một file 5000 dòng là quá đắt.

Giờ hai file đó được **vá tại chỗ**: chỉ sửa đúng mấy dòng cần sửa, giữ nguyên
mọi thứ khác của bản Hermes anh đang chạy. Vá idempotent (chạy lại không làm gì
thêm) và chịu được bản mới: không nhận ra đoạn cần sửa thì **bỏ qua kèm cảnh
báo** chứ không đoán mò. Vẫn sao lưu và khôi phục như mọi file khác.

**3. Self-test là báo cáo, không phải cổng chặn.** Bộ dịch hay cơ chế thu hồi
quyền có trục trặc thì installer **nói rõ ở dòng `SelfTest`** và cài tiếp, chứ
không huỷ cả bản Dashboard vừa build xong. Chỉ những thứ thật sự hỏng mới chặn:
build lỗi, test của Dashboard đỏ, hoặc dấu phiên bản không nằm trong `web_dist`.

Kết quả in ra sau khi cài giờ có thêm hai dòng:

```text
CorePatch : đã áp dụng
SelfTest  : đạt
```

Nếu `SelfTest` báo thiếu gì thì cứ gửi em dòng đó — Dashboard vẫn chạy bình
thường trong lúc chờ.

## v2.19.0 — thu hồi quyền giờ mới THẬT SỰ có hiệu lực

Bấm "Thu hồi" ở bảng quyền có ghi đúng vào `config.yaml` — nhưng **tiến trình
Hermes đang chạy vẫn cho phép như thường**. Đây là lỗi trong chính lõi Hermes,
gói này phát hiện ra vì bảng quyền làm nó lộ diện.

**Chuyện gì xảy ra.** `tools/approval.py` giữ một bản sao danh sách quyền trong
bộ nhớ (`_permanent_approved`). Hàm nạp lại dùng phép **HỢP**:

```python
def load_permanent(patterns):
    _permanent_approved.update(patterns)   # chỉ thêm, không bao giờ bớt
```

Nên quyền đã gỡ khỏi `config.yaml` vẫn sống trong bộ nhớ tới khi tắt hẳn Hermes.
Tệ hơn: mọi chỗ cấp quyền đều lưu bằng `save_permanent_allowlist(_permanent_approved)`
— ghi nguyên bản sao trong bộ nhớ ra đĩa. Nghĩa là sau khi anh thu hồi, chỉ cần
bấm "luôn cho phép" cho **một lệnh khác bất kỳ**, quyền vừa thu hồi sẽ được ghi
ngược trở lại config, âm thầm, không báo gì.

Và hàm nạp còn bỏ qua danh sách rỗng (`if patterns:`) — tức là thu hồi *toàn bộ*
là trường hợp chắc chắn không ăn.

**Đã sửa** trong `tools/approval.py`: nạp lại là **THAY THẾ**, và luôn nạp kể cả
khi danh sách rỗng. Config là nguồn sự thật, bộ nhớ chỉ là bản đệm của nó. An
toàn vì mọi lần cấp quyền đều ghi ra đĩa ngay tại chỗ, nên nạp lại không thể làm
mất quyền vừa cấp; và nếu có sai thì sai theo hướng **hỏi thêm một lần**, không
bao giờ hỏi ít đi. Gateway nạp lại danh sách mỗi khi tạo phiên, nên giờ `/new`
là đủ để thu hồi có hiệu lực.

`Test-HermesPermissions.py` (mới) chứng minh điều đó trên đúng bản Hermes của
anh, và installer chạy nó tự động: gỡ một quyền thì mất hiệu lực sau khi nạp
lại, gỡ toàn bộ cũng vậy, quyền còn lại không bị mất oan, quyền vừa cấp sống sót
qua vòng lưu–nạp, và quyền đã thu hồi không bị ghi ngược ra config. Chạy trên
bản Hermes gốc chưa vá thì bài test này **trượt** — đúng như mong đợi.

**Còn một lý do khác khiến Hermes không hỏi, và không phải lỗi:** ở chế độ mặc
định **"Hỏi thông minh"**, Hermes nhờ một mô hình phụ chấm điểm từng lệnh trước
khi quyết định có hỏi hay không. Xoá một thư mục mà nó cho là vô hại thì sẽ
không hỏi, dù anh đã thu hồi quyền. Bảng quyền giờ nói thẳng điều này ngay dưới
phần chọn chế độ, kèm hai lối ra: chọn **"Hỏi mọi lúc"** để lần nào cũng được
hỏi, hoặc dùng **"Cấm tuyệt đối"** để chặn hẳn — mục đó đứng trên tất cả, kể cả
`/yolo`.

Muốn xem trước mà không chạy thật:

```powershell
hermes approvals test -- rm -rf "D:\thư mục nào đó"
```

In ra verdict (`allow` / `ask-approval` / `deny`) và luật nào khớp, không đụng
tới file nào.

## v2.18.1 — bảng quyền nhận diện đủ 113 loại, không còn dòng tiếng Anh

Bản 2.18.0 chỉ dịch danh sách `DANGEROUS_PATTERNS` (98 mẫu), nên một cài đặt
thật vẫn hiện dòng *"Dashboard chưa có mô tả tiếng Việt"* cho
`script execution via -e/-c flag`. Hoá ra Hermes còn một bộ dò thứ hai —
`_execution_flag_findings` — sinh ra loại quyền riêng, cùng đường đi và cùng chỗ
lưu, nhưng không nằm trong danh sách kia.

Đã bổ sung **14 loại còn thiếu**, nâng độ phủ lên **113/113**:

- **Chạy mã qua cờ dòng lệnh** — `python -c`, `perl -e`, `node -e`, heredoc, và
  `bash -c` / `sh -c`.
- **Chạy chương trình núp sau lệnh khác** — 8 loại: `sort --compress-program`,
  `rg --pre`, `rg --hostname-bin`, `ag --pager`, `man --pager`, `man --html`,
  `man -P`, `man -H`. Nhìn như tìm kiếm hay đọc tài liệu, thật ra là chạy
  chương trình.
- **Lệnh Hermes không phân tích nổi** (quá dài hoặc méo) — cấp quyền này là bỏ
  luôn lớp bảo vệ cho đúng những lệnh nó đọc không ra, nên xếp *Rất nguy hiểm*.
- **Ghi vào cấu hình SSH** (`ssh_config_write`) và **dừng gateway bằng lệnh ghép
  qua shell**.

**Hai chỗ nhận diện sai cũng đã sửa:** mục do bản Hermes cũ ghi ra dưới dạng
biểu thức chính quy (`(python[23]?|perl|ruby|node)\s+-[ec]\s+`) trước đây bị
đọc nhầm thành "mẫu lệnh", nay hiện đúng quyền thật của nó kèm ghi chú *"mục
cũ"*; và một biểu thức chính quy sót lại không còn bị mô tả nhầm là glob.

**Bộ tự kiểm tra giờ hỏi thẳng Hermes** thay vì đoán: nó đọc `DANGEROUS_PATTERNS`,
các literal mà `_execution_flag_findings` sinh ra, bảng cờ của read-tool, và hai
khoá cố định — rồi đối chiếu với bảng dịch. Nên nếu bản Hermes của anh có loại
quyền mới hơn gói này, installer nói rõ còn bao nhiêu loại sẽ hiện tiếng Anh.
Vẫn chỉ là ghi chú, không chặn cài.

## v2.18.0 — Quyền & phê duyệt: xem và thu hồi ngay trong Dashboard

Khi Hermes hỏi xin quyền chạy một lệnh nguy hiểm và anh bấm **"luôn cho phép"**,
nó ghi vĩnh viễn vào `command_allowlist` trong `config.yaml`. Trước đây đó là
cánh cửa một chiều: muốn lấy lại quyền phải mở terminal, chạy `hermes config
edit`, tự tìm đúng dòng mà xoá. Giờ có nút.

**BẢNG ĐIỀU KHIỂN → thẻ "quyền & phê duyệt"**, ngay dưới ô mô hình. Thẻ cho
biết đang cấp bao nhiêu quyền và đang ở chế độ hỏi nào; bấm vào mở bảng đầy đủ
gồm ba phần:

**1. Khi gặp lệnh nguy hiểm.** Chọn một trong ba chế độ, có giải thích rõ:

- **Hỏi mọi lúc** — lệnh nguy hiểm nào cũng dừng chờ anh duyệt.
- **Hỏi thông minh** — Hermes tự đánh giá rồi chỉ hỏi khi thật sự rủi ro (mặc
  định).
- **Không hỏi** — chạy tuốt. Chọn cái này sẽ hiện cảnh báo đỏ ngay bên dưới.

**2. Quyền đã cấp vĩnh viễn.** Danh sách những gì anh đã cho qua, **xếp theo
mức nguy hiểm, cái đáng lo nhất lên đầu**, mỗi dòng một câu tiếng Việt nói rõ nó
cho phép làm gì. Ví dụ `delete in root path` hiện thành *"Xoá thẳng trong thư
mục gốc của ổ đĩa — mất cả cây thư mục, không có thùng rác."* Mỗi dòng có nút
**Thu hồi** (hỏi lại một lần trước khi làm), và có **Thu hồi tất cả**.

Bảng dịch phủ **cả 113 loại quyền** mà Hermes v0.20.6 có thể ghi ra, chia ba mức:
*Rất nguy hiểm* / *Nguy hiểm* / *Cần cân nhắc*. Quyền do tiện ích, bộ quét bảo
mật tirith, hay `execute_code` sinh ra cũng được nhận diện và giải thích. Mã gốc
tiếng Anh vẫn hiện bên dưới để đối chiếu với `config.yaml`.

**3. Cấm tuyệt đối.** Thêm/gỡ luật chặn (`approvals.deny`). Đây là thứ mạnh nhất
trong cả hệ thống: lệnh khớp mẫu ở đây bị chặn **trước cả** `/yolo` và trước cả
chế độ "không hỏi" — nên kể cả có lỡ bấm "luôn cho phép" lần nữa cũng không qua
được. Gõ `rm -rf` mà quên dấu `*` thì bảng nhắc ngay, vì mẫu không có `*` chỉ
khớp đúng một chuỗi.

**An toàn khi ghi.** Bảng đọc `GET /api/config` và ghi `PUT /api/config`, mỗi
lần chỉ gửi đúng khoá đang đổi. Endpoint này gộp sâu (deep-merge) và thay nguyên
danh sách, nên thu hồi một quyền là gửi *phần còn lại* chứ không phải danh sách
rỗng — có test riêng khoá chặt điều đó, vì gửi sai một lần là xoá mất cấu hình
anh chưa từng đụng tới. Ghi xong bảng đọc lại từ đĩa chứ không tin bản nháp
trong bộ nhớ; ghi hỏng thì nói thẳng là hỏng và giữ nguyên màn hình.

**Lưu ý:** phiên đang chạy đã nạp danh sách cũ vào bộ nhớ từ lúc khởi động, nên
sau khi thu hồi hãy `/new` để phiên dùng danh sách mới. Bảng có ghi câu nhắc này
ở chân trang.

Installer giờ cũng báo thêm số loại quyền có mô tả tiếng Việt trên đúng bản
Hermes của anh — nếu bản anh có mẫu nguy hiểm mới hơn gói này, nó nói rõ bao
nhiêu loại sẽ hiện tiếng Anh. Đây là ghi chú, không phải lỗi, không chặn cài.

## v2.17.0 — Việt hoá 367 câu thông báo của chính Hermes

Từ trước tới giờ gói này chỉ việt hoá được phần giao diện Dashboard. Các câu do
**chính Hermes sinh ra** — xin quyền chạy lệnh, phản hồi của lệnh `/` — vẫn là
tiếng Anh, vì chúng không thuộc mã nguồn Dashboard.

Hoá ra Hermes đã có sẵn hệ thống đa ngôn ngữ: thư mục `locales/` với 17 thứ
tiếng (en, zh, ja, de, es, fr, ko, ru…) — **chỉ thiếu tiếng Việt**. Bản này bổ
sung đúng chỗ đó thay vì đi chặn từng câu.

**`locales/vi.yaml` — 367 câu, khớp 100% với bản gốc tiếng Anh:**

- **16 câu phê duyệt lệnh** — chính phần "xin quyền" anh hay gặp:
  `⚠️  LỆNH NGUY HIỂM: <lệnh>`, `[o] một lần | [s] phiên này | [a] luôn cho
  phép | [d] từ chối`, `✓ Đã cho phép trong phiên này`, `✓ Đã thêm vào danh
  sách cho phép vĩnh viễn`, `⏱ Hết giờ — đã từ chối lệnh`…
- **351 câu phản hồi lệnh `/`** — /model, /approve, /deny, /status, /context,
  /usage, /compress, /goal, /resume, /branch, /rollback, /reasoning, /voice,
  /kanban, /personality, /verbose, /yolo…

`agent/i18n.py` được thêm `"vi"` vào danh sách ngôn ngữ hỗ trợ, kèm các cách
gọi quen thuộc: `vietnamese`, `tiếng việt`, `tieng viet`, `vi-VN`.

**Installer tự bật luôn** — chạy `hermes config set display.language vi` sau khi
cài xong. Thêm `-SkipVietnamese` nếu anh muốn giữ tiếng Anh.

**Và tự kiểm tra trước khi bật.** `Test-HermesVietnamese.py` chạy lại đúng ba
bất biến mà bộ test của Hermes bảo vệ, nhưng không cần pytest:

1. `vi.yaml` có đủ và đúng tập khoá của `en.yaml` — thiếu khoá nào là chỗ đó
   rơi ngược về tiếng Anh.
2. Mọi câu giữ nguyên `{placeholder}` như bản gốc — sai một cái là lúc chạy
   thật sẽ nuốt mất giá trị hoặc ném lỗi.
3. `agent.i18n` thật sự trả về tiếng Việt — tức `"vi"` đã được đăng ký chứ
   không âm thầm rơi về `"en"`.

Hỏng bước nào là installer khôi phục toàn bộ như cũ rồi mới báo lỗi. Anh cũng
chạy tay được:

```powershell
& 'D:\HERMES AGENT\hermes-agent\venv\Scripts\python.exe' `
    '.\Test-HermesVietnamese.py' 'D:\HERMES AGENT\hermes-agent'
```

**Những phần vẫn là tiếng Anh, và vì sao:**

- **Khung xin quyền trong tab Terminal** là của giao diện Ink (`ui-tui/`), nó
  không đọc `locales/`; chữ nằm cứng trong mã TypeScript. Việt hoá được, nhưng
  cần vá thêm `ui-tui/` và bước build riêng của nó.
- **Chú thích các lệnh `/`** thì Hermes cố tình không dịch (ghi rõ trong
  `agent/i18n.py`). Phần này chỉ xử lý được từ phía Dashboard.
- **Output của agent, output của công cụ, log, traceback** — cũng cố tình để
  nguyên, và nên để nguyên.

Vì `locales/` và `agent/i18n.py` là mã lõi của Hermes nên `hermes update` sẽ ghi
đè. Chạy lại `Install-HermesTealMax.ps1` là có lại — installer đã sao lưu và
phục hồi cả hai file này như mọi file khác.

## v2.16.1 — đổi model ở khung chat, bảng điều khiển đi theo

Ở v2.16.0 nút đổi nhanh model chỉ gõ `/model <id>` vào phiên đang chạy. Phiên đổi
thật, nhưng ô "mô hình" trong **BẢNG ĐIỀU KHIỂN → Thông tin phiên** đọc từ
`config.yaml` nên vẫn hiện model cũ — nhìn vào tưởng chưa đổi.

Giờ mỗi lần bấm đổi model là **hai bước**:

1. Ghi vào cấu hình (`/api/model/set`) — đúng chỗ ô "mô hình" đọc, và cũng là
   model phiên sau sẽ khởi động cùng.
2. Gõ `/model <id>` vào phiên đang chạy.

Xong là bảng điều khiển tự đọc lại, không cần tải lại trang.

- Provider lấy từ chính model: model thêm từ danh sách thì đã có sẵn provider;
  model gõ tay thì tra trong danh sách, không thấy thì dùng provider của phiên
  hiện tại.
- Nếu model thuộc nhóm đắt tiền, cảnh báo hiện ngay trong bảng với hai nút **"Vẫn
  đổi"** / **"Thôi"** — y như bảng điều khiển. Chưa bấm thì chưa đổi gì cả.
- Nếu ghi cấu hình hỏng (mất mạng, provider lạ), phiên vẫn được đổi và bảng nói
  rõ "bảng điều khiển vẫn hiện model cũ" — không im lặng.

**Sửa thêm:** ô "Thêm model thường dùng" vốn kiêm luôn ô tìm kiếm, nên gõ `glm`
rồi bấm Thêm là lưu đúng chữ `glm` — một model không tồn tại. Giờ nút Thêm lấy
model thật: khớp chính xác trước, không thì lấy gợi ý đầu tiên (chính là chip
ngoài cùng bên trái ngay dưới), chỉ khi danh sách không biết gì mới lưu nguyên
chữ anh gõ.

## v2.16.0 — đổi nhanh model, bảng lệnh tự cập nhật, installer tự kiểm tra

**Đổi nhanh model thường dùng.** Ngay cạnh nút "Chi tiết lệnh Hermes" trong khung
soạn thảo có thêm nút **Model**, kèm tên model đang chạy. Bấm vào là ra danh sách
model *anh tự chọn để dành* — bấm một cái là đổi ngay giữa cuộc trò chuyện, không
phải mở bảng điều khiển, không phải gõ `/model`.

- Thêm model: gõ thẳng tên vào ô "Thêm model thường dùng", hoặc chọn từ danh sách
  model của Hermes hiện ngay bên dưới (có ô tìm kiếm). Có sẵn nút **"Thêm model
  đang dùng"** cho nhanh.
- Gỡ model: dấu **×** ở cuối mỗi dòng.
- Model đang chạy được đánh dấu ✓; danh sách giữ tối đa 12 model, cái mới thêm
  nằm trên cùng.
- Ô nhập chịu được mọi kiểu dán: `/model z-ai/glm-5.3-flash`, có dấu nháy, thừa
  khoảng trắng — đều được dọn về đúng id.
- Danh sách lưu trong trình duyệt nên còn nguyên sau khi tải lại trang hay khởi
  động lại Dashboard. Cách đổi vẫn là `/model <id>` gõ thẳng vào phiên đang chạy,
  y như bảng điều khiển làm từ v2.11.0.

**Bảng lệnh tự cập nhật từ Hermes.** Trước đây danh sách 95 lệnh là bản chụp cứng
của v0.20.6 — chạy `hermes update`, cài plugin hay thêm quick command là bảng lệnh
lạc hậu ngay. Giờ khi PTY mở, Dashboard hỏi gateway RPC `commands.catalog` và trộn
kết quả thật vào bảng:

- Lệnh Dashboard đã biết: giữ nguyên phần giải thích tiếng Việt, giữ nhóm "hay
  dùng" và cờ "mở bảng chọn ở Terminal", chỉ làm mới dòng mô tả gốc.
- Lệnh Dashboard chưa biết (Hermes bản mới, plugin, quick command, skill): thêm
  vào bảng và gắn nhãn **mới** màu đồng.
- Lệnh bản Hermes này không còn: bỏ khỏi bảng — nhưng chỉ khi catalog trả về đầy
  đủ, để một lần dò hụt không làm trống bảng lệnh.
- RPC lỗi hay Hermes bản cũ không có method này: giữ nguyên 95 lệnh cũ, chat vẫn
  chạy bình thường.

Bảng "Chi tiết lệnh Hermes" ghi rõ đang dùng bao nhiêu lệnh và có mấy lệnh mới.

**Installer tự chạy test sau khi build.** `Install-HermesTealMax.ps1` giờ chạy 29
file test của chính overlay (624 test, khoảng 21 giây) ngay sau `npm run build`,
rồi kiểm tra dấu phiên bản `v2.30.0` có thật sự nằm trong `web_dist` hay không.
Bất kỳ bước nào hỏng là **tự khôi phục toàn bộ source và `web_dist` cũ** rồi mới
báo lỗi — nghĩa là một bản cài hỏng không bao giờ đến được máy anh.

- `-FullTests` chạy trọn bộ test của web (909 test) thay vì chỉ phần overlay.
- `-SkipTests` bỏ hẳn bước test nếu máy đang bận.

Mặc định chỉ chạy test của overlay, để test cũ của Hermes (nếu bản Hermes trên máy
lệch với bản gói này) không làm hỏng một bản cài vốn tốt.

## v2.15.0 — bỏ khối tiêu đề thừa trên trang Chat

Khối "HERMES MAX / TRUNG TÂM ĐIỀU KHIỂN" cùng ba chip trạng thái ("Đang hoạt
động", "Suy luận chủ động", "PTY trực tiếp") đã được gỡ. Nó lặp lại tên trang đã
có sẵn ở thanh tiêu đề phía trên, còn trạng thái PTY thì thanh công cụ ngay dưới
đã báo bằng chấm xanh và chip "Luồng". Gỡ đi trả lại gần một phần năm chiều cao
màn hình cho khung chat.

CSS của khối đó cũng được dọn (21 khối quy tắc), không để lại rác.

## v2.14.0 — nút "Đồng bộ Terminal" và 30 dòng chờ ngộ nghĩnh

Thanh công cụ có thêm nút **Đồng bộ Terminal: bật / tắt**, nhớ lựa chọn giữa các
lần mở.

- **Bật** (mặc định): chữ chảy ra đúng nhịp Terminal, như v2.13.0.
- **Tắt**: khung chat chờ trọn câu trả lời rồi mới hiện một lần. Dành cho các mô
  hình thinking sinh chữ chậm — chữ nhỏ giọt từng từ nhìn còn mệt hơn là chờ.

Tắt đồng bộ không có nghĩa là im lặng rồi "bùng" ra nguyên đoạn. Bong bóng vẫn
chạy một **dòng chờ ngộ nghĩnh**, đổi mỗi 4,2 giây trong 30 dòng: "Đang chạy lon
ton…", "Cố lên, sắp xong rồi!", "Chuẩn bị bùm bùm nè…", "Ăn cơm đi, còn lâu
lắm…"… Kèm theo là số chữ đã nhận được thật ("đã viết 320 chữ"), nên nó vừa vui
vừa là tiến trình thật chứ không phải hoạt ảnh trang trí. Tên công cụ đang chạy
vẫn được ưu tiên hiển thị ở cả hai chế độ.

Dòng chờ được chọn theo `seq` của chính lượt đó chứ không dùng `Math.random`,
nên hàm render vẫn thuần và hai lượt liên tiếp không mở đầu bằng cùng một câu.

## v2.13.0 — hỏi đúng khoá phiên, luồng chữ mới có dữ liệu

Đèn báo ở v2.12.0 đứng mãi ở `đã nối` mà không bao giờ lên `đang nghe · N sự
kiện`. Đó là câu trả lời: RPC chạy tốt, nhưng vòng đệm **rỗng**.

Gateway đánh số một phiên bằng **hai** khoá khác nhau:

- `id` — khoá trong bảng `_sessions`, là thứ mọi khung sự kiện được đóng dấu và
  là khoá của vòng đệm phát lại;
- `session_key` — session id của chính agent, là thứ hiện trên URL `?resume=`,
  trong danh sách phiên và trong kho tin nhắn.

Dashboard chỉ biết khoá thứ hai, và đem nó đi hỏi vòng đệm. Không có lỗi nào cả
— RPC vui vẻ trả về danh sách rỗng, nên nhìn bên ngoài y như "đã nối nhưng
không có gì". Nay Dashboard gọi `session.active_list` để tra `session_key` →
`id` rồi mới hỏi vòng đệm bằng đúng khoá đó; lọc theo phiên cũng đổi sang khoá
gateway. Vòng đệm chưa từng ghi gì (PTY vừa dựng lại dưới phiên gateway mới)
thì tự tra lại khoá thay vì ngồi im.

Đèn báo có thêm trạng thái `chưa khớp phiên` cho trường hợp không tìm ra dòng
nào khớp — thà nói thẳng còn hơn đứng ở `đã nối`.

## v2.12.0 — tem phiên bản, đèn báo dời lên thanh công cụ, và test thật

**Thanh công cụ có tem phiên bản** (`v2.12.0`) ngay cạnh nút cỡ chữ. Không thấy
tem đó nghĩa là bản build chưa lên máy — hoặc trình duyệt còn giữ bundle cũ, hoặc
installer chưa chạy xong. Ba vòng vừa rồi mất thời gian vì không phân biệt được
"code sai" với "code chưa tới nơi".

**Đèn báo luồng dời lên thanh công cụ**, cạnh tem phiên bản: `Luồng: chưa nối` →
`đã nối` → `đang nghe · N sự kiện`, hoặc `lỗi: <nguyên văn>`. Có chấm tròn đổi
màu (xám / xanh / đỏ) nên liếc là thấy, không còn nằm mờ ở góc.

**Test dựng thẳng khung chat.** `CommandChat.live.test.tsx` mount component
thật, giả lập gateway rồi bơm khung sự kiện vào, và kiểm: đèn báo có hiện, poller
có gọi `session.events.since` đúng session, một `message.delta` thô có chảy ra
bong bóng, một delta qua WebSocket cũng chảy ra, và khi RPC lỗi thì lý do được
hiện. Trước đó chỉ có unit test cho bộ rút gọn trạng thái — phần đấu nối giữa
component và nó thì không ai kiểm, nên bug nằm im ba bản.

Kết quả: phần hiển thị và phần đấu nối đã được chứng minh là đúng. Nếu trên máy
anh vẫn không chảy chữ, đèn báo sẽ chỉ ra chỗ đứt nằm ngoài đoạn code này.

## v2.11.0 — bề ngang bong bóng, việt hoá ghi chú runtime, và một cái đèn báo

**Bề ngang bong bóng** trả lại đúng như bản cũ. v2.10.0 bó khung chat lại cho
dễ đọc trên màn siêu rộng, nhưng trên 21:9 nó thành lọt thỏm giữa hai khoảng
trống.

**Ghi chú runtime** của Hermes — dòng `[System: The active model for this chat
has changed to …]` — nay hiện thành một dòng tiếng Việt gọn: "Phiên này đã
chuyển sang mô hình … (qua …)". Chỉ đổi cách hiển thị; văn bản gửi cho agent
vẫn nguyên vẹn. Tên mô hình có dấu chấm (`glm-5.3-flash`) nên phần tách được
viết tay thay vì dùng một regex — regex lười sẽ cắt tên mô hình làm đôi.

**Đèn báo luồng trực tiếp.** Góc trên bên phải khung chat giờ hiện trạng thái
thật của luồng: `chưa nối` → `đã nối` → `đang nghe · N sự kiện`, hoặc `lỗi: …`
kèm nguyên văn thông báo lỗi RPC. Luồng chữ vẫn chưa chạy được và tôi chưa
khẳng định được vì sao nếu chỉ đọc code, nên thay vì đoán tiếp thì cho nó nói
ra: nhìn đèn này lúc Hermes đang trả lời là biết luồng dừng ở khâu nào.

## v2.10.0 — chảy chữ chạy thật, hết tách bong bóng, cỡ chữ, đổi model

**Luồng chữ.** 2.8.0 rút đúng vòng đệm nhưng đọc sai hình dạng dữ liệu:
`session.events.since` trả về **event trần** (`{type, session_id, payload,
seq}`) chứ không có vỏ `{method:"event", params:{…}}` — docstring của nó nói rõ
là trả về phần `params` "vì đó đúng là thứ đường dispatch phía client tiêu
thụ". Parser cũ đòi có vỏ nên loại sạch mọi delta. Nay nhận cả hai hình dạng,
và lọc theo `session_id` để event của phiên khác không lọt vào.

**Một tin nhắn bị tách thành nhiều bong bóng.** Khi gõ tin nhiều dòng, Dashboard
gửi ký tự LF trần giữa các dòng. Nhưng `shouldInsertNewlineOnReturn` của TUI chỉ
coi LF là xuống dòng trên terminal mà nó nhận diện được (macOS, SSH, WSL,
Windows Terminal…); còn lại **LF là Enter** — nên mỗi dòng thành một tin riêng,
và Hermes gắn nhãn "[Additional user correction]" cho các dòng sau. Nay dùng
Shift+Enter dạng kitty CSI-u (`ESC[13;2u`), thứ mà TUI luôn hiểu là xuống dòng.

**Cỡ chữ.** Thanh công cụ có nút **Chữ …%** xoay vòng 100 → 110 → 125 → 140 →
160%, nhớ lựa chọn giữa các lần mở. Mặc định nay là 110%. Bong bóng cũng giới
hạn bề ngang hợp lý để trên màn 21:9 dòng chữ không kéo dài hết màn hình.

**Đổi model từ Bảng điều khiển.** `/api/model/set` chỉ ghi config, tức là quyết
định phiên **kế tiếp** dùng model gì; phiên đang chạy vẫn giữ model cũ. Tải lại
trang cũng vô ích vì tab chat gắn lại đúng PTY cũ đang sống. Nay chọn model
xong, Dashboard đưa thẳng `/model <id>` vào phiên đang chạy — đúng thao tác tay
mà anh vẫn làm — nên đổi có hiệu lực ngay, không mất phiên. Không có phiên sống
thì mới quay về hỏi tải lại trang như cũ.

## v2.8.0 — luồng chữ đi đúng đường, khối công cụ gọn, và sửa lỗi đổi phiên

**Vì sao 2.7.0 vẫn không chảy chữ.** 2.7.0 nghe `/api/events`, kênh mà
`tui_gateway.entry` phía PTY mirror mọi sự kiện sang. Nhưng ở thiết lập mặc
định, `/api/pty` tiêm `HERMES_TUI_GATEWAY_URL` để tiến trình con **gắn thẳng
vào gateway in-memory của Dashboard thay vì tự sinh gateway riêng** — mà
`_install_sidecar_publisher()` chỉ chạy trong `tui_gateway.entry.main()`. Không
có gateway con thì không ai mirror, nên kênh đó im lặng. Nó chỉ có tiếng ở chat
theo hồ sơ riêng, nơi tiến trình con buộc phải tự sinh gateway.

**Đường đúng.** Gateway giữ sẵn một vòng đệm sự kiện cho từng phiên và mở
`session.events.since` — đọc được qua chính `/api/ws` mà bảng mô hình đang
dùng. Giờ khung chat rút vòng đệm đó mỗi 320 ms, nên chữ hiện gần như tức thời
(khoảng 3 nhịp mỗi giây) thay vì đợi hết lượt. Kênh `/api/events` vẫn được giữ
cho trường hợp hồ sơ riêng; hai nguồn khử trùng lặp bằng `seq` mà gateway đóng
dấu trên từng khung sự kiện, nên không có chuyện chữ hiện hai lần.

Lần rút đầu tiên chỉ lấy mốc `latest_seq` chứ không phát lại vòng đệm — nếu
không, mở chat lên là mấy lượt cũ chạy lại từ đầu.

**Khối công cụ gọn như Terminal.** Trước đây mỗi lệnh gọi công cụ và mỗi kết quả
là một thẻ riêng, xếp thành một cột thẻ rỗng. Nay một chuỗi hoạt động công cụ
gộp thành **một khối** `Công cụ (6)`, mỗi dòng một lệnh kèm trích đoạn tham số
(`terminal · ls -la ~/.hermes/`) và trạng thái; bấm vào dòng mới mở tham số đầy
đủ và kết quả. Đúng cách Terminal trình bày.

**Lỗi đổi phiên.** Bấm sang phiên khác thì PTY phải dựng lại từ đầu, trong lúc
đó khung chat đã hiện tin nhắn phiên mới nhưng nút Gửi lại nằm im không nói gì.
Nay ô soạn có dòng trạng thái "Đang mở phiên trong Hermes… gửi được ngay khi
phiên sẵn sàng", và một lượt gửi bấm trong lúc chờ sẽ đợi tối đa 12 giây cho
phiên lên rồi gửi, thay vì báo lỗi sau 2,5 giây.

## v2.7.0 — chat chảy chữ theo thời gian thực

Trước bản này khung chat đọc kho phiên bằng cách hỏi lại mỗi 1,1 giây. Kho phiên
chỉ ghi tin nhắn khi lượt đã xong, nên Dashboard đứng im ở "Hermes đang xử lý
nhiệm vụ…" trong lúc Terminal đã chạy chữ đầy màn hình.

Hoá ra Hermes vốn đã phát sẵn luồng đó: `tui_gateway.entry` phía PTY đẩy mọi sự
kiện dispatcher sang Dashboard qua `/api/pub` → `/api/events?channel=…` (đúng
kênh mà bảng mô hình bên phải đang nghe để cập nhật tiêu đề phiên). Trong đó có
`message.delta` — chính là từng mẩu chữ agent đang viết.

Giờ khung chat nghe kênh đó và hiện bong bóng trả lời trực tiếp:

- Chữ chảy ra từng đoạn đúng nhịp Terminal, có con trỏ nhấp nháy ở cuối.
- Dòng trạng thái đổi theo việc đang làm: "Đang suy nghĩ…", "Đang chạy công cụ
  image_generate…", "Đang viết…".
- Xong lượt thì bong bóng trực tiếp nhường chỗ cho tin nhắn thật từ kho phiên,
  không nhân đôi.
- Lỗi giữa lượt được hiện ngay trong bong bóng thay vì im lặng.

Nội dung suy luận nội bộ chỉ dùng để bật trạng thái "đang suy nghĩ", không in ra.

Kết nối chỉ mở sau khi PTY đã sẵn sàng (trước đó chưa có ai phát trên kênh), tự
kết nối lại theo cùng thang backoff mà bảng mô hình đang dùng, và nếu kênh sự
kiện hỏng thì chat vẫn chạy y như cũ bằng đường hỏi lại kho phiên.

## v2.6.1 — nút "Chi tiết lệnh Hermes"

Cạnh nút Đính kèm có thêm nút **Chi tiết lệnh Hermes**. Bấm vào mở bảng tra cứu
phủ lên khung chat:

- **Hay dùng** xếp đầu tiên, khung và chữ màu champagne để tách khỏi phần còn
  lại: `/new` `/sessions` `/resume` `/model` `/status` `/context` `/usage`
  `/stop` `/undo` `/retry` `/queue` `/compress` `/clear` `/help` `/skills`
  `/image` `/copy` `/save` `/history`.
- Bên dưới là toàn bộ lệnh còn lại, nhóm theo Phiên / Cấu hình / Thông tin /
  Công cụ & Kỹ năng / Giao diện / Thoát.
- Mỗi dòng có tên lệnh, gợi ý tham số, **giải thích tiếng Việt**, tên gọi tắt
  và cảnh báo nếu lệnh đó mở bảng chọn trong Terminal.
- Ô tìm kiếm lọc theo tên lệnh **hoặc theo việc muốn làm** — gõ "nén ngữ cảnh"
  ra `/compress`.
- Bấm một dòng là lệnh nhảy thẳng vào ô soạn, khỏi gõ tay.

Bảng lệnh `/` gõ nhanh cũng đổi sang hiển thị giải thích tiếng Việt, và đánh
dấu ★ cho lệnh hay dùng.

## v2.6.0 — bảng lệnh "/" trong Dashboard

Terminal gõ `/` là hiện danh sách lệnh, Dashboard thì chưa. Nay có rồi: gõ `/`
trong khung chat sẽ mở bảng lệnh — ↑↓ chọn, Tab hoặc Enter để dùng, Esc đóng,
bấm chuột cũng được. Mỗi dòng có tên lệnh, gợi ý tham số, mô tả và nhóm.

Danh sách gồm **95 lệnh** lấy từ `COMMAND_REGISTRY` của Hermes v0.20.6, lọc
đúng như TUI lọc (bỏ lệnh ẩn và lệnh chỉ dành cho gateway, thêm nhóm TUI), cộng
thêm **các kỹ năng đang bật** đọc trực tiếp từ `/api/skills` lúc mở chat — nên
kỹ năng anh cài thêm cũng hiện trong bảng.

Vì Terminal lấy danh sách từ gateway (`commands.catalog`) còn Dashboard chỉ có
đường PTY, danh sách này được nhúng sẵn trong `hermes-commands.ts`. Bảng lệnh
chỉ **gợi ý**: gõ gì cũng gửi nguyên văn cho TUI, nên lệnh mới sau `hermes
update` vẫn chạy dù chưa có trong danh sách.

Chín lệnh mở bảng chọn toàn màn hình bên trong TUI (`/model`, `/skills`,
`/sessions`, `/plugins`, `/agents`, `/journey`, `/subscription`, `/topup`,
`/setup`) — khung chat không vẽ được, nên gửi xong Dashboard tự chuyển sang tab
Terminal cho anh thấy. Dòng gợi ý dưới ô soạn báo trước điều đó.

## v2.5.1 — chỉ sửa chú thích

Không đổi hành vi. Chú thích đầu `chat-composer.ts` vẫn mô tả cách nạp ảnh cũ
bằng `/image`; nay viết lại cho khớp với đường kéo–thả đang dùng, kèm lý do vì
sao không quay lại `/image`.

## v2.5.0 — nạp ảnh đúng đường kéo–thả, và xem ảnh ngay trong chat

**Nạp ảnh.** 2.4.x nạp ảnh bằng `/image <đường dẫn>` rồi Enter. Lệnh đó chạy qua
`appendAttachment`: nó chụp lại ô soạn thảo, gọi RPC `image.attach`, rồi **ghi
đè** ô soạn bằng `ảnh chụp + token` mà không kiểm tra gì cả. Gateway chạy ngay
trên máy nên RPC trả về trước khi Ink kịp render lại ô đã xoá, thành ra bản chụp
vẫn còn nguyên dòng lệnh và cả `/image D:\...png` bị nhét ngược vào ô soạn cạnh
`[[ Image 1 ]]` — đúng cái đống anh thấy trong terminal, và Enter thì mất trắng.

2.5.0 nạp ảnh **y hệt lúc kéo–thả tệp vào TUI**: dán đúng đường dẫn trần vào ô
soạn. TUI tự nhận ra đó là đường dẫn (`looksLikeDroppedPath`), gọi `image.attach`
và đặt token vào chỗ vừa dán. Nhánh dán này đi qua `emitPaste`, vốn có khoá
phiên bản chỉnh sửa nên không bao giờ ghi đè thứ mình vừa gõ. Không lệnh slash,
không Enter thừa, không xoá ô soạn giữa chừng.

**Xem ảnh trong chat.** Hermes chỉ trả về đường dẫn chứ không nhúng ảnh được.
Giờ Dashboard tự dò đường dẫn ảnh trong tin nhắn (kể cả đường dẫn Windows có
dấu cách như `D:\HERMES AGENT\cache\images\...`) rồi tải qua `/api/media` và
hiện thẳng trong khung chat — bấm vào ảnh để phóng to. Ảnh được nhớ theo đường
dẫn nên vòng lặp cập nhật mỗi giây không tải lại, và bộ nhớ đệm giới hạn 24 ảnh.

## v2.4.1 — sửa lỗi "Chưa kết nối tới Hermes"

Một bug có sẵn từ Dashboard gốc: khi WebSocket của PTY đóng, handler `onclose`
xoá `wsRef` **vô điều kiện**. Sự kiện close lại tới ở tick sau, nên mỗi lần kết
nối lại — bấm "Trò chuyện mới", đổi phiên, hay mạng chớp một nhịp — socket cũ
đóng *sau khi* socket mới đã được lưu, và nó xoá mất tham chiếu đang sống.

Terminal vẫn gõ được (nó giữ socket riêng trong closure) nên lỗi bị che, còn
mọi thứ đọc qua `wsRef` — khung chat mới và nút Copy — báo "chưa kết nối" cho
tới khi tải lại trang. Bản 2.4.1 chỉ xoá tham chiếu khi nó vẫn đang trỏ đúng
socket đó, gỡ handler của socket cũ trước khi đóng, và cho lượt gửi chờ tối đa
2,5 giây để vượt qua một nhịp kết nối lại thay vì báo lỗi ngay.

## Lỗi cũ: vì sao Hermes không nhận được tệp/ảnh

Khung chat mới không nói chuyện thẳng với agent — nó gõ vào đúng phiên
`hermes --tui` chạy sau xterm. Bản 2.3.0 gửi tin nhắn bằng cách **dán**
(`Terminal.paste`) cả khối nhiều dòng rồi hẹn giờ 80 ms nhấn Enter. Hai vấn đề:

1. `paste()` đổi `\n` thành `\r`. Khi TUI tắt bracketed-paste, mỗi `\r` là một
   lần Enter, nên dòng `Ảnh đính kèm: …` bị cắt rời khỏi câu hỏi hoặc bị bỏ hẳn
   (`valueForReturnSubmit` chỉ giữ phần trước dấu xuống dòng đầu tiên).
2. Khi TUI bật bracketed-paste, nội dung đi vào nhánh dán **bất đồng bộ** của
   TUI. Nhánh này gọi RPC `image.attach` / `input.detect_drop` rồi **ghi đè**
   ô soạn thảo bằng ảnh chụp trạng thái *trước khi* văn bản của mình tới
   (`appendAttachment`, `ui-tui/src/app/useComposerState.ts`). Enter rơi vào
   giữa lúc đó nên chỉ còn một mẩu ký tự sót lại được gửi đi — đúng hiện tượng
   "Hermes chỉ nhận được chữ *l*".

Ảnh còn hỏng thêm một nhịp nữa: 2.3.0 chạy `/image` ngay lúc **chọn** tệp, tức
là trước khi người dùng gõ xong, nên token `[[ Image N ]]` quay về sau và xoá
mất nội dung vừa gõ.

## Bản 2.4.0 sửa thế nào

- **Gõ, không dán.** Mỗi dòng được gửi thành khung riêng không chứa `\n` (TUI
  xử lý đồng bộ như gõ phím), `\n` đứng một mình để xuống dòng, `\r` đứng một
  mình để gửi — đúng đường mà `?learn=` của Hermes gốc vẫn dùng.
- **Đính kèm đúng thứ tự.** Chọn tệp giờ chỉ *tải lên*. Lúc bấm Gửi mới lần
  lượt: xoá sạch ô soạn của TUI (Ctrl+U/Ctrl+K) → dán đường dẫn từng ảnh như
  kéo–thả → **chờ TUI vẽ ra token `[[ Image N ]]`** rồi mới gõ nội dung → Enter.
- **Có tín hiệu xác nhận thật.** Dashboard đọc luồng PTY để biết ảnh đã được
  gateway nhận hay chưa (tối đa 9 giây) thay vì hẹn giờ mò.
- **Tệp thường không cần RPC.** Dashboard chèn thẳng
  `[User attached file: <đường dẫn>]` — đúng từng ký tự chuỗi mà
  `input.detect_drop` của Hermes sinh ra khi kéo thả tệp vào TUI.
- **Không mất bài khi lỗi.** Gửi thất bại thì nội dung và tệp đính kèm vẫn nằm
  nguyên trong ô soạn để gửi lại. Ảnh nào gateway không xác nhận sẽ tự động
  chuyển sang gửi kèm đường dẫn để Hermes tự mở, kèm cảnh báo rõ ràng.
- Tên tệp tải lên được gắn dấu thời gian nên không ghi đè tệp trùng tên; ảnh
  giới hạn 25 MB, tài liệu 100 MB, báo lỗi bằng tiếng Việt ngay trước khi tải.

## Khung chat mới có gì

- Xem trước ảnh ngay trên thẻ đính kèm, kèm tên và dung lượng, bỏ từng tệp.
- Kéo thả tệp vào khung chat và dán ảnh thẳng từ clipboard.
- Ô soạn thảo tự giãn theo nội dung, Enter gửi, Shift+Enter xuống dòng,
  Esc dừng lượt đang chạy.
- Nút sao chép trên từng tin nhắn, nút "Tin nhắn mới nhất" khi đang cuộn lên.
- Tin nhắn cũ hiển thị tệp/ảnh đính kèm thành thẻ thay vì để lộ cú pháp thô.
- Ảnh Hermes tạo ra hiện thẳng trong tin nhắn, bấm để phóng to.
- Gõ `/` mở bảng lệnh: 95 lệnh Hermes cùng kỹ năng đang bật.
- Nút "Chi tiết lệnh Hermes": bảng tra cứu đầy đủ 95 lệnh, giải thích tiếng
  Việt, lệnh hay dùng xếp đầu và tô màu riêng.
- Câu trả lời chảy chữ gần như tức thời, kèm trạng thái công cụ đang chạy.
- Tắt đồng bộ được cho mô hình chậm, lúc đó có dòng chờ ngộ nghĩnh thay thế.
- Chuỗi gọi công cụ gộp thành một khối gọn, mở ra xem chi tiết khi cần.
- Gợi ý câu lệnh khi phiên còn trống.

## Cài đặt

Mở **PowerShell thường** (không cần quyền Administrator), giải nén gói rồi chạy:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
& '.\Install-HermesTealMax.ps1'
```

Mặc định gói dùng Hermes tại `D:\HERMES AGENT`. Nếu cài ở chỗ khác:

```powershell
& '.\Install-HermesTealMax.ps1' -HermesRoot 'E:\Hermes'
```

Cài xong installer in ra `HERMES_IVORY_GRAPHITE_PASS` kèm dòng `SelfTest` cho
biết đã chạy bao nhiêu file test. Rồi mở:

```text
http://127.0.0.1:9119/
```

Nếu máy đang bận và anh muốn cài thật nhanh, hoặc ngược lại muốn chạy trọn bộ
test:

```powershell
& '.\Install-HermesTealMax.ps1' -SkipTests        # bỏ bước test
& '.\Install-HermesTealMax.ps1' -FullTests        # chạy cả 505 test của web
& '.\Install-HermesTealMax.ps1' -SkipVietnamese   # không đổi ngôn ngữ Hermes sang tiếng Việt
```

Muốn quay lại tiếng Anh bất cứ lúc nào:

```powershell
hermes config set display.language en
```

## Tự kiểm tra sau khi cài

Từ v2.16.0 installer đã tự chạy test và tự khôi phục nếu hỏng, nên bước này chỉ
cần khi anh muốn xem lại:

```powershell
cd 'D:\HERMES AGENT\hermes-agent'
npm run test --workspace web
```

Kiểm tra nhanh bằng tay: đính kèm một ảnh và một tệp PDF, gõ "đọc giúp anh hai
tệp này" rồi Gửi. Thẻ tin nhắn phải hiện hai chip đính kèm, và Hermes phải mô
tả được cả nội dung ảnh lẫn nội dung tệp.

## Chỉ sửa lỗi đóng PowerShell thì Dashboard tắt

```powershell
& '.\Install-HermesDashboardTask.ps1'
```

## Dừng Dashboard nền

```powershell
& '.\Stop-HermesDashboardTask.ps1'
```

## Quay về Dashboard cũ

Installer luôn backup source cũ và `hermes_cli\web_dist` **trước khi sửa**.

```powershell
& '.\Restore-HermesDashboard.ps1'
```

Hoặc chọn chính xác một backup:

```powershell
& '.\Restore-HermesDashboard.ps1' `
    -BackupPath 'D:\HERMES AGENT\backups\hermes-teal-max-20260830-123456'
```

Trước khi restore, script còn tạo thêm một snapshot `dashboard-before-restore-*`
để chính thao tác quay đầu cũng có thể hoàn tác.

## Sau khi chạy `hermes update`

Hermes Update có thể ghi đè source giao diện. Chạy lại đúng một lệnh:

```powershell
& '.\Install-HermesTealMax.ps1'
```

Mỗi lần cài đều sao lưu source và `web_dist` vào
`D:\HERMES AGENT\backups\hermes-teal-max-<thời-gian>` trước khi thay đổi.

## Tệp trong gói

| Tệp | Vai trò |
| --- | --- |
| `web\src\lib\chat-composer.ts` | **Mới** — logic thuần: cắt khung gửi PTY, dựng dòng đính kèm, đọc token ảnh, đặt tên tệp tải lên |
| `web\src\lib\chat-composer.test.ts` | **Mới** — 32 test cho các hàm trên |
| `web\src\lib\hermes-commands.ts` | **Mới** — danh mục 95 lệnh `/`, giải thích tiếng Việt, nhóm lệnh hay dùng và bộ lọc |
| `web\src\lib\hermes-commands.test.ts` | **Mới** — 17 test cho danh mục lệnh |
| `web\src\lib\chat-live-turn.ts` | **Mới** — bộ rút gọn trạng thái lượt trả lời từ luồng sự kiện gateway |
| `web\src\lib\chat-live-turn.test.ts` | **Mới** — 16 test cho luồng trực tiếp |
| `web\src\lib\chat-transcript.ts` | **Mới** — gộp chuỗi gọi công cụ thành khối gọn |
| `web\src\lib\chat-transcript.test.ts` | **Mới** — 15 test cho phần gộp |
| `web\src\lib\chat-waiting-lines.ts` | **Mới** — 30 dòng chờ và bộ xoay vòng |
| `web\src\lib\chat-waiting-lines.test.ts` | **Mới** — 8 test cho dòng chờ |
| `web\src\lib\chat-command-catalog.ts` | **Mới** — trộn catalog lệnh sống từ gateway vào bảng lệnh có sẵn |
| `web\src\lib\chat-command-catalog.test.ts` | **Mới** — 16 test cho phần trộn catalog |
| `web\src\lib\chat-favorite-models.ts` | **Mới** — danh sách model thường dùng: dọn id, thêm, gỡ, tìm |
| `web\src\lib\chat-favorite-models.test.ts` | **Mới** — 23 test cho danh sách model |
| `web\src\components\FavoriteModelSwitch.tsx` | **Mới** — nút đổi nhanh model trong khung soạn thảo |
| `web\src\components\FavoriteModelSwitch.test.tsx` | **Mới** — 12 test: ghi cấu hình rồi mới đổi phiên, cổng cảnh báo model đắt, thêm/gỡ model |
| `web\src\lib\chat-approval.ts` | **Mới** — đọc sự kiện xin quyền của gateway, dịch sang tiếng Việt, dựng câu trả lời |
| `web\src\lib\chat-approval.test.ts` | **Mới** — 19 test cho phần trên |
| `web\src\lib\hermes-permissions.ts` | **Mới** — giải thích tiếng Việt cho 113 loại quyền, mức nguy hiểm, và logic đọc/thu hồi |
| `web\src\lib\hermes-permissions.test.ts` | **Mới** — 38 test cho phần trên |
| `web\src\components\PermissionsPanel.tsx` | **Mới** — bảng "Quyền & phê duyệt": xem, thu hồi, đổi chế độ, thêm luật chặn |
| `web\src\components\PermissionsPanel.test.tsx` | **Mới** — 13 test, khoá chặt việc thu hồi gửi đúng phần còn lại |
| `web\src\components\CommandChat.tsx` | Khung chat: tin nhắn, đính kèm, kéo thả, ô soạn thảo |
| `web\src\components\CommandChat.live.test.tsx` | **Mới** — 10 test dựng khung chat thật, giả lập gateway hai khoá phiên, kiểm luồng chữ và bảng lệnh sống |
| `web\src\pages\ChatPage.tsx` | Cầu nối PTY: nạp ảnh, gõ tin nhắn, theo dõi output |
| `web\src\hermes-max.css` | Giao diện Ivory Graphite |
| `locales\vi.yaml` | **Mới** — 367 câu thông báo tiếng Việt của chính Hermes (xin quyền + phản hồi lệnh `/`) |
| `Patch-HermesCore.py` | **Mới** — vá tại chỗ `agent/i18n.py` + `tools/approval.py`, bù khoá dịch còn thiếu (không ghi đè file lõi) |
| `Test-HermesPermissions.py` | **Mới** — chứng minh thu hồi quyền hoạt động đúng trên bản Hermes của anh |
| `Test-HermesVietnamese.py` | **Mới** — kiểm tra bộ dịch: đủ khoá, đúng placeholder, và Hermes thật sự dùng nó |
| các tệp còn lại | Sidebar, trang Phiên, chủ đề màu, locale Tiếng Việt |

## Log

- `D:\HERMES AGENT\logs\hermes-dashboard.out.log`
- `D:\HERMES AGENT\logs\hermes-dashboard.err.log`

Log tự xoay khi vượt 10 MB.
